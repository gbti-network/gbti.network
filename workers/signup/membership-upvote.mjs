// SOW-057: POST /membership/upvote — an EFFECTIVE-PAID member upvotes a share. Two writes:
//   1. the per-member upvote in the deletable activity store (activity:<github_id>, the same value favorites use)
//   2. the per-TARGET voter set (upvotes:share:<author>/<id>) that drives the syndication threshold
// When the distinct non-author voter count crosses the configured threshold, the share is ENQUEUED into the
// SOW-058 syndication queue (idempotent by the enqueuedAt watermark). The share's syndication metadata is read
// from the CANONICAL public file (never trusted from the client). The key never leaves the Worker; nothing here
// reaches git.
//
// Gating is authorizePaid (ban > staff > grandfather > Stripe, fail-closed) — stricter than favorites' bare
// authMember, because an upvote drives brand-account reach. Pure over injected deps, so it is unit-tested with
// fakes (no network, no secrets).

import { applyUpvote, normalizeActivity, ActivityError } from '../../membership/member-activity.mjs';
import { authorizePaid } from './membership-content.mjs';
import {
  normalizeShareVotes, applyShareVote, distinctNonAuthorCount, shouldEnqueue, markEnqueued,
} from '../../membership/share-votes.mjs';
import { enqueue as storeEnqueue, readSyndicationConfig } from './syndication-store.mjs';
import { upvoteThreshold, isSyndicationEnabled } from '../../membership/syndication-config.mjs';
import { ACTIVITY_KEY } from './membership-activity.mjs';

export const SHARE_VOTES_KEY = (author, id) => `upvotes:share:${author}/${id}`;
const SHARE_SLUG_RE = /^([a-z0-9-]+)\/([a-z0-9-]+)$/;

// ---- canonical share metadata (read from the PUBLIC repo file, never the client) ----

function frontmatterBlock(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}
function fmScalar(fm, key) {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm'));
  if (!m) return null;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v || null;
}

/** Fetch + parse the canonical share file's syndication-relevant frontmatter. Returns null on any failure. */
export async function fetchShareMeta(env, author, id, { fetchImpl = globalThis.fetch } = {}) {
  const repo = env?.GITHUB_CONTENT_REPO;
  if (!repo) return null;
  const url = `https://raw.githubusercontent.com/${repo}/main/members/${author}/shares/${id}.md`;
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'text/plain' }, cf: { cacheTtl: 60, cacheEverything: true } });
    if (!res || !res.ok) return null;
    const fm = frontmatterBlock(await res.text());
    if (!fm) return null;
    return {
      title: fmScalar(fm, 'title'),
      blurb: fmScalar(fm, 'shortDescription'),
      url: fmScalar(fm, 'url'),
      image: fmScalar(fm, 'image'),
      visibility: fmScalar(fm, 'visibility') || 'members',
      status: fmScalar(fm, 'status') || 'draft',
    };
  } catch {
    return null;
  }
}

/**
 * Read-modify-write the per-target voter set and, when the threshold trips, enqueue the share for syndication.
 * `voterLogin` excludes the author's own vote (compared against the <author> segment of the slug). PURE over the
 * injected kv/now/enqueueImpl/resolveShareMeta, so it is unit-tested with fakes. Returns { count, enqueued }.
 */
export async function recordShareVote(env, { voterId, voterLogin, author, id, on }, {
  kv = env?.SIGNUP_KV,
  now = Date.now,
  cfg = null,
  enqueueImpl = storeEnqueue,
  resolveShareMeta = (a, i) => fetchShareMeta(env, a, i, {}),
} = {}) {
  const key = SHARE_VOTES_KEY(author, id);
  let record = normalizeShareVotes(await kv.get(key, 'json'));
  const isAuthor = Boolean(voterLogin) && String(voterLogin).toLowerCase() === String(author).toLowerCase();
  record = applyShareVote(record, { voterId, authorId: isAuthor ? voterId : null, on }, { now });

  const config = cfg ?? (await readSyndicationConfig(kv));
  if (on && record.enqueuedAt == null && isSyndicationEnabled(config) && shouldEnqueue(record, upvoteThreshold(config))) {
    const meta = await resolveShareMeta(author, id);
    if (meta && meta.status === 'published') {
      if (meta.url) {
        await enqueueImpl(env, {
          source: 'share',
          targetType: 'share',
          targetSlug: `${author}/${id}`,
          author,
          title: meta.title,
          blurb: meta.blurb,
          url: meta.url,
          image: meta.image,
          visibility: meta.visibility,
          trigger: 'upvote-threshold',
        }, { kv, now, cfg: config });
      }
      // Whether or not there was a URL to post, the threshold has been honored: stamp the watermark so a
      // urless share (nothing to syndicate) does not re-attempt on every subsequent vote.
      record = markEnqueued(record, { now });
    }
    // meta null (resolve failed) or not yet published: leave unstamped so a later vote can retry.
  }

  await kv.put(key, JSON.stringify(record));
  return { count: distinctNonAuthorCount(record), enqueued: record.enqueuedAt != null };
}

export async function handleUpvote(request, env, {
  fetchImpl = globalThis.fetch,
  kv = env?.SIGNUP_KV,
  now = Date.now,
  recordVote = recordShareVote,
  authorize = authorizePaid,
  authDeps = {},
} = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the activity store is not configured' } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  // Paid gate (ban-aware, fail-closed). Returns githubId + login.
  const auth = await authorize(request, env, { fetchImpl, ...authDeps });
  if (!auth.ok) return auth;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } };
  }

  const type = payload?.type || 'share';
  const slug = String(payload?.slug || '');
  const on = payload?.on !== false; // default true
  if (type !== 'share') return { status: 400, body: { error: 'invalid', message: 'only share upvotes are supported' } };
  const m = SHARE_SLUG_RE.exec(slug);
  if (!m) return { status: 400, body: { error: 'invalid', message: 'a share slug is "<author>/<id>"' } };
  const [, author, id] = m;

  // 1. the per-member upvote (deletable activity store).
  const aKey = ACTIVITY_KEY(auth.githubId);
  let activity;
  try {
    activity = applyUpvote(normalizeActivity(await kv.get(aKey, 'json')), { type: 'share', slug, on }, { now });
  } catch (err) {
    if (err instanceof ActivityError) return { status: 400, body: { error: 'invalid', message: err.message } };
    throw err;
  }
  await kv.put(aKey, JSON.stringify(activity));

  // 2. the per-target voter set + threshold enqueue.
  const vote = await recordVote(env, { voterId: auth.githubId, voterLogin: auth.login, author, id, on }, { kv, now });

  const upvoted = activity.upvotes.some((u) => u.type === 'share' && u.slug === slug);
  return { status: 200, body: { ok: true, activity, upvoted, upvoteCount: vote.count, enqueued: vote.enqueued } };
}
