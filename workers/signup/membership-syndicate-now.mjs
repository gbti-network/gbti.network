// SOW-088: the superadmin "Manually Syndicate" rail. The auto pipeline (SOW-034/058) enqueues on merge and a
// cron drain posts the stored template to the mapped channels; this endpoint lets a SUPERADMIN push one item
// to ONE destination RIGHT NOW with an edited template and (for Discord) an explicit channel, from the
// extension reader. Direct post + a tracker record (owner-decided), never through the pending queue.
//
//   GET  /membership/syndicate-now  -> { ok, destinations, templates, channelMap, featured }
//   POST /membership/syndicate-now  -> body { destination, item, template, channelId? } -> { ok, sent, id, url, itemId }
//
// Both verbs are superadmin-only (authorizeAdmin + role check, the syndication-admin pattern). The server
// renders the template itself via the shared renderTemplate (mention resolution + sanitization stay here;
// the client only ever sends a TEMPLATE, never trusted final text), and the item passes through
// buildQueueItem so the no-body leak guard and type validation apply. Re-posting an already-sent item is
// ALLOWED (the popup warns from the tracker history); the dedupe pointer is written only when absent so a
// later CI enqueue still dedupes against the manual send.

import { authorizeAdmin } from './membership-admin.mjs';
import { ROLE } from '../../membership/overrides-core.mjs';
import { buildQueueItem, dedupeKey } from '../../membership/syndication-queue.mjs';
import { renderTemplate } from '../../membership/syndication-format.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';
import { templateFor, TEMPLATE_TYPES, DEFAULT_TEMPLATES } from '../../membership/syndication-config-core.mjs';
import { buildAdapters } from '../../membership/syndication-adapters.mjs';
import { postToChannel } from '../../clients/syndication/discord-channel.mjs';
import { readSyndicationConfig, readContentChannels, putItem, getItem, SYND_DEDUPE_KEY } from './syndication-store.mjs';
import { createStripeClient } from '../../clients/stripe.mjs';
import { createDiscordClient } from '../../clients/discord.mjs';

// The destinations the manual flow offers. Reddit is listed but not postable until its adapter lands
// (the SOW-088 core phase, ported from the owner's Radle plugin).
const MANUAL_DESTS = ['discord', 'x', 'linkedin', 'mastodon', 'bluesky'];

const FEATURED_ENV = { post: 'DISCORD_CHANNEL_POSTS', product: 'DISCORD_CHANNEL_PRODUCTS', prompt: 'DISCORD_CHANNEL_PROMPTS', share: 'DISCORD_CHANNEL_SHARES' };

async function gate(request, env, { fetchImpl, authorize }) {
  const auth = await authorize(request, env, { fetchImpl });
  if (!auth.ok) return { deny: auth };
  if (auth.role !== ROLE.superadmin) {
    return { deny: { status: 403, body: { error: 'forbidden', message: 'superadmin access is required to syndicate manually' } } };
  }
  return { auth };
}

/** GET: readiness + templates + the category channel map, one call for the whole popup. */
export async function handleSyndicateNowInfo(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, fetchImpl = globalThis.fetch, authorize = authorizeAdmin } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the syndication store is not configured' } };
  const g = await gate(request, env, { fetchImpl, authorize });
  if (g.deny) return g.deny;

  const cfg = await readSyndicationConfig(kv);
  const channelMap = await readContentChannels(kv);
  const destinations = MANUAL_DESTS.map((id) => {
    const ready = secretsPresent(env, id);
    return ready ? { id, ready: true } : { id, ready: false, reason: 'missing secrets' };
  });
  destinations.splice(1, 0, { id: 'reddit', ready: false, reason: 'adapter pending (SOW-088)' });
  const templates = {};
  for (const t of TEMPLATE_TYPES) templates[t] = templateFor(cfg, t) ?? DEFAULT_TEMPLATES[t] ?? '';
  const featured = {};
  for (const [type, key] of Object.entries(FEATURED_ENV)) featured[type] = env?.[key] || null;
  return { status: 200, body: { ok: true, destinations, templates, channelMap: channelMap?.channels ?? [], featured } };
}

