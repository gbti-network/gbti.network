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

  // Dedupe FIRST: if this guid was already posted, never post again (idempotent for repeat clicks / curators).
  const existing = await kv.get(NEWS_POSTED_KEY(guid), 'json');
  if (existing) return { status: 200, body: { ok: true, posted: false, alreadyPosted: true, channelId: existing.channelId ?? null, messageId: existing.messageId ?? null } };

  // Resolve the CANONICAL item from the upstream feed; the client-supplied title/link/source/category are NOT
  // trusted. A guid not in the current feed window fails closed (a curator cannot post an item that is not in the feed).
  const item = await findItem(env, { guid, source: sourceHint, fetch });
  if (!item) return { status: 404, body: { error: 'not_found', message: 'this news item is not in the current feed (cannot be verified)' } };

  const channelId = channelForCategory(channelMap(env), item.category);
  if (!channelId) return { status: 200, body: { ok: true, posted: false, reason: 'no Discord channel is mapped for this category' } };

  if (!env.DISCORD_BOT_TOKEN) return { status: 502, body: { error: 'discord_unavailable', message: 'Discord is not configured' } };
  const client = discord || createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch });
  let msg;
  try { msg = await client.postChannelMessage(channelId, formatPost(item)); }
  catch { return { status: 502, body: { error: 'discord_failed', message: 'could not post to Discord' } }; }

  const record = { channelId, messageId: msg?.id ?? null, postedAt: now(), by: auth.githubId, guid, category: item.category ?? null };
  await kv.put(NEWS_POSTED_KEY(guid), JSON.stringify(record));
  return { status: 200, body: { ok: true, posted: true, channelId: record.channelId, messageId: record.messageId } };
}
