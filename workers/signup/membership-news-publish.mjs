// SOW-046 C: publish a members-only news item to its mapped Discord channel. CURATOR-gated (admin/superadmin OR
// an explicit roles.yml `curators:` listing, checked server-side from the KV overrides mirror — never trusted from
// the client). The Discord bot token lives ONLY in this Worker. Posts ONCE, deduped on the news `guid`
// (news-posted:<guid> in SIGNUP_KV -> { channelId, messageId }), so repeat clicks / multiple curators never repost.
//
// The client supplies ONLY a guid (+ a source hint to widen the lookup). The Worker resolves the CANONICAL item
// from the upstream news feed server-side and posts THAT metadata (title/link/source) and routes on THAT category,
// so a curator cannot post fabricated metadata or route an item to a wrong channel by lying about its fields
// (adversarial review finding, SOW-046 C). A guid not in the current feed window -> fail closed (nothing posted).
// The category->channel map is env.NEWS_CHANNELS (JSON of house/news-channels.yml's shape, owner-provisioned);
// an unmapped category also fails CLOSED. Pure over injected authorize/findItem/discord/kv/now.
//
// SOW-111: the resolve -> route -> post -> record core is extracted as postNewsItemOnce so the ENGAGEMENT
// signals (a member's first comment via membership-news-discussed.mjs, the detail-open threshold via
// membership-news-opened.mjs) share the exact same canonical resolution, routing, and guid dedupe. Engagement
// callers stamp `by: 'auto:comment' | 'auto:open'` (no member id on the record = no new erasure surface).

import { authorizeCurator } from './membership-admin.mjs';
import { findNewsItemByGuid } from './membership-news.mjs';
import { channelForCategory } from '../../membership/news-channels.mjs';
import { createDiscordClient } from '../../clients/discord.mjs';

export const NEWS_POSTED_KEY = (guid) => `news-posted:${String(guid).slice(0, 480)}`;

function channelMap(env) {
  try { return env.NEWS_CHANNELS ? JSON.parse(env.NEWS_CHANNELS) : null; } catch { return null; }
}

/** A safe, ping-free Discord post for a CANONICAL news item (the Discord client also defaults allowed_mentions to
 *  `{ parse: [] }`, so no @everyone/@here/role/user mention in any field is ever parsed). */
function formatPost(item) {
  const title = String(item?.title || 'News').slice(0, 280);
  const link = String(item?.link || '').slice(0, 500);
  const source = item?.source ? String(item.source).slice(0, 80) : '';
  return `📰 **${title}**${source ? `\n_via ${source}_` : ''}${link ? `\n${link}` : ''}`;
}

/**
 * SOW-111: post one news item to its category-mapped Discord channel EXACTLY ONCE. The shared core behind the
 * curator publish and both engagement signals. Every outcome is a plain result object (the HTTP handler maps
 * them to statuses):
 *   { ok:true,  posted:false, alreadyPosted:true, channelId, messageId }   guid already posted (dedupe)
 *   { ok:false, reason:'not_found' }                                        guid not in the current feed window
 *   { ok:true,  posted:false, reason:'unmapped' }                           no channel mapped for the category
 *   { ok:false, reason:'discord_unavailable' | 'discord_failed' }           bot not configured / post failed
 *   { ok:true,  posted:true,  channelId, messageId, record }                posted + recorded
 */
export async function postNewsItemOnce(env, { guid, source, by } = {}, {
  kv = env?.SIGNUP_KV,
  fetch = globalThis.fetch,
  discord = null,
  findItem = findNewsItemByGuid,
  now = () => new Date().toISOString(),
} = {}) {
  const g = String(guid || '').trim();
  if (!g || !kv) return { ok: false, reason: 'not_found' };

  // Dedupe FIRST: if this guid was already posted, never post again (idempotent across all triggers).
  const existing = await kv.get(NEWS_POSTED_KEY(g), 'json');
  if (existing) return { ok: true, posted: false, alreadyPosted: true, channelId: existing.channelId ?? null, messageId: existing.messageId ?? null };

  // Resolve the CANONICAL item from the upstream feed; client-supplied fields are NOT trusted. A guid not in
  // the current feed window fails closed (nothing can be posted that is not verifiably in the feed).
  const item = await findItem(env, { guid: g, source: source || undefined, fetch });
  if (!item) return { ok: false, reason: 'not_found' };

  const channelId = channelForCategory(channelMap(env), item.category);
  if (!channelId) return { ok: true, posted: false, reason: 'unmapped' };

  if (!env.DISCORD_BOT_TOKEN) return { ok: false, reason: 'discord_unavailable' };
  const client = discord || createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch });
  const content = formatPost(item);
  let msg;
  try { msg = await client.postChannelMessage(channelId, content); }
  catch { return { ok: false, reason: 'discord_failed' }; }

  // Store the posted content so the SOW-046 D discussion-reflect can re-edit it (a Discord edit replaces the
  // whole message; the notice is appended to this stored body).
  const record = { channelId, messageId: msg?.id ?? null, postedAt: now(), by: by ?? null, guid: g, category: item.category ?? null, content };
  await kv.put(NEWS_POSTED_KEY(g), JSON.stringify(record));
  return { ok: true, posted: true, channelId: record.channelId, messageId: record.messageId, record };
}

/** POST /membership/news-publish { guid, source? } -> resolves the canonical item + posts to its mapped channel once. */
export async function membershipNewsPublish(request, env, { authorize = authorizeCurator, findItem = findNewsItemByGuid, fetch = globalThis.fetch, kv = env?.SIGNUP_KV, discord = null, now = () => new Date().toISOString() } = {}) {
  const auth = await authorize(request, env);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the dedupe store is not configured' } };

  let req;
  try { req = await request.json(); } catch { req = null; }
  const guid = String(req?.guid || '').trim();
  const sourceHint = req?.source ? String(req.source) : undefined;
  if (!guid) return { status: 400, body: { error: 'bad_request', message: 'a news item guid is required' } };

  const r = await postNewsItemOnce(env, { guid, source: sourceHint, by: auth.githubId }, { kv, fetch, discord, findItem, now });
  if (r.ok && r.alreadyPosted) return { status: 200, body: { ok: true, posted: false, alreadyPosted: true, channelId: r.channelId, messageId: r.messageId } };
  if (!r.ok && r.reason === 'not_found') return { status: 404, body: { error: 'not_found', message: 'this news item is not in the current feed (cannot be verified)' } };
  if (r.ok && r.reason === 'unmapped') return { status: 200, body: { ok: true, posted: false, reason: 'no Discord channel is mapped for this category' } };
  if (!r.ok && r.reason === 'discord_unavailable') return { status: 502, body: { error: 'discord_unavailable', message: 'Discord is not configured' } };
  if (!r.ok) return { status: 502, body: { error: 'discord_failed', message: 'could not post to Discord' } };
  return { status: 200, body: { ok: true, posted: true, channelId: r.channelId, messageId: r.messageId } };
}
