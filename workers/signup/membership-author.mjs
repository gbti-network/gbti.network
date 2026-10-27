// SOW-156 (spike): POST /membership/author — hosted authoring. A paid member with NO fork and NO App
// install hands the Worker a set of own-folder files; the Worker validates them fail-closed (the pure
// membership/hosted-author.mjs wall), commits them to a per-member branch on the CANONICAL repo with
// GBTI's installation token, and opens the PR. The Worker NEVER merges: the SOW-005 gate stays the only
// merger, so even a validation bug lands as a rejected PR, not a merged write (defense in depth).
//
// The member's folder is resolved from house/members-index.yml read LIVE from canonical main by
// github_id — the SAME mapping the merge gate uses (classify-pr ownedFolderFor) — never from the
// current GitHub login, so a rename or case mismatch cannot mis-scope a write. A member with no index
// entry gets a clear 409 (folder not provisioned).
//
// Everything is injectable (fetch, fetchUser, authorize, kv, signJwt, limiter) so it unit-tests with
// fakes: no network, no secrets.

import { githubFetchUser } from './oauth.mjs';
import { authorizePaid } from './membership-content.mjs'; // sow-301: paid gates the route
import { authorizeSuperadmin } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { rateLimit } from './abuse.mjs';
import { kickDispatch } from './checkout.mjs';
import { newItemsOnMain } from './new-item-alert.mjs'; // sow-458: which items of a publish are new (the owner is emailed)
import { validateHostedRequest, hostedBranchFor, contentItemsIn } from '../../membership/hosted-author.mjs';
// sow-427 C1: the members-index read and the branch + commit + pull request tail live in hosted-commit.mjs, moved
// there unchanged so the prepared-listing claim commits through the same path.
import { readMembersIndex, commitHostedFiles } from './hosted-commit.mjs';
import { readTopicsVocab } from './topic-suggest.mjs'; // the share category must be a real topic
import { resolveAudioEntries } from './hosted-audio.mjs'; // sow-483: recordings travel by reference

/**
 * sow-301: is this file set ENTIRELY comments in the caller's own folder?
 *
 * Fail-closed by construction: a non-array, an EMPTY set, a malformed entry, or ONE path outside
 * `members/<folder>/comments/` all return false, which sends the request to the stricter creator gate. The
 * caller's `folder` is resolved server-side from the members index, never taken from the payload.
 *
 * Exported for tests: the escalation case (a `comment-` itemId carrying an article path) is the reason this
 * is path-based, and it must be assertable without standing up a Worker.
 */
export function isCommentOnly(files, folder) {
  if (!Array.isArray(files) || files.length === 0) return false;
  if (typeof folder !== 'string' || !folder) return false;
  const prefix = `members/${folder}/comments/`;
  return files.every((f) => {
    const path = typeof f === 'string' ? f : f?.path;
    return typeof path === 'string' && path.startsWith(prefix) && !path.includes('..');
  });
}

