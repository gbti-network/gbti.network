// SOW-026 + SOW-157: the Worker's GitHub App plumbing and its member-scoped read proxies. The Worker holds GBTI's
// App private key and mints installation tokens for the CANONICAL repo; a member's token only identifies them.
//
// sow-274 Part 4: this module used to open a member's pull request from their own fork (openPullForMember,
// POST /membership/open-pr), mint a token for the App installation on that fork (getForkInstallationToken, used
// by the fork sync route) and read a fork branch's changes for the audience rule (forkChangesForAudience). The
// fork path is retired: every member publishes through the hosted author route (membership-author.mjs), so all
// three are gone. What remains is the installation token and the reads the network still serves.
//
// Everything is injectable (fetch, now, kv, signJwt), so it unit-tests with fakes: no real key, no network,
// no secrets.

import { githubFetchUser } from './oauth.mjs';
import { resolveIdentity } from './identity.mjs'; // sow-158 Phase 3a: bearer-or-cookie identity for the member reads
import { parseHostedRef } from '../../membership/hosted-author.mjs'; // SOW-157: hosted PR ownership match

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });
const INSTALL_TOKEN_KEY = 'gh-app:installation-token';
// Must match scripts/pr-gate.mjs STATUS_CONTEXT. (The client no longer reads the status itself; since sow-274 it
// asks this Worker, so this is the one reader.)
const GATE_CONTEXT = 'membership-gate';

/** Map the gate's combined-status state to a member-facing meaning. */
function interpretGateState(state) {
  switch (state) {
    case 'success': return 'mergeable';
    case 'pending': return 'checking';
    case 'failure': return 'held';
    case 'error': return 'error';
    default: return 'unknown';
  }
}

/** The fork owner (lowercased) a PR's head lives on. Pull requests a member opened from their own fork before
 *  sow-274 retired that path still belong to them in my-pulls and pr-status, so the match stays. */
const headOwnerOf = (pr) => String(pr?.head?.repo?.owner?.login || pr?.head?.user?.login || '').toLowerCase();

