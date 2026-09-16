// The member's GitHub client for the local hosts (SOW-006), reduced by sow-274 Part 4 to what a member token is
// still for: saying who the member is, one public read, and reads the network answers on their behalf.
//
// It used to be fork-aware. Members had no write access to the canonical repository, so the client pushed
// content to the member's own copy of it and opened a pull request upstream, with the member's own token. That
// path is retired: every write now goes through the network (hosted-publish.mjs), which commits against live
// main with GBTI's own credentials. The member token no longer writes anything, and sign-in no longer asks for
// the access that would let it (signup-base.mjs activeScope).
//
// Why the pull request reads go through the network rather than GitHub: the network opens a member's pull
// requests, so GitHub records GBTI's App as their author, and a search by the member finds nothing. The network
// recognises the ones it opened for the caller. Injectable fetch keeps every method unit-testable.

import { SIGNUP_BASE } from './signup-base.mjs';

export class GitHubError extends Error {
  constructor(status, body) {
    super(`github error ${status}: ${body}`);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

export function createRepoClient({ token, upstream, fetch = globalThis.fetch, baseUrl = 'https://api.github.com', signupBase = SIGNUP_BASE }) {
  if (!token) throw new Error('createRepoClient: token is required');
  if (!upstream) throw new Error('createRepoClient: upstream ("owner/name") is required');

  /** A read from GitHub with the member token. Only public data and the member's own identity. */
  async function req(method, path) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gbti-network-client',
      },
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) throw new GitHubError(res.status, text);
    return text ? JSON.parse(text) : null;
  }

  /** A read from the network, with the member token identifying the caller. The network reads the canonical
   *  repository with GBTI's App installation and scopes the answer to the caller where that matters. */
  async function callWorker(method, path) {
    const res = await fetch(`${String(signupBase).replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) throw new GitHubError(res.status, text);
    return text ? JSON.parse(text) : {};
  }

  return {
    upstream,

    /** The authenticated user ({ login, id }) from the device-flow token. */
    async getAuthUser() {
      const u = await req('GET', '/user');
      return { login: u.login, id: String(u.id) };
    },

    /** The caller's pull requests (open, and recently closed or merged), newest activity first, from the network.
     *  Each is { number, title, html_url, state, merged, createdAt, updatedAt, mergedAt, closedAt }. SOW-033 P4
     *  keeps closed and merged ones so the workspace can show Accepted and Declined. */
    async listMyPulls() {
      const p = await callWorker('GET', '/membership/my-pulls');
      return p.items ?? [];
    },

    /** Open pull requests on the canonical repository ({ number, title, html_url, author:{login,id}, headSha,
     *  createdAt, updatedAt }), newest first, for the superadmin open-PR queue (SOW-038). */
    async listOpenPulls() {
      const p = await callWorker('GET', '/membership/open-pulls');
      return p.items ?? [];
    },

    /** The gate status of one of the caller's pull requests: { state, meaning, sha, description }. */
    async gateStatus(prNumber) {
      const p = await callWorker('GET', `/membership/pr-status?number=${encodeURIComponent(prNumber)}`);
      return { state: p.state ?? 'unknown', meaning: p.meaning ?? 'unknown', sha: p.sha ?? null, description: p.description };
    },

    // sow-232: the commits on a ref that touched one path (newest first, capped at 100 by per_page). The
    // repository is public, so this is a plain GitHub read.
    async listCommits(path, { ref = 'main', perPage = 100 } = {}) {
      return req('GET', `/repos/${upstream}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(ref)}&per_page=${perPage}`);
    },

    /** The decoded text of a canonical file at a ref (main when none is given), or null if it does not exist
     *  there. Publishing reads the prior version through this (a collision check, a re-publish's original
     *  publishedAt).
     *
     *  THE DEFAULT IS LOAD-BEARING. Every caller passes a path alone. Without a default the query said
     *  `ref=undefined`, GitHub has no such branch, the network reported no file, and the caller read that as
     *  "nothing there": the rename collision check passed for a slug that was taken, on every host that reads
     *  through the network. Found in sow-274 Part 4. */
    async getFileContent(path, ref = 'main') {
      const p = await callWorker('GET', `/membership/file?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`);
      return p.text ?? null;
    },
  };
}
