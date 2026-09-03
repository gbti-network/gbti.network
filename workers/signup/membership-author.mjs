// SOW-156 (spike): POST /membership/author — hosted authoring. A paid member with NO fork and NO App
// install hands the Worker a set of own-folder files; the Worker validates them fail-closed (the pure
// membership/hosted-author.mjs wall), commits them to a per-member branch on the CANONICAL repo with
// GBTI's installation token, and opens the PR. The Worker NEVER merges: the SOW-005 gate stays the only
// merger, so even a validation bug lands as a rejected PR, not a merged write (defense in depth).
//
// The member's folder is resolved from house/members-index.yml read LIVE from canonical main by
// github_id — the SAME mapping the merge gate uses (classify-pr ownedFolderFor) — never from the
// current GitHub login, so a rename or case mismatch cannot mis-scope a write. A member with no index
// entry gets a clear 409 (folder not provisioned), exactly the fork path's behavior today.
//
// Everything is injectable (fetch, fetchUser, authorize, kv, signJwt, limiter) so it unit-tests with
// fakes: no network, no secrets.

import { githubFetchUser } from './oauth.mjs';
import { authorizeCreator, authorizePaid } from './membership-content.mjs'; // sow-301: paid gates the route, creator gates PUBLISHING
import { TIER, meetsTier } from '../../membership/tiers.mjs'; // sow-301
import { authorizeSuperadmin } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { rateLimit } from './abuse.mjs';
import { kickDispatch } from './checkout.mjs';
import { parseMembersIndex, validateHostedRequest, hostedBranchFor } from '../../membership/hosted-author.mjs';

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });

/** Standard base64 of a UTF-8 string, chunked (btoa on a spread blows the stack at ~100KB). */
function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function ghJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

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

/**
 * sow-293: is this file set a MEMBERS-ONLY share in the caller's own folder?
 *
 * Sharing opened up to every paid member, but PUBLIC sharing stays Content Creator only, so this is the
 * second exemption from the creator gate alongside isCommentOnly. It is a stricter check than that one,
 * because a share's visibility is not in its path: the answer lives in the frontmatter, and this function is
 * the only place that reads it.
 *
 * FAIL-CLOSED IN EVERY DIRECTION, and each clause is a way a public share could otherwise slip through as a
 * members-only one:
 *   - a non-array, an EMPTY set, or a malformed entry              -> false
 *   - ONE path outside `members/<folder>/shares/`                  -> false
 *   - a `.md` whose content is missing or not a string             -> false (we cannot read it, so we do not vouch)
 *   - a `.md` without a POSITIVE `visibility: members` frontmatter  -> false (absent is not members-only:
 *     the schema default for a share is `public`, so silence means public)
 *   - NO `.md` at all (an `.enc` on its own)                        -> false (nothing to check the visibility of)
 *
 * A members-only share is committed as a stub `.md` plus a sibling `.enc` holding the encrypted body
 * (SOW-016), so a two-file set is the normal case and the `.enc` carries no frontmatter to check.
 *
 * THE GATE THIS FEEDS IS THE WEBSITE'S, NOT THE LAST WORD. The PR gate reads changed PATHS only and cannot
 * see visibility, so it admits any share at Network Member tier (owner ruling 2026-09-03). A paying member
 * who hand-builds a pull request can therefore publish one public share without holding Content Creator.
 * That was weighed and accepted: it is a rule being bent by an authenticated member inside their own folder,
 * not an escalation, and closing it would mean either widening the gate beyond paths or migrating every
 * existing share into a visibility-named folder.
 *
 * Exported for tests: this decides who may publish publicly, so it must be assertable without a Worker.
 */
/**
 * sow-293: does this file set touch the caller's own shares/ folder at all?
 *
 * Deliberately SEPARATE from isMembersOnlyShare, which additionally reads the visibility. The slow mode must
 * key on "this is a share" and nothing else: if it reused the visibility check, then a future change to what
 * counts as members-only would silently change who is throttled, in the permissive direction, with nothing
 * reporting it. Two rules, two predicates.
 */
export function isShareSet(files, folder) {
  if (!Array.isArray(files) || files.length === 0) return false;
  if (typeof folder !== 'string' || !folder) return false;
  const prefix = `members/${folder}/shares/`;
  return files.some((f) => {
    const path = typeof f === 'string' ? f : f?.path;
    return typeof path === 'string' && path.startsWith(prefix) && !path.includes('..');
  });
}

/** sow-293: the per-member share slow mode. One share per six hours, members only, creators exempt. */
export const SHARE_SLOW_MODE_SECONDS = 6 * 60 * 60;