/** POST: render the edited template server-side and post one item to one destination now. */
/**
 * Resolve the author's REAL Discord mention (<@id>) so {member-discord-username} links instead of reading
 * as plain text: github login -> github_id (the GitHub users API, on the caller's own bearer) -> the Stripe
 * customer's discord_user_id (the registry, SOW-002). Fail-soft: any miss returns null and the template
 * falls back to the profile handle / GitHub username.
 */
async function resolveAuthorMention(request, env, item, { fetchImpl, makeStripe, makeDiscord }) {
  const login = String(item.author || '').trim();
  if (!login) return null;
  // 1. The registry: github login -> github_id -> the Stripe customer's discord_user_id (SOW-002).
  try {
    if (env?.STRIPE_SECRET_KEY) {
      const auth = request.headers.get('Authorization') || '';
      const ghRes = await fetchImpl(`https://api.github.com/users/${encodeURIComponent(login)}`, {
        headers: { 'User-Agent': 'gbti-syndicate/0.1', Accept: 'application/vnd.github+json', ...(auth ? { Authorization: auth } : {}) },
      });
      if (ghRes?.ok) {
        const githubId = String((await ghRes.json())?.id ?? '');
        if (githubId) {
          const stripe = makeStripe({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl });
          const customer = await stripe.findCustomerByGithubId(githubId);
          const discordId = String(customer?.metadata?.discord_user_id ?? '').trim();
          if (/^\d{5,}$/.test(discordId)) return `<@${discordId}>`;
        }
      }
    }
  } catch { /* fall through to the guild search */ }
  // 2. The guild itself: an exact username / display-name match via the member search (the registry has no
  // customer until the member completes signup, but the bot can see who is in the guild right now).
  try {
    if (env?.DISCORD_BOT_TOKEN && env?.DISCORD_GUILD_ID) {
      const discord = makeDiscord({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl });
      const handle = String(item.authorDiscord || '').trim().replace(/^@/, '');
      for (const q of [...new Set([handle, login].filter(Boolean))]) {
        const found = await discord.searchGuildMembers(env.DISCORD_GUILD_ID, q, { limit: 5 });
        const lc = q.toLowerCase();
        const hit = (Array.isArray(found) ? found : []).find((m) =>
          String(m?.user?.username || '').toLowerCase() === lc
          || String(m?.user?.global_name || '').toLowerCase() === lc
          || String(m?.nick || '').toLowerCase() === lc);
        if (hit?.user?.id) return `<@${hit.user.id}>`;
      }
    }
  } catch { /* fail-soft to the text fallback */ }
  return null;
}

