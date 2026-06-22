// The extension worker's ctx (SOW-006 v2 P4): the same shape context.mjs builds for the npm host, but with
// the extension adapters (a GitHub-Contents-API Reader instead of fs, the in-memory chrome-backed store). The
// dispatcher computes the role itself (async reader), so no sync role() is needed here.

import { createGithubReader } from './github-reader.mjs';
import { createRepoClient } from '../../client/src/github-repo.mjs';

export const UPSTREAM = 'gbti-network/gbti.network';

export function buildExtContext(store) {
  const token = store.get('githubToken');
  // When a read proves the token is dead (a 401 carrying our token), drop the whole session: clear the token AND
  // the cached identity so /api/status reports unauthenticated and the shell forces the sign-in splash instead of
  // showing a stale @handle over an empty hub. `authExpired()` lets /api/status flag THIS as an expiry (so the
  // splash can say "session expired") vs a plain signed-out state.
  // A 401 here means even a refresh could not save the session (the background refreshes BEFORE dispatch, so a
  // 401 reaching the reader = the refresh token is also dead/revoked, or this is a pre-refresh session). Clear the
  // whole session, refresh fields included, so nothing stale lingers and the splash forces a fresh sign-in.
  let authExpired = false;
  const onAuthError = () => { authExpired = true; store.set({ githubToken: null, githubRefreshToken: null, githubTokenExpiresAt: null, identity: null }); };
  return {
    store,
    reader: createGithubReader({ upstream: UPSTREAM, token, onAuthError }),
    authExpired: () => authExpired,
    getRepoClient() {
      const t = store.get('githubToken');
      return t ? createRepoClient({ token: t, upstream: UPSTREAM }) : null;
    },
    identity() {
      const id = store.get('identity');
      if (!id) return null;
      return { login: id.login, githubId: id.githubId, username: (id.username || id.login || '').toLowerCase() };
    },
    /** SOW-011: the effective membership cached at login (paid/trialing/...). Gates publish + the UI notice. */
    membership() {
      return store.get('membership') ?? 'unknown';
    },
  };
}
