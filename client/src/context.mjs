// Shared request context (SOW-006): the collaborators the operations core needs (store, local reader,
// a repo-client factory, identity resolver). Built once from the store and passed to api.mjs and the MCP
// tools, so the CMS HTTP server and the stdio MCP entry are wired identically.

import { createReader, createStager } from './repo-fs.mjs';
import { createRepoClient } from './github-repo.mjs';
import { roleOf, rolesFromText } from './roles.mjs';

export const UPSTREAM = process.env.GBTI_UPSTREAM || 'gbti-network/gbti.network';

// The node host wires the fs-backed Reader + Stager into the host-agnostic core. The extension host builds
// the same shape with GitHub-Contents-API + chrome.storage implementations, so api.mjs / operations.mjs /
// the MCP tools run identically on both.
export function buildContext(store) {
  const repoPath = store.get('repoPath');
  const reader = createReader(repoPath);
  return {
    store,
    reader,
    stager: createStager(repoPath),
    getRepoClient() {
      const token = store.get('githubToken');
      return token ? createRepoClient({ token, upstream: UPSTREAM }) : null;
    },
    identity() {
      const id = store.get('identity');
      if (!id) return null;
      return { login: id.login, githubId: id.githubId, username: (id.username || id.login || '').toLowerCase() };
    },
    /** The signed-in user's role from the LOCAL house/roles.yml via the reader (UX gating only; the gate is
     * authoritative). Going through the reader keeps role resolution host-agnostic. */
    role() {
      const id = store.get('identity');
      if (!id?.githubId) return 'member';
      return roleOf(id.githubId, rolesFromText(reader.readFile('house/roles.yml')));
    },
    /** SOW-011: the effective membership cached at login (paid/trialing/...). Gates publish + the UI notice. */
    membership() {
      return store.get('membership') ?? 'unknown';
    },
  };
}