export async function membershipAuthor(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, authorize = authorizePaid,
    authorizeSuper = authorizeSuperadmin, kv = env?.SIGNUP_KV, limiter = rateLimit,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;

  if (env?.MEMBERSHIP_AUTHOR_ENABLED !== 'true') {
    return { status: 403, body: { error: 'author_disabled', message: 'hosted authoring is not enabled' } };
  }

  // sow-301: the ROUTE requires effective-paid. sow-458 (2026-10-16): that is now the whole publishing rule; the
  // creator gate (sow-301) and then the audience rule (sow-323) that once applied below are both retired, so a comment
  // and an article publish alike for a paid member.
  const paid = await authorize(request, env, deps); // fail-closed: only paid members reach this route (SOW-011)
  if (!paid.ok) return { status: paid.status, body: paid.body };

  // Identity re-check: the branch name carries the github_id the gate trusts, so it is ALWAYS the verified id,
  // never anything from the request body. sow-158 Phase 3a: a website (cookie) caller already carries the
  // HMAC-verified github_id in the signed session (identity.mjs) and holds no bearer token, so the token
  // re-check is skipped for it; the bearer path (extension/npm) keeps its re-verification unchanged.
  let githubId = String(paid.githubId ?? '');
  if (paid.via !== 'cookie') {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    let user;
    try { user = await fetchUser(token, fetchImpl); } catch { return { status: 401, body: { error: 'unauthorized' } }; }
    const bearerId = String(user?.githubId ?? '');
    if (!bearerId || bearerId !== githubId) {
      return { status: 401, body: { error: 'unauthorized', message: 'could not verify the member identity' } };
    }
  }
  if (!githubId) return { status: 401, body: { error: 'unauthorized', message: 'could not verify the member identity' } };

  const rl = await limiter({ kv, ip: githubId, limit: 10, windowSeconds: 600, prefix: 'rl:author:' });
  if (!rl.allowed) return { status: 429, body: { error: 'rate_limited', message: 'too many publish requests; try again in a few minutes' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }

  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }

  // Resolve the member's folder from the LIVE members-index on canonical main (what the gate reads).
  const idx = await readMembersIndex({ fetchImpl, instToken, upstream });
  if (!idx.ok) return { status: 502, body: { error: 'index_unavailable', message: 'could not read the member index' } };
  const folder = idx.map.get(githubId) ?? null; // an undecodable index parses to an empty map: fail closed below
  if (!folder) {
    // SOW-157: this caller is a VERIFIED effective-paid member missing only their index entry, so fire the
    // 'enroll' repository_dispatch (the reconcile writes + merges the entry within minutes) — rate-limited
    // to one nudge per hour per member; the daily reconcile sweep heals any missed dispatch. Fail soft.
    const { dispatch = kickDispatch } = deps;
    const enrollRl = await limiter({ kv, ip: githubId, limit: 1, windowSeconds: 3600, prefix: 'rl:enroll:' });
    let provisioning = false;
    if (enrollRl.allowed) {
      provisioning = await dispatch({
        eventType: 'enroll', githubId,
        dispatchToken: env?.REGATE_DISPATCH_TOKEN, contentRepo: env?.GITHUB_CONTENT_REPO || upstream,
      }, fetchImpl);
    }
    return { status: 409, body: { error: 'folder_not_provisioned', provisioning, message: 'your member folder is being provisioned; try publishing again in a few minutes' } };
  }

  // sow-183: a SUPERADMIN caller may target a file set outside their own folder (house/, or another
  // member's folder) for content authorship reassignment. Independently re-resolved (own fail-closed gate,
  // the same shape as authorizeAdmin/authorizeStaff/authorizeNewsEditor) rather than trusted from the request
  // body -- a non-superadmin (or a failed re-check) gets allowAnyFolder=false and validateHostedRequest
  // falls back to the existing own-folder-only rule.
  const superadmin = await authorizeSuper(request, env, deps);
  const allowAnyFolder = superadmin.ok === true;

  const itemId = String(payload?.itemId ?? '');
  // The topic list is read only when a share is in the request. An unreadable mirror gives no keys, and the
  // category is then checked for presence alone (validate-content still checks the key in CI).
  const hasShare = Array.isArray(payload?.files) && payload.files.some((f) => /\/shares\/[^/]+\.md$/.test(String(f?.path ?? '')));
  const topicKeys = hasShare && kv ? Object.keys(await readTopicsVocab(kv)) : null;
  const check = validateHostedRequest({ files: payload?.files, itemId, folder, allowAnyFolder, topicKeys });
  if (!check.ok) return { status: check.status ?? 400, body: { error: 'bad_request', message: check.error } };
  // sow-458 (owner, 2026-10-16): "It is published when the person publishes it." Editorial review is retired: no
  // audience rule refuses a public item and no review record is written. Who may publish at all is unchanged (paid,
  // own folder, checked above and again by the gate). What remains is telling the owner when a member CREATES an
  // article, project, prompt or share, which is asked of main while the files are committed: an item whose path,
  // and every path it had before a rename, is absent from main is new. A superadmin's own items are not mailed
  // (owner's answer, same day).
  const createdCheck = allowAnyFolder ? Promise.resolve([]) : newItemsOnMain({
    fetchImpl, instToken, upstream,
    items: contentItemsIn(payload?.files, folder).map((item) => ({ ...item, login: folder })),
  }).catch(() => []);

  const branch = hostedBranchFor(githubId, itemId);
  if (!branch) return { status: 400, body: { error: 'bad_request', message: 'invalid itemId' } };

  // sow-427 C1: the fresh-based branch, the per-file writes and the pull request are commitHostedFiles
  // (hosted-commit.mjs), moved there unchanged. The pull request opens canonical-head (head is just the branch
  // name); the gate resolves the member from the hosted/<github_id>/ ref, gates paid + own-folder, and
  // auto-merges; the Worker never merges.
  const title = String(payload?.title || `Content update from ${folder}`).slice(0, 256);
  // sow-428: the folder is a GBTI name, not necessarily a GitHub login, so it is never written as an @mention: a
  // member named `mike-conley` would otherwise ping whichever stranger owns that GitHub account.
  const body = `Hosted authoring: published on behalf of ${folder} (github_id ${githubId}) via the GBTI publishing app.`;
  // sow-483: a recording travels by reference. Its bytes are read here, from the caller's OWN staged copy (keyed by the
  // verified githubId, never the payload) or, for an item that moved, from main, so the request never carries them.
  const audio = await resolveAudioEntries({ files: payload.files, kv, githubId, fetchImpl, instToken, upstream });
  if (!audio.ok) return { status: audio.status, body: { error: 'audio_unavailable', message: audio.message } };
  const committed = await commitHostedFiles({ fetchImpl, instToken, upstream, branch, files: audio.files, title, body });
  if (!committed.ok) return { status: committed.status, body: { error: committed.error, message: committed.message } };
  const created = await createdCheck;
  if (committed.already) {
    // An identical publish of an open item: the first one was mailed, so this one is not.
    return { status: 200, body: { ok: true, branch, number: null, html_url: null, already: true }, created: [] };
  }
  // `created` is returned alongside the body, never inside it: the caller sends the owner notice through
  // ctx.waitUntil, so a fail-soft email never delays the response the member is waiting on.
  return { status: 200, body: { ok: true, branch, number: committed.number, html_url: committed.html_url }, created };
}

