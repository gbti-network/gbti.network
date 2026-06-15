// The extension worker's ctx (SOW-006 v2 P4): the same shape context.mjs builds for the npm host, but with
// the extension adapters (a GitHub-Contents-API Reader instead of fs, the in-memory chrome-backed store). The
// dispatcher computes the role itself (async reader), so no sync role() is needed here.

import { createGithubReader } from './github-reader.mjs';
import { createRepoClient } from '../../client/src/github-repo.mjs';

export const UPSTREAM = 'gbti-network/gbti.network';

export function buildExtContext(store) {
  const token = store.get('githubToken');
  return {
    store,
    reader: createGithubReader({ upstream: UPSTREAM, token }),
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