function b64urlBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64url = (input) => b64urlBytes(typeof input === 'string' ? new TextEncoder().encode(input) : input);
// NOTE: WebCrypto importKey('pkcs8') needs a PKCS#8 key ("BEGIN PRIVATE KEY"). GitHub downloads the App key as
// PKCS#1 ("BEGIN RSA PRIVATE KEY"), so convert it once before setting the secret:
//   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in app.private-key.pem -out app.pkcs8.pem
function pemToPkcs8(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Sign a short-lived GitHub App JWT (RS256) with the App private key (PEM PKCS8). The Worker holds the key. */
export async function signAppJwt(env, { now = Date.now, subtle = globalThis.crypto?.subtle } = {}) {
  if (!env?.GITHUB_APP_ID || !env?.GITHUB_APP_PRIVATE_KEY) throw new Error('GitHub App is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)');
  const iat = Math.floor(now() / 1000) - 30; // clock-skew slack
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: String(env.GITHUB_APP_ID) }));
  const input = `${head}.${body}`;
  const key = await subtle.importKey('pkcs8', pemToPkcs8(env.GITHUB_APP_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64urlBytes(new Uint8Array(sig))}`;
}

/** Mint (or reuse from KV, refreshed ~hourly) an installation access token for the canonical-repo installation. */
export async function getInstallationToken(env, { fetchImpl = globalThis.fetch, now = Date.now, kv = env?.SIGNUP_KV, signJwt = signAppJwt } = {}) {
  if (!env?.GITHUB_APP_INSTALLATION_ID) throw new Error('GitHub App installation is not configured (GITHUB_APP_INSTALLATION_ID)');
  if (kv) {
    const cached = await kv.get(INSTALL_TOKEN_KEY, 'json').catch(() => null);
    if (cached?.token && cached.expiresAt - now() > 5 * 60 * 1000) return cached.token; // reuse until ~5min before expiry
  }
  const jwt = await signJwt(env, { now });
  const res = await fetchImpl(`${GH}/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`, { method: 'POST', headers: GH_HEADERS(jwt) });
  if (!res || !res.ok) throw new Error(`installation token mint failed: ${res ? res.status : 'no response'}`);
  const data = await res.json();
  const expiresAt = Date.parse(data.expires_at) || now() + 55 * 60 * 1000;
  if (kv) await kv.put(INSTALL_TOKEN_KEY, JSON.stringify({ token: data.token, expiresAt }), { expirationTtl: 3000 }).catch(() => {});
  return data.token;
}

/**
 * Resolve the caller's GitHub login (lowercased) from their bearer token. Reads of the public canonical repo
 * are benign, so this needs only a VALID member token (no paid gate) -- but every read below is then SCOPED to
 * the caller's own fork, so the installation token can never be used to surface another member's PRs.
 */
async function authMemberLogin(request, env, { fetchImpl, fetchUser } = {}) {
  // sow-158 Phase 3a: accept EITHER a bearer member token (extension/npm) OR the website session cookie
  // (allowCookie). The cookie carries the HMAC-verified github_id + login; every read below is scoped to the
  // caller's own fork (headOwnerOf === login) or hosted PRs (isCallerHostedPull by github_id), so a valid
  // signed-in identity is enough (no paid gate). GET routes -> no CSRF (resolveIdentity SAFE_METHODS).
  const id = await resolveIdentity(request, env, { fetchImpl, fetchUser, allowCookie: true });
  if (!id.ok) return { ok: false, status: id.status, body: id.body };
  const login = String(id.login || '').toLowerCase();
  if (!login) return { ok: false, status: 401, body: { error: 'unauthorized', message: 'the token has no user login' } };
  // SOW-157: the hosted PR match keys on the immutable github_id (the hosted branch carries it).
  return { ok: true, login, githubId: id.githubId != null ? String(id.githubId) : null };
}

/**
 * SOW-157: does this PR belong to the caller as a HOSTED PR? True only when the head lives on the CANONICAL
 * repo itself (same-repo head) AND the branch parses to the caller's github_id. The same-repo guard is
 * security-load-bearing: without it a member could push a branch named hosted/<victim_id>/x to their OWN
 * fork and plant PRs in the victim's workspace. Fork heads always fall to the headOwnerOf filter instead,
 * so the two matchers are disjoint (a canonical head's owner is the org, which is no member's login).
 */
function isCallerHostedPull(pr, githubId) {
  if (!githubId) return false;
  const headRepoId = pr?.head?.repo?.id ?? null;
  const baseRepoId = pr?.base?.repo?.id ?? null;
  if (headRepoId == null || String(headRepoId) !== String(baseRepoId)) return false;
  return parseHostedRef(pr?.head?.ref) === String(githubId);
}

/**
 * GET /membership/my-pulls -> { ok, items: [{ number, title, html_url, state, merged, createdAt, updatedAt,
 * mergedAt, closedAt }] }: the caller's OPEN PRs on the
 * canonical repo. A fork-scoped member token cannot read the upstream, and in the hybrid flow GBTI's App (not
 * the member) opens the PRs, so this reads with the installation token and filters by the PR HEAD fork owner ==
 * the member's login (never by author).
 */
export async function listMemberPulls(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, env, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  // SOW-033 P4: state=all (open + closed + merged) sorted by recent activity, capped, so the workspace can show
  // Accepted (merged) and Declined (closed). The headOwnerOf == who.login filter is UNCHANGED, so a member still
  // only ever sees PRs opened from their own fork. The pulls-list object carries merged_at (set only when merged).
  const res = await fetchImpl(`${GH}/repos/${upstream}/pulls?state=all&sort=updated&direction=desc&per_page=100`, { headers: GH_HEADERS(instToken) });
  if (!res || !res.ok) return { status: 502, body: { error: 'list_failed', message: `GitHub returned ${res ? res.status : 'no response'}` } };
  const list = await res.json().catch(() => []);
  const items = (Array.isArray(list) ? list : [])
    .filter((pr) => headOwnerOf(pr) === who.login || isCallerHostedPull(pr, who.githubId))
    // sow-221: the four timestamps ride along. GitHub already sends them on this object (merged_at was being
    // read for the boolean above and then thrown away), so the workspace can say WHEN each PR event happened
    // without a second call. Additive: every existing consumer reads the same fields it always did.
    .map((pr) => ({
      number: pr.number, title: pr.title, html_url: pr.html_url, state: pr.state, merged: Boolean(pr.merged_at),
      createdAt: pr.created_at ?? null, updatedAt: pr.updated_at ?? null,
      mergedAt: pr.merged_at ?? null, closedAt: pr.closed_at ?? null,
    }));
  return { status: 200, body: { ok: true, items } };
}

/**
 * GET /membership/pr-status?number=N -> { ok, state, meaning, sha, description }: the gate status of ONE of the
 * caller's PRs. Verifies the PR head fork owner == the member's login FIRST (so a member can only read their
 * OWN PR's status, never an arbitrary number), then reads the head commit's combined status filtered to the
 * gate context. Installation-token reads; the member token identifies + scopes.
 */
export async function memberPrStatus(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, env, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  const number = Number(new URL(request.url).searchParams.get('number'));
  if (!Number.isInteger(number) || number <= 0) return { status: 400, body: { error: 'bad_request', message: 'a positive PR number is required' } };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }

  // A PR that does not exist AND a PR that is not the caller's both return the SAME 404, so this endpoint never
  // reveals (via a 403-vs-404 distinction) which PR numbers exist on the canonical repo.
  const notYours = { status: 404, body: { error: 'not_found', message: 'no such pull request (or not yours)' } };
  const prRes = await fetchImpl(`${GH}/repos/${upstream}/pulls/${number}`, { headers: GH_HEADERS(instToken) });
  if (prRes && prRes.status === 404) return notYours;
  if (!prRes || !prRes.ok) return { status: 502, body: { error: 'status_failed', message: `GitHub returned ${prRes ? prRes.status : 'no response'}` } };
  const pr = await prRes.json().catch(() => ({}));
  if (headOwnerOf(pr) !== who.login && !isCallerHostedPull(pr, who.githubId)) return notYours; // exists but not the caller's: indistinguishable from not-found
  const sha = pr?.head?.sha;
  if (!sha) return { status: 200, body: { ok: true, state: 'unknown', meaning: 'unknown', sha: null, description: null } };

  const stRes = await fetchImpl(`${GH}/repos/${upstream}/commits/${encodeURIComponent(sha)}/status`, { headers: GH_HEADERS(instToken) });
  if (!stRes || !stRes.ok) return { status: 502, body: { error: 'status_failed', message: `GitHub returned ${stRes ? stRes.status : 'no response'}` } };
  const status = await stRes.json().catch(() => ({}));
  const gate = (status.statuses ?? []).find((s) => s.context === GATE_CONTEXT);
  const state = gate?.state ?? status.state ?? 'unknown';
  return { status: 200, body: { ok: true, state, meaning: interpretGateState(state), sha, description: gate?.description ?? null } };
}

// ----- Unscoped public-repo reads: the open pull request list (the superadmin queue) and one content file -----
//
// Unlike my-pulls / pr-status these CANNOT scope by head owner, which is safe: the canonical repo is PUBLIC, so
// everything they return is already world-readable on github.com. A valid member token (or the website cookie)
// is required; reads only. SOW-028 added them for the contribution review inbox, removed in sow-274 along with the
// two reads only it used.

const authorOf = (pr) => ({ login: pr?.user?.login ?? null, id: pr?.user?.id != null ? String(pr.user.id) : null });

/** GET /membership/open-pulls -> { ok, items }: ALL open PRs on the canonical repo (public), newest first. */
export async function listOpenPullsForReview(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, env, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const res = await fetchImpl(`${GH}/repos/${upstream}/pulls?state=open&sort=created&direction=desc&per_page=100`, { headers: GH_HEADERS(instToken) });
  if (!res || !res.ok) return { status: 502, body: { error: 'list_failed', message: `GitHub returned ${res ? res.status : 'no response'}` } };
  const list = await res.json().catch(() => []);
  const items = (Array.isArray(list) ? list : []).map((pr) => ({
    number: pr.number, title: pr.title, html_url: pr.html_url, author: authorOf(pr),
    headSha: pr.head?.sha ?? null, createdAt: pr.created_at ?? null, updatedAt: pr.updated_at ?? null,
  }));
  return { status: 200, body: { ok: true, items } };
}

/** GET /membership/file?path=P&ref=R -> { ok, text, base64 }: a content file at a ref (the PR head), for preview-as-merged.
 *  Restricted to clean members/** paths so it can never be a general repo-file oracle (even though the repo is
 *  public). Returns text:null for a missing file. */
export async function reviewFileContent(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, env, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  const url = new URL(request.url);
  const path = String(url.searchParams.get('path') || '');
  const ref = String(url.searchParams.get('ref') || '');
  const clean = path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') &&
    path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
  // sow-158 in-app browse/reader: the reader opens ANY published item, and house content (house/posts/...) is in
  // the per-type indexes too, so allow the house CONTENT folders alongside members/. Deliberately NOT all of
  // house/ — the governance files (house/roles.yml, house/bans.yml, ...) stay rejected so this is not a general
  // file oracle. Safe: the repo is public by design (house index.md/.enc are already public), the caller must be a
  // signed-in member, a members-only house body is .enc ciphertext or a stub (no plaintext leak), and it only
  // decrypts through the paid-gated /membership/decrypt.
  const HOUSE_CONTENT = ['house/posts/', 'house/projects/', 'house/prompts/'];
  const allowedPrefix = path.startsWith('members/') || HOUSE_CONTENT.some((p) => path.startsWith(p));
  if (!clean || !allowedPrefix) return { status: 400, body: { error: 'bad_request', message: 'path must be a clean members/ or house content path' } };
  if (!ref) return { status: 400, body: { error: 'bad_request', message: 'a ref is required' } };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const res = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=${encodeURIComponent(ref)}`, { headers: GH_HEADERS(instToken) });
  if (res && res.status === 404) return { status: 200, body: { ok: true, text: null } };
  if (!res || !res.ok) return { status: 502, body: { error: 'file_failed', message: `GitHub returned ${res ? res.status : 'no response'}` } };
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data) || !data?.content) return { status: 200, body: { ok: true, text: null } };
  // The RAW base64 is returned beside the decoded text. GitHub already sends it in this response, so this is
  // not a second call, a wider scope, or a wider path allow-list: it is the bytes this handler had in hand and
  // was throwing away. A BINARY file (an image) decodes to mojibake in `text` and is unrecoverable from it,
  // which is why the caller needs this: an author reassignment has to carry the item's co-located images to
  // its new folder, and there is no other way to read them back out of the repo.
  //
  // The allow-list above is unchanged and is what keeps this from being a general file oracle. Widening it
  // here would be the mistake: `base64` reaches exactly the paths `text` already reached.
  const base64 = String(data.content).replace(/\s+/g, '');
  let text = null;
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    text = new TextDecoder().decode(bytes);
  } catch { text = null; }
  return { status: 200, body: { ok: true, text, base64 } };
}

