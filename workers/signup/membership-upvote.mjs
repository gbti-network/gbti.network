// SOW-057: POST /membership/upvote — an EFFECTIVE-PAID member upvotes a share. Two writes:
//   1. the per-member upvote in the deletable activity store (activity:<github_id>, the same value favorites use)
//   2. the per-TARGET voter set (upvotes:share:<author>/<id>) that drives the visible upvote count
// SOW-087 RETIRED the upvote-threshold syndication trigger: a share now enqueues at PUBLISH time
// (scripts/enqueue-syndication.mjs, the same path as posts/products/prompts), so an upvote here only records
// the vote and the count. The historical enqueuedAt watermark on old vote records is preserved (read-only).
//
// Gating is authorizePaid (ban > staff > grandfather > Stripe, fail-closed) — stricter than favorites' bare
// authMember, because an upvote is member-only community signal. Pure over injected deps, so it is unit-tested
// with fakes (no network, no secrets).

import { applyUpvote, normalizeActivity, ActivityError } from '../../membership/member-activity.mjs';
import { authorizePaid } from './membership-content.mjs';
import { normalizeShareVotes, applyShareVote, distinctNonAuthorCount } from '../../membership/share-votes.mjs';
import { ACTIVITY_KEY } from './membership-activity.mjs';

export const SHARE_VOTES_KEY = (author, id) => `upvotes:share:${author}/${id}`;
const SHARE_SLUG_RE = /^([a-z0-9-]+)\/([a-z0-9-]+)$/;

/**
 * Read-modify-write the per-target voter set. `voterLogin` excludes the author's own vote (compared against the
 * <author> segment of the slug). SOW-087: no threshold enqueue anymore — a share syndicates at publish time; the
 * historical enqueuedAt watermark is surfaced read-only for response compatibility. PURE over the injected
 * kv/now, so it is unit-tested with fakes. Returns { count, enqueued }.
 */
export async function recordShareVote(env, { voterId, voterLogin, author, id, on }, {
  kv = env?.SIGNUP_KV,
  now = Date.now,
} = {}) {
  const key = SHARE_VOTES_KEY(author, id);
  let record = normalizeShareVotes(await kv.get(key, 'json'));
  const isAuthor = Boolean(voterLogin) && String(voterLogin).toLowerCase() === String(author).toLowerCase();
  record = applyShareVote(record, { voterId, authorId: isAuthor ? voterId : null, on }, { now });
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

  // 2. the per-target voter set (the visible count; syndication is publish-time now, SOW-087).
  const vote = await recordVote(env, { voterId: auth.githubId, voterLogin: auth.login, author, id, on }, { kv, now });

  const upvoted = activity.upvotes.some((u) => u.type === 'share' && u.slug === slug);
  return { status: 200, body: { ok: true, activity, upvoted, upvoteCount: vote.count, enqueued: vote.enqueued } };
}
