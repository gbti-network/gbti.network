// sow-427 B1: a GitHub login (or account number) to the IMMUTABLE account number, for the Worker.
//
// WHY THIS EXISTS. A prepared listing may be tied to one GitHub account (owner decision 2). The superadmin types a
// login, but a login can be renamed and then claimed by somebody else, so the binding stores the account NUMBER,
// resolved here at preparation time. The one Worker precedent (membership-syndicate-now.mjs) was an inline, private
// call that forwarded the caller's bearer token, which a website cookie caller does not have: that call then goes
// out unauthenticated, at 60 requests an hour for the whole Worker. This reads with the GitHub App installation
// token instead (github-app.mjs getInstallationToken, cached in KV), and falls back to an anonymous read only when
// the App is not configured, because the answer is public either way and is never an authorization by itself.
//
// Results, never throws:
//   { ok: true, githubId, login, name }            githubId is a digit string; login is GitHub's own casing
//   { ok: false, status: 400, error: 'bad_github_login', message }      not a login at all (no request is sent)
//   { ok: false, status: 404, error: 'unknown_github_login', message }  no such account, or not a personal one
//   { ok: false, status: 502, error: 'lookup_failed', message }         GitHub could not answer (rate limit, 5xx)
//
// An organization or a bot account is reported as unknown: only a personal account can sign in with GitHub, so an
// invitation tied to anything else could never be claimed by anyone.
//
// No logging: a login typed for a prepared listing names a person who has not agreed to anything yet.

import { getInstallationToken } from './github-app.mjs';
import { normalizeGithubLogin } from '../../membership/prepared-listings.mjs';

const GH = 'https://api.github.com';
const ID_RE = /^\d{1,20}$/;

const miss = (status, error, message) => ({ ok: false, status, error, message });
const UNKNOWN = 'No personal GitHub account has that name. Check the spelling, or leave it blank to keep the invitation open to whoever opens the link.';

/** The request headers, authenticated with the App installation token when one can be had. */
async function lookupHeaders(env, { fetchImpl, getToken, kv }) {
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' };
  try {
    const token = await getToken(env, { fetchImpl, kv });
    if (token) h.Authorization = `Bearer ${token}`;
  } catch { /* not configured: the public read still answers, only at the anonymous rate */ }
  return h;
}

/** A GitHub users-API body to the result shape, or the refusal it amounts to. */
function userFrom(body) {
  const id = body?.id;
  if (!Number.isSafeInteger(id) || id < 1) return miss(502, 'lookup_failed', 'GitHub answered without an account number. Try again shortly.');
  const login = typeof body?.login === 'string' ? body.login : '';
  if (!normalizeGithubLogin(login)) return miss(502, 'lookup_failed', 'GitHub answered without a usable account name. Try again shortly.');
  if (body.type !== 'User') return miss(404, 'unknown_github_login', UNKNOWN);
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null;
  return { ok: true, githubId: String(id), login, name };
}

async function lookup(url, env, { fetchImpl, getToken, kv }) {
  const headers = await lookupHeaders(env, { fetchImpl, getToken, kv });
  let res;
  try { res = await fetchImpl(url, { headers }); } catch { res = null; }
  if (!res) return miss(502, 'lookup_failed', 'GitHub could not be reached. Try again shortly.');
  if (res.status === 404) return miss(404, 'unknown_github_login', UNKNOWN);
  if (!res.ok) return miss(502, 'lookup_failed', `GitHub could not look that account up right now (${res.status}). Try again shortly.`);
  let body;
  try { body = await res.json(); } catch { body = null; }
  return userFrom(body);
}

/**
 * Resolve a login as a superadmin typed it ("@Sam-Dev", " sam-dev ") to the account behind it right now.
 * @returns the result shapes in the header comment.
 */
export async function githubUserByLogin(env, login, { fetchImpl = globalThis.fetch, getToken = getInstallationToken, kv = env?.SIGNUP_KV } = {}) {
  const l = normalizeGithubLogin(typeof login === 'string' ? login : '');
  if (!l) return miss(400, 'bad_github_login', 'That is not a GitHub account name. Use letters, digits and single hyphens.');
  return lookup(`${GH}/users/${encodeURIComponent(l)}`, env, { fetchImpl, getToken, kv });
}

/**
 * Resolve an account NUMBER to its current login and display name. For a caller that already holds a verified
 * account number (the claim, which needs the display name for a basic profile): a number never changes hands, so
 * this cannot resolve to a stranger the way a stale login could.
 */
export async function githubUserById(env, githubId, { fetchImpl = globalThis.fetch, getToken = getInstallationToken, kv = env?.SIGNUP_KV } = {}) {
  const id = githubId === null || githubId === undefined ? '' : String(githubId);
  if (!ID_RE.test(id)) return miss(400, 'bad_github_login', 'That is not a GitHub account number.');
  return lookup(`${GH}/user/${id}`, env, { fetchImpl, getToken, kv });
}