/**
 * sow-232: how many commits on the default branch touched one content item, and when the last one landed. Feeds
 * the editor's "Live revisions" tile on the website. Same auth and the same content-path allow-list as
 * reviewFileContent (a signed-in member, members/ or house content only, never a governance file), one GitHub
 * commits call with the installation token, and a private ten-minute cache on the response so opening the same
 * item twice does not spend two API calls on a token shared with publishing.
 */
export async function itemRevisions(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, env, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  const url = new URL(request.url);
  const path = String(url.searchParams.get('path') || '');
  const clean = path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') &&
    path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
  const HOUSE_CONTENT = ['house/posts/', 'house/projects/', 'house/prompts/'];
  const allowedPrefix = path.startsWith('members/') || HOUSE_CONTENT.some((p) => path.startsWith(p));
  if (!clean || !allowedPrefix) return { status: 400, body: { error: 'bad_request', message: 'path must be a clean members/ or house content path' } };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const res = await fetchImpl(`${GH}/repos/${upstream}/commits?path=${encodeURIComponent(path)}&sha=main&per_page=100`, { headers: GH_HEADERS(instToken) });
  if (!res || !res.ok) return { status: 502, body: { error: 'revisions_failed', message: `GitHub returned ${res ? res.status : 'no response'}` } };
  const list = await res.json().catch(() => null);
  if (!Array.isArray(list)) return { status: 502, body: { error: 'revisions_failed', message: 'GitHub returned an unexpected shape' } };
  const last = list[0]?.commit?.committer?.date || list[0]?.commit?.author?.date || null;
  // per_page caps the count at 100; an item with more revisions than that reads as 100+, which the tile shows honestly.
  return { status: 200, body: { ok: true, revisions: list.length, capped: list.length >= 100, lastAt: last } };
}
