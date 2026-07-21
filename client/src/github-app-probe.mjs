// SOW-026: the onboarding readiness PROBE. Reads DURABLE GitHub state (the token, the fork, the App install)
// so the first-run wizard can show the first not-yet-done step. The whole point: readiness is derived from
// GitHub, never a local "firstRunDone" flag, so clearing the local store costs at most a re-login, never a
// re-fork or re-install. Pure over an injected fetch (no SDK), so it unit-tests with a fake fetch.

const GH = 'https://api.github.com';
// Every probe read is CACHE-BUSTED twice over: `cache: 'no-store'` skips the browser HTTP cache (GitHub sends
// max-age=60, so an extension-host fetch would happily serve a stale installation for a minute per response),
// and the empty `If-None-Match` opts out of GitHub's ETag/304 layer, which lags installation edits by minutes.
// Without both, the wizard's 5s poll re-reads the same stale "all repositories" grant long after the member
// fixed it on GitHub (observed live 2026-07-21: several minutes stuck on the corrective card).
const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network', 'If-None-Match': '' });
const ghInit = (token) => ({ headers: ghHeaders(token), cache: 'no-store' });
const repoName = (login, upstream) => `${String(login).toLowerCase()}/${upstream.split('/')[1]}`;

/** GET /user -> { login, githubId } or null (token DEFINITIVELY rejected: 401/403-unauthorized). Throws on a
 *  transient error (5xx, rate-limit, network) so the caller treats it as "offline / unknown", NEVER as
 *  signed-out. This split lets the caller self-heal a dead token (clear it) without spuriously signing a member
 *  out on a transient GitHub blip. */
export async function getAuthedUser({ token, fetch = globalThis.fetch }) {
  const res = await fetch(`${GH}/user`, ghInit(token));
  if (res.status === 401) return null; // expired / revoked user token -> definitively rejected
  if (!res.ok) throw new Error(`github /user ${res.status}`); // transient: do not treat as signed-out
  const u = await res.json();
  return { login: String(u.login), githubId: String(u.id) };
}

/** Is the member's fork present (a real fork of the upstream, not a same-named unrelated repo)? */
export async function forkReady({ token, login, upstream, fetch = globalThis.fetch }) {
  const res = await fetch(`${GH}/repos/${repoName(login, upstream)}`, ghInit(token));
  if (!res.ok) return false; // 404 = no fork yet
  const r = await res.json();
  return r.fork === true && String(r.parent?.full_name || '').toLowerCase() === upstream.toLowerCase();
}

/** Is the GBTI App installed with the member's fork in its selected set? Returns { installed, allRepos }. */
export async function appInstallStatus({ token, login, appSlug, upstream, fetch = globalThis.fetch }) {
  const fork = repoName(login, upstream);
  const res = await fetch(`${GH}/user/installations`, ghInit(token));
  if (!res.ok) return { installed: false, allRepos: false };
  const data = await res.json();
  // Match the GBTI App installation; when two exist (personal + an org), prefer the one on the member account.
  const insts = (data.installations || []).filter((i) => String(i.app_slug || '').toLowerCase() === appSlug.toLowerCase());
  const inst = insts.find((i) => String(i.account?.login || '').toLowerCase() === String(login).toLowerCase()) || insts[0];
  if (!inst) return { installed: false, allRepos: false };
  // An "All repositories" grant is REJECTED: it over-grants GBTI access to every repo the member owns. We do
  // not accept it as ready (installed:false) so the wizard sends them back to switch to "Only select
  // repositories" -> just their fork. allRepos:true tells the UI to show the corrective message, not the
  // first-time install prompt. (The fork is technically covered, but least privilege is the whole point here.)
  if (inst.repository_selection === 'all') return { installed: false, allRepos: true };
  const rres = await fetch(`${GH}/user/installations/${inst.id}/repositories?per_page=100`, ghInit(token));
  if (!rres.ok) return { installed: false, allRepos: false };
  const rd = await rres.json();
  const has = (rd.repositories || []).some((r) => String(r.full_name || '').toLowerCase() === fork);
  return { installed: has, allRepos: false };
}

/**
 * The full readiness probe. Short-circuits (no fork read without a token, no install read without a fork) and
 * NEVER advances on an error: a network failure returns reachedGithub:false with the facts it could not read
 * left false, so the wizard holds the active step rather than falsely marking one done (fail closed).
 */
export async function probeReadiness({ token, appSlug, upstream, fetch = globalThis.fetch }) {
  if (!token) return { signedIn: false, forkReady: false, installReady: false, reachedGithub: true };
  let user;
  try { user = await getAuthedUser({ token, fetch }); } catch { return { signedIn: false, forkReady: false, installReady: false, reachedGithub: false }; }
  if (!user) return { signedIn: false, forkReady: false, installReady: false, reachedGithub: true }; // token rejected
  try {
    const fork = await forkReady({ token, login: user.login, upstream, fetch });
    let install = { installed: false, allRepos: false };
    if (fork) install = await appInstallStatus({ token, login: user.login, appSlug, upstream, fetch });
    return { signedIn: true, login: user.login, githubId: user.githubId, forkReady: fork, installReady: install.installed, allReposGrant: install.allRepos, reachedGithub: true };
  } catch {
    return { signedIn: true, login: user.login, githubId: user.githubId, forkReady: false, installReady: false, reachedGithub: false };
  }
}
