// sow-427 C1: the GitHub half of hosted authoring, moved out of membership-author.mjs WITHOUT A BEHAVIOUR CHANGE so a
// second caller can commit through the same path. membershipAuthor (POST /membership/author) and the prepared-listing
// claim (membership-claim.mjs) both commit a validated, own-folder file set to a `hosted/<github_id>/<itemId>` branch
// on the CANONICAL repository with GBTI's installation token, and open the pull request. Neither merges: the SOW-005
// gate stays the only merger, so even a validation bug lands as a rejected pull request, not a merged write.
//
// What moved, unchanged: the members-index read (the folder is the entry for the verified account number, never the
// login, which is also what the gate's ownedFolderFor reads), the per-file Contents API writes with their one retry on
// a 409 sha race, the fresh-based branch (create, or force-reset onto main), and the pull request with its 422
// "already open" answer. test/membership-author.test.mjs passes unmodified against this module, and the export list
// of membership-author.mjs is identical before and after the move.
//
// What is new here, used only by the claim: readRepoText (does members/<folder>/profile.md exist on main), readPull
// (did the claim's pull request merge), and findPullByBranch (the 422 path: the pull request already exists, so find
// its number by its head branch instead of losing it).
//
// Nothing here logs, and nothing here decides WHAT may be committed: every caller validates its files first
// (membership/hosted-author.mjs validateHostedRequest).

import { parseMembersIndex } from '../../membership/hosted-author.mjs';

const GH = 'https://api.github.com';
export const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });

/** Standard base64 of a UTF-8 string, chunked (btoa on a spread blows the stack at ~100KB). */
export function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** One GitHub call, returning the response and its JSON body (an empty object when the body is not JSON). */
export async function ghJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/**
 * The live `house/members-index.yml` on canonical main (what the gate reads), parsed to a Map of account number to
 * folder: `{ ok: true, map }` (an empty map when the file could not be decoded, which fails closed) or `{ ok: false }`
 * when GitHub did not answer 200.
 */
export async function readMembersIndex({ fetchImpl, instToken, upstream }) {
  const idx = await ghJson(fetchImpl, `${GH}/repos/${upstream}/contents/house/members-index.yml?ref=main`, { headers: GH_HEADERS(instToken) });
  if (!idx.res.ok) return { ok: false };
  let indexText = '';
  try { indexText = atob(String(idx.data?.content || '').replace(/\n/g, '')); } catch { /* fail closed: an empty map */ }
  return { ok: true, map: parseMembersIndex(indexText) };
}

/**
 * The members-index folder for one VERIFIED account number: `{ ok: true, folder }` (folder null when the account has
 * no entry yet) or `{ ok: false }` when the index could not be read. The folder is a GBTI name (sow-428) and may
 * differ from the GitHub login, so nothing may substitute the login for a missing entry.
 */
export async function readMembersIndexFolder({ fetchImpl, instToken, upstream, githubId }) {
  const r = await readMembersIndex({ fetchImpl, instToken, upstream });
  if (!r.ok) return { ok: false };
  return { ok: true, folder: r.map.get(String(githubId ?? '')) ?? null };
}

/**
 * A text file on canonical main (or `ref`): `{ ok: true, text }`, `{ ok: true, text: null }` when it does not exist,
 * or `{ ok: false, status }` when GitHub could not say. The claim uses it to learn whether a profile.md exists, and an
 * unreadable answer must never read as "absent" (that would write a second profile over a real one).
 */
export async function readRepoText({ fetchImpl, instToken, upstream, path, ref = 'main' }) {
  let r;
  try { r = await ghJson(fetchImpl, `${GH}/repos/${upstream}/contents/${path}?ref=${encodeURIComponent(ref)}`, { headers: GH_HEADERS(instToken) }); }
  catch { return { ok: false, status: 502 }; }
  if (r.res.status === 404) return { ok: true, text: null };
  if (!r.res.ok) return { ok: false, status: r.res.status || 502 };
  let text = '';
  try {
    const bin = atob(String(r.data?.content || '').replace(/\n/g, ''));
    text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return { ok: false, status: 502 }; }
  return { ok: true, text };
}