export function isMembersOnlyShare(files, folder) {
  if (!Array.isArray(files) || files.length === 0) return false;
  if (typeof folder !== 'string' || !folder) return false;
  const prefix = `members/${folder}/shares/`;
  let sawMarkdown = false;
  const allInFolder = files.every((f) => {
    const path = typeof f === 'string' ? f : f?.path;
    if (typeof path !== 'string' || !path.startsWith(prefix) || path.includes('..')) return false;
    if (!path.endsWith('.md')) return true; // the .enc sibling carries no frontmatter to judge
    sawMarkdown = true;
    const content = typeof f === 'string' ? null : f?.content;
    if (typeof content !== 'string') return false; // unreadable is not a licence to assume members-only
    return /^visibility:\s*["']?members["']?\s*$/m.test(content);
  });
  return allInFolder && sawMarkdown;
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

  // sow-301: the ROUTE requires effective-paid; PUBLISHING additionally requires Content Creator. The split
  // exists because commenting rides this same route (workbench-client posts `comment-<id>` here), and gating
  // both on creator silently blocked every paid Network Member from commenting. The creator rule is applied
  // BELOW, once the real file paths are known, because those are the only trustworthy signal of what the
  // request actually writes.
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
  const idx = await ghJson(fetchImpl, `${GH}/repos/${upstream}/contents/house/members-index.yml?ref=main`, { headers: GH_HEADERS(instToken) });
  if (!idx.res.ok) return { status: 502, body: { error: 'index_unavailable', message: 'could not read the member index' } };
  let indexText = '';
  try { indexText = atob(String(idx.data?.content || '').replace(/\n/g, '')); } catch { /* fail closed below */ }
  const folder = parseMembersIndex(indexText).get(githubId) ?? null;
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
    return { status: 409, body: { error: 'folder_not_provisioned', provisioning, message: 'your member folder is being provisioned — try publishing again in a few minutes' } };
  }

  // sow-183: a SUPERADMIN caller may target a file set outside their own folder (house/, or another
  // member's folder) for content authorship reassignment. Independently re-resolved (own fail-closed gate,
  // the same shape as authorizeAdmin/authorizeStaff/authorizeCurator) rather than trusted from the request
  // body -- a non-superadmin (or a failed re-check) gets allowAnyFolder=false and validateHostedRequest
  // falls back to the existing own-folder-only rule.
  const superadmin = await authorizeSuper(request, env, deps);
  const allowAnyFolder = superadmin.ok === true;

  const itemId = String(payload?.itemId ?? '');
  const check = validateHostedRequest({ files: payload?.files, itemId, folder, allowAnyFolder });
  if (!check.ok) return { status: check.status ?? 400, body: { error: 'bad_request', message: check.error } };
  // sow-301: PUBLISHING is creator-gated; COMMENTING is not. Decided from the resolved FILE PATHS, never from
  // `itemId`, which arrives in the request body: gating on a `comment-` prefix would let any paid caller
  // publish an article by naming it `comment-anything`. validateHostedRequest has already confirmed these
  // paths sit in the caller's own folder (or that a re-verified superadmin may target another), so by here the
  // paths are trustworthy. Fail-closed: an empty or MIXED set takes the stricter gate.
  // sow-293 adds the second exemption: a MEMBERS-ONLY share. Sharing opened to every paid member, but PUBLIC
  // sharing stays creator-only, and unlike a comment that distinction is not visible in the path, so
  // isMembersOnlyShare reads the frontmatter of the files the caller sent. Same fail-closed disposition as
  // isCommentOnly: anything it cannot positively confirm takes the stricter gate.
  if (!isCommentOnly(payload?.files, folder) && !isMembersOnlyShare(payload?.files, folder)) {
    if (!meetsTier(paid.tier, TIER.creator)) {
      const publicShare = String(payload?.itemId ?? '').startsWith('share-');
      return { status: 403, body: { error: 'forbidden', message: publicShare
        ? 'sharing publicly on gbti.network requires the Content Creator plan; post it to members only, or upgrade at https://gbti.network'
        : 'publishing on gbti.network requires the Content Creator plan; upgrade at https://gbti.network' } };
    }
  }

  // sow-293: the SLOW MODE. Sharing just opened to every paid member, which is a new spam surface, so a
  // Network Member posts at most one share per six hours. An approved Content Creator is exempt (owner
  // answer 4, 2026-08-29): they passed human review, which is what the throttle is a substitute for.
  //
  // THE EXEMPTION MUST NOT BECOME THE FAIL-OPEN, and this is the only interesting line here. meetsTier
  // returns FALSE for an absent or unresolvable tier, so a caller whose tier could not be determined is
  // THROTTLED rather than waved through. That is the safe direction and it is asserted in the tests, because
  // the natural refactor (`if (isCreator) skip`) inverts it silently the moment the tier lookup degrades.
  if (isShareSet(payload?.files, folder) && !meetsTier(paid.tier, TIER.creator)) {
    const slow = await limiter({ kv, id: githubId, limit: 1, windowSeconds: SHARE_SLOW_MODE_SECONDS, prefix: 'rl:share:' });
    if (!slow.allowed) {
      return { status: 429, body: { error: 'slow_mode', message: 'you can post one share every six hours; Content Creators are not limited' } };
    }
  }

  const branch = hostedBranchFor(githubId, itemId);
  if (!branch) return { status: 400, body: { error: 'bad_request', message: 'invalid itemId' } };

  // Fresh-base the branch on live main (create, or force-reset if it exists): each request carries the
  // item's full file set, so a reset never loses work, and stale-base conflicts (SOW-152) cannot occur.
  const main = await ghJson(fetchImpl, `${GH}/repos/${upstream}/git/ref/heads/main`, { headers: GH_HEADERS(instToken) });
  const mainSha = main.data?.object?.sha;
  if (!main.res.ok || !mainSha) return { status: 502, body: { error: 'git_failed', message: 'could not read the main branch' } };
  const create = await fetchImpl(`${GH}/repos/${upstream}/git/refs`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  });
  if (!create.ok) {
    if (create.status !== 422) return { status: 502, body: { error: 'git_failed', message: 'could not create the branch' } };
    const reset = await fetchImpl(`${GH}/repos/${upstream}/git/refs/heads/${branch}`, {
      method: 'PATCH', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: mainSha, force: true }),
    });
    if (!reset.ok) return { status: 502, body: { error: 'git_failed', message: 'could not reset the branch' } };
  }

  // Apply each file via the contents API on the branch. One retry on a 409 (concurrent sha race).
  for (const f of payload.files) {
    const applied = await applyFile(fetchImpl, instToken, upstream, branch, f);
    if (!applied.ok) return { status: 502, body: { error: 'git_failed', message: `could not write ${f.path}` } };
  }

  // Open the PR (canonical-head: head is just the branch name). The gate resolves the member from the
  // hosted/<github_id>/ ref, gates paid + own-folder, and auto-merges; the Worker never merges.
  const title = String(payload?.title || `Content update from ${folder}`).slice(0, 256);
  const body = `Hosted authoring: published on behalf of @${folder} (github_id ${githubId}) via the GBTI publishing app.`;
  const pr = await ghJson(fetchImpl, `${GH}/repos/${upstream}/pulls`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head: branch, base: 'main', body, maintainer_can_modify: false }),
  });
  if (pr.res.status === 422) return { status: 200, body: { ok: true, branch, number: null, html_url: null, already: true } };
  if (!pr.res.ok) return { status: 502, body: { error: 'open_pr_failed', message: `GitHub returned ${pr.res.status}` } };
  return { status: 200, body: { ok: true, branch, number: pr.data.number, html_url: pr.data.html_url } };
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
  const idx = await ghJson(fetchImpl, `${GH}/repos/${upstream}/contents/house/members-index.yml?ref=main`, { headers: GH_HEADERS(instToken) });
  if (!idx.res.ok) return { status: 502, body: { error: 'index_unavailable', message: 'could not read the member index' } };
  let indexText = '';
  try { indexText = atob(String(idx.data?.content || '').replace(/\n/g, '')); } catch { /* fail closed below: an empty map */ }
  const members = [...parseMembersIndex(indexText).entries()]
    .map(([githubId, username]) => ({ githubId, username }))
    .sort((a, b) => a.username.localeCompare(b.username));
  return { status: 200, body: { ok: true, members } };
}

