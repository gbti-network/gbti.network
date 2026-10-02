// sow-171: the record behind the extension's "Share to our channels" panel on a news story (SUPERADMIN only).
//   GET  /membership/news-share?guid=&category=  -> { ok, discord, channels }   where the story has already gone
//   POST /membership/news-share { guid, channel, title, url, text, commentText?, category? }
//                                                -> { ok, task }               "Mark done" for one hand-made post
// A hand-made post is recorded as a DONE Social Queue task (source 'news', trigger 'manual'), so it lists under
// Manual done beside every other post made by hand, can be deleted there, and every superadmin's panel shows the
// channel as posted. Nothing is posted from here: the superadmin posts on the site itself, and Discord posts through
// /membership/news-publish. Same gate as the Social Queue (the overrides mirror plus the superadmin role, fail
// closed). Pure over injected deps; unit-tested with a fake KV.

import { authorizeAdmin } from './membership-admin.mjs';
import { ROLE, roleLoginsFromParsed } from '../../membership/overrides-core.mjs';
import { channelForCategory } from '../../membership/news-channels.mjs';
import { NEWS_SHARE_CHANNELS, newsShareDoneTask, newsShareTaskId } from '../../membership/news-share.mjs';
// The task is read straight from KV (not getTask, which turns a failed read into null) so a store outage is reported
// as an error rather than as "not posted anywhere".
import { putTask, SOCIAL_TASK_KEY } from './social-queue-store.mjs';
import { NEWS_POSTED_KEY } from './membership-news-publish.mjs';

async function gate(request, env, { fetchImpl, authorize }) {
  const auth = await authorize(request, env, { fetchImpl });
  if (!auth.ok) return { deny: { status: auth.status ?? 403, body: auth.body ?? { error: 'forbidden' } } };
  if (auth.role !== ROLE.superadmin) return { deny: { status: 403, body: { error: 'forbidden', message: 'superadmin access is required to share news to our channels' } } };
  return { auth };
}

function newsChannels(env) {
  try { return env?.NEWS_CHANNELS ? JSON.parse(env.NEWS_CHANNELS) : null; } catch { return null; }
}

// The login to show beside a post ("Marked done by atwellpub"). authorizeAdmin returns no login, so it is read from
// the roles section of the mirror the gate already read. Best effort: a miss leaves null.
function actorLogin(auth) {
  try { return roleLoginsFromParsed(auth?.mirror?.roles).get(String(auth?.githubId)) ?? null; } catch { return null; }
}

const doneView = (t) => (t && t.status === 'done' ? { doneAt: t.doneAt ?? null, doneBy: t.doneByLogin ?? null } : null);

/** GET: where this story has already gone. A failed KV read is an error, never an empty "nothing posted". */
export async function handleNewsShareGet(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, fetchImpl = globalThis.fetch, authorize = authorizeAdmin } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the share record store is not configured' } };
  const { deny } = await gate(request, env, { fetchImpl, authorize });
  if (deny) return deny;
  const url = new URL(request.url);
  const guid = String(url.searchParams.get('guid') || '').trim();
  if (!guid) return { status: 400, body: { error: 'bad_request', message: 'a news story guid is required' } };
  const category = String(url.searchParams.get('category') || '').trim();
  let posted;
  const channels = {};
  try {
    posted = await kv.get(NEWS_POSTED_KEY(guid), 'json');
    for (const ch of NEWS_SHARE_CHANNELS) channels[ch] = doneView(await kv.get(SOCIAL_TASK_KEY(newsShareTaskId(guid, ch)), 'json'));
  } catch {
    return { status: 503, body: { error: 'unavailable', message: 'could not read where this story has been posted' } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      discord: {
        posted: Boolean(posted),
        postedAt: posted?.postedAt ?? null,
        channelId: posted?.channelId ?? null,
        // The channel the story's category maps to, so the picker can start there ("Other" maps to none).
        mappedChannelId: category ? channelForCategory(newsChannels(env), category) : null,
      },
      channels,
    },
  };
}

/** POST: "Mark done" for one hand-made post. Marking the same channel again overwrites its record. */
export async function handleNewsShareDone(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now, fetchImpl = globalThis.fetch, authorize = authorizeAdmin } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the share record store is not configured' } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  const { auth, deny } = await gate(request, env, { fetchImpl, authorize });
  if (deny) return deny;
  let body;
  try { body = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const r = newsShareDoneTask(body, { actor: { githubId: auth.githubId, login: actorLogin(auth) }, now: Number(now()) });
  if (!r.ok) return { status: 400, body: { error: 'invalid', message: r.message } };
  await putTask(kv, r.task);
  return { status: 200, body: { ok: true, channel: r.task.channel, done: doneView(r.task), task: { id: r.task.id } } };
}