/** PUT (or DELETE for content: null) one file on the branch; retries once on a 409 sha race. */
export async function applyFile(fetchImpl, instToken, upstream, branch, f, attempt = 0) {
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

/**
 * Commit a VALIDATED file set to `branch` (fresh-based on live main) and open its pull request.
 *
 * Returns `{ ok: true, branch, number, html_url, already: false }`; `{ ok: true, branch, number: null, html_url: null,
 * already: true }` when GitHub answers 422 because a pull request for this head is already open (use findPullByBranch
 * for its number); or `{ ok: false, status, error, message }` with error 'git_failed' or 'open_pr_failed'.
 *
 * `branch` must come from hostedBranchFor with the VERIFIED account number: the gate reads the author from it.
 */
export async function commitHostedFiles({ fetchImpl, instToken, upstream, branch, files, title, body }) {
  const gitFailed = (message) => ({ ok: false, status: 502, error: 'git_failed', message });

  // Fresh-base the branch on live main (create, or force-reset if it exists): each request carries the
  // item's full file set, so a reset never loses work, and stale-base conflicts (SOW-152) cannot occur.
  const main = await ghJson(fetchImpl, `${GH}/repos/${upstream}/git/ref/heads/main`, { headers: GH_HEADERS(instToken) });
  const mainSha = main.data?.object?.sha;
  if (!main.res.ok || !mainSha) return gitFailed('could not read the main branch');
  const create = await fetchImpl(`${GH}/repos/${upstream}/git/refs`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  });
  if (!create.ok) {
    if (create.status !== 422) return gitFailed('could not create the branch');
    const reset = await fetchImpl(`${GH}/repos/${upstream}/git/refs/heads/${branch}`, {
      method: 'PATCH', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: mainSha, force: true }),
    });
    if (!reset.ok) return gitFailed('could not reset the branch');
  }

  // Apply each file via the contents API on the branch. One retry on a 409 (concurrent sha race).
  for (const f of files) {
    const applied = await applyFile(fetchImpl, instToken, upstream, branch, f);
    if (!applied.ok) return gitFailed(`could not write ${f.path}`);
  }

  // Open the PR (canonical-head: head is just the branch name). The gate resolves the member from the
  // hosted/<github_id>/ ref, gates paid + own-folder, and auto-merges; the Worker never merges.
  const pr = await ghJson(fetchImpl, `${GH}/repos/${upstream}/pulls`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: String(title ?? '').slice(0, 256), head: branch, base: 'main', body, maintainer_can_modify: false }),
  });
  if (pr.res.status === 422) return { ok: true, branch, number: null, html_url: null, already: true };
  if (!pr.res.ok) return { ok: false, status: 502, error: 'open_pr_failed', message: `GitHub returned ${pr.res.status}` };
  return { ok: true, branch, number: pr.data.number, html_url: pr.data.html_url, already: false };
}

/** A pull request's facts as the claim reads them, or null when the body is not a pull request. */
function pullFacts(p) {
  if (!p || !Number.isInteger(p.number) || p.number < 1) return null;
  return {
    number: p.number,
    state: p.state === 'open' ? 'open' : 'closed',
    merged: p.merged === true || Boolean(p.merged_at),
    headRef: typeof p.head?.ref === 'string' ? p.head.ref : null,
    baseRef: typeof p.base?.ref === 'string' ? p.base.ref : null,
    html_url: typeof p.html_url === 'string' ? p.html_url : null,
    createdAt: typeof p.created_at === 'string' ? p.created_at : null,
  };
}

/**
 * One pull request by number: `{ ok: true, pr: { number, state: 'open'|'closed', merged, headRef, baseRef,
 * html_url, createdAt } }`, `{ ok: true, pr: null }` when GitHub says there is no such pull request, or `{ ok: false, status }`
 * when GitHub could not answer. A failed read must never be taken as "closed": that would release a claim lock while
 * its pull request is still open.
 */
export async function readPull({ fetchImpl, instToken, upstream, number }) {
  if (!Number.isInteger(number) || number < 1) return { ok: true, pr: null };
  let r;
  try { r = await ghJson(fetchImpl, `${GH}/repos/${upstream}/pulls/${number}`, { headers: GH_HEADERS(instToken) }); }
  catch { return { ok: false, status: 502 }; }
  if (r.res.status === 404) return { ok: true, pr: null };
  if (!r.res.ok) return { ok: false, status: r.res.status || 502 };
  const pr = pullFacts(r.data);
  return pr ? { ok: true, pr } : { ok: false, status: 502 };
}

/**
 * The pull request whose head is `branch` on the canonical repository, open or closed: `{ ok: true, pr }` (the open
 * one when there is one, else the most recent), `{ ok: true, pr: null }` when there is none, or `{ ok: false }`.
 * This is how a retried claim learns the number when commitHostedFiles reports `already: true` (the 422 path).
 */
export async function findPullByBranch({ fetchImpl, instToken, upstream, branch }) {
  const owner = String(upstream ?? '').split('/')[0];
  if (!owner || !branch) return { ok: true, pr: null };
  const url = `${GH}/repos/${upstream}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=10`;
  let r;
  try { r = await ghJson(fetchImpl, url, { headers: GH_HEADERS(instToken) }); }
  catch { return { ok: false }; }
  if (!r.res.ok || !Array.isArray(r.data)) return { ok: false };
  const pulls = r.data.map(pullFacts).filter((p) => p && p.headRef === branch);
  if (!pulls.length) return { ok: true, pr: null };
  const open = pulls.find((p) => p.state === 'open');
  return { ok: true, pr: open ?? pulls.sort((a, b) => b.number - a.number)[0] };
}