/** PUT (or DELETE for content: null) one file on the branch; retries once on a 409 sha race. */
async function applyFile(fetchImpl, instToken, upstream, branch, f, attempt = 0) {
  const url = `${GH}/repos/${upstream}/contents/${f.path}`;
  const existing = await ghJson(fetchImpl, `${url}?ref=${encodeURIComponent(branch)}`, { headers: GH_HEADERS(instToken) });
  const sha = existing.res.ok ? existing.data?.sha : undefined;
  const isBinary = f.contentBase64 !== undefined && f.contentBase64 !== null;
  if (f.content === null && !isBinary) {
    if (!sha) return { ok: true, skipped: true }; // deleting a file that does not exist is a no-op
    const res = await fetchImpl(url, {
      method: 'DELETE', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `content: remove ${f.path}`, sha, branch }),
    });
    if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
    return { ok: res.ok };
  }
  // sow-158 image upload: a binary entry is ALREADY base64 (a raster image, validated own-folder + capped in
  // validateHostedRequest); the Contents API takes base64 bytes directly, so pass it through un-re-encoded. A
  // text entry base64-encodes its UTF-8 string as before.
  const encoded = isBinary ? String(f.contentBase64) : b64utf8(f.content);
  const res = await fetchImpl(url, {
    method: 'PUT', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `content: update ${f.path}`, content: encoded, branch, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
  return { ok: res.ok };
}
