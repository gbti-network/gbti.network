// SOW-046 D: reflect a news DISCUSSION back onto its Discord post. When a member starts discussing a news item
// that a curator already posted to Discord (a news-posted:<guid> record exists), this appends a one-time notice
// ("members are discussing this") to that Discord message, so the channel learns the conversation has started.
//
//   POST /membership/news-discussed { guid } -> { ok, reflected }   (effective-paid; any member who can comment)
//
// Idempotent: the notice is appended ONCE (guarded by `discussionNoticedAt` on the dedupe record). If the item was
// never posted to Discord (no record), or Discord is unconfigured, it is a clean no-op (reflected:false), never an
// error. The Discord bot token never leaves the Worker. Pure over injected authorize/discord/kv/now.

import { authorizePaid } from './membership-content.mjs';
import { NEWS_POSTED_KEY } from './membership-news-publish.mjs';
import { createDiscordClient } from '../../clients/discord.mjs';

const NOTICE = '\n\n💬 Members are discussing this in the GBTI extension.';

/** POST /membership/news-discussed { guid } -> appends the discussion notice to the news item's Discord post once. */
export async function membershipNewsDiscussed(request, env, { authorize = authorizePaid, fetch = globalThis.fetch, kv = env?.SIGNUP_KV, discord = null, now = () => new Date().toISOString() } = {}) {
  const auth = await authorize(request, env);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the dedupe store is not configured' } };

  let req;
  try { req = await request.json(); } catch { req = null; }
  const guid = String(req?.guid || '').trim();
  if (!guid) return { status: 400, body: { error: 'bad_request', message: 'a news item guid is required' } };

  const record = await kv.get(NEWS_POSTED_KEY(guid), 'json');
  // Not posted to Discord (or no channel/message) -> nothing to reflect; a clean no-op, not an error.
  if (!record || !record.channelId || !record.messageId) return { status: 200, body: { ok: true, reflected: false, reason: 'not posted to Discord' } };
  if (record.discussionNoticedAt) return { status: 200, body: { ok: true, reflected: false, already: true } };

  if (!env.DISCORD_BOT_TOKEN) return { status: 200, body: { ok: true, reflected: false, reason: 'Discord is not configured' } };
  const client = discord || createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch });
  const base = typeof record.content === 'string' ? record.content : '';
  try { await client.editChannelMessage(record.channelId, record.messageId, `${base}${NOTICE}`); }
  catch { return { status: 502, body: { error: 'discord_failed', message: 'could not update the Discord post' } }; }

  await kv.put(NEWS_POSTED_KEY(guid), JSON.stringify({ ...record, discussionNoticedAt: now() }));
  return { status: 200, body: { ok: true, reflected: true } };
}