// sow-183: GET /membership/author/targets — superadmin-only, the picker source for the shared editor's Author
// field (content authorship reassignment). Reads the SAME live house/members-index.yml as membershipAuthor
// (never a directory-filtered or opt-in-only list, unlike the public /members-index.json), so every real member
// folder is a valid reassignment target regardless of profile visibility. House is not listed here; the editor
// adds its own fixed "House / GBTI Network" option (it is not a members-index entry).
export async function membershipAuthorTargets(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorizeSuper = authorizeSuperadmin,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  if (env?.MEMBERSHIP_AUTHOR_ENABLED !== 'true') {
    return { status: 403, body: { error: 'author_disabled', message: 'hosted authoring is not enabled' } };
  }
  const superadmin = await authorizeSuper(request, env, deps);
  if (!superadmin.ok) return { status: superadmin.status, body: superadmin.body };

  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const idx = await readMembersIndex({ fetchImpl, instToken, upstream }); // an undecodable index is an empty map
  if (!idx.ok) return { status: 502, body: { error: 'index_unavailable', message: 'could not read the member index' } };
  const members = [...idx.map.entries()]
    .map(([githubId, username]) => ({ githubId, username }))
    .sort((a, b) => a.username.localeCompare(b.username));
  return { status: 200, body: { ok: true, members } };
}