export async function handleSyndicateNow(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now, fetchImpl = globalThis.fetch, authorize = authorizeAdmin, adapters = null, postDiscord = postToChannel, makeStripe = createStripeClient, makeDiscord = createDiscordClient } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the syndication store is not configured' } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  const g = await gate(request, env, { fetchImpl, authorize });
  if (g.deny) return g.deny;

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const destination = String(payload?.destination || '');
  if (destination === 'reddit') return { status: 400, body: { error: 'unavailable', message: 'the Reddit adapter is not built yet (SOW-088)' } };
  if (!MANUAL_DESTS.includes(destination)) return { status: 400, body: { error: 'invalid', message: 'unknown destination' } };
  const template = String(payload?.template || '').trim();
  if (!template) return { status: 400, body: { error: 'invalid', message: 'a message template is required' } };

  // The queue-item builder is the validation boundary: type whitelist, slug required, and the no-body
  // guard (a body/encryptedBody never reaches the queue or a channel).
  let item;
  try { item = buildQueueItem({ ...(payload?.item ?? {}), trigger: 'manual' }, { now, holdMs: 0 }); }
  catch (err) { return { status: 400, body: { error: 'invalid', message: `invalid item: ${err.message}` } }; }

  // A REAL Discord mention for the author when the registry knows them (fail-soft to the text fallback).
  if (destination === 'discord' && !item.mention) {
    const mention = await resolveAuthorMention(request, env, item, { fetchImpl, makeStripe, makeDiscord });
    if (mention) item = { ...item, mention };
  }

  const cfg = await readSyndicationConfig(kv);
  const text = renderTemplate(template, item, { limit: channelLimit(destination) });

  let result;
  let channelRecordKey = destination;
  if (destination === 'discord') {
    const channelId = String(payload?.channelId || '').trim();
    if (!/^\d{5,}$/.test(channelId)) return { status: 400, body: { error: 'invalid', message: 'a Discord channel id is required' } };
    if (!secretsPresent(env, 'discord')) return { status: 409, body: { error: 'not_configured', message: 'the Discord bot token is not configured' } };
    channelRecordKey = `discord:${channelId}`;
    try { result = await postDiscord(channelId, item, { env, fetchImpl, cfg, textOverride: text }); }
    catch (err) { result = { ok: false, error: err?.message || 'discord post failed' }; }
    // SOW-088: the optional SECONDARY destination — FORWARD the original post (the Discord forward, same as
    // the client UI's Forward action) to the category-mapped channel. Fail-soft: a forward miss never
    // un-sends the primary post; it is recorded separately.
    const forwardChannelId = String(payload?.forwardChannelId || '').trim();
    if (result?.ok && result.id && /^\d{5,}$/.test(forwardChannelId) && forwardChannelId !== channelId) {
      try {
        const discord = makeDiscord({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl });
        const fwd = await discord.forwardChannelMessage(forwardChannelId, { messageId: result.id, fromChannelId: channelId, guildId: env.DISCORD_GUILD_ID || null });
        result.forwarded = { channelId: forwardChannelId, id: fwd?.id ?? null };
      } catch (err) {
        result.forwarded = { channelId: forwardChannelId, error: err?.message || 'forward failed' };
      }
    }
  } else {
    if (!secretsPresent(env, destination)) return { status: 409, body: { error: 'not_configured', message: `${destination} is not configured (missing secrets)` } };
    const set = adapters ?? buildAdapters({ env, fetchImpl, cfg });
    const adapter = set[destination];
    if (!adapter) return { status: 400, body: { error: 'invalid', message: 'unknown destination' } };
    try { result = await adapter.post({ ...item, textOverride: text }); }
    catch (err) { result = { ok: false, error: err?.message || `${destination} post failed` }; }
  }

  // Tracker record: a terminal manual item (never in the pending index), so the syndication tracker and
  // the popup's prior-send warning both see it. The dedupe pointer is set only when absent so the CI
  // enqueue path still treats the item as already syndicated.
  const at = Number(now());
  const channelRecords = { [channelRecordKey]: result?.ok ? { status: 'sent', id: result.id ?? null, url: result.url ?? null, at } : { status: 'failed', error: result?.error || 'post failed', at } };
  if (result?.forwarded) {
    channelRecords[`discord-forward:${result.forwarded.channelId}`] = result.forwarded.error
      ? { status: 'failed', error: result.forwarded.error, at }
      : { status: 'sent', id: result.forwarded.id, url: null, at };
  }
  const recorded = {
    ...item,
    status: result?.ok && !result?.skipped ? 'sent' : 'failed',
    channels: channelRecords,
    sentAt: result?.ok ? at : null,
    manualBy: g.auth.githubId ?? null,
  };
  await putItem(kv, recorded);
  try {
    const dk = SYND_DEDUPE_KEY(dedupeKey(item));
    if (!(await kv.get(dk))) await kv.put(dk, item.id);
  } catch { /* dedupe is best-effort; the post already happened */ }

  if (!result?.ok) return { status: 502, body: { error: 'post_failed', message: result?.error || 'the destination refused the post', itemId: recorded.id } };
  return { status: 200, body: { ok: true, sent: true, destination, id: result.id ?? null, url: result.url ?? null, forwarded: result.forwarded ?? null, itemId: recorded.id, text } };
}
