// Self-contained GitHub REST client for the local client (SOW-006). Unlike the controller's
// clients/github.mjs (single-repo, used by the gate/reconcile), this is fork-aware: members do not have
// write access to the upstream content repo, so the client pushes content to the member's FORK and opens
// a PR upstream. It lives inside client/src so the published npm package is self-contained. Injectable
// fetch makes every method unit-testable. The token comes from device-flow auth (auth-device.mjs).
//
// SOW-026 (app mode): the member's token is a GitHub App token scoped to ONLY their fork, so it CANNOT create
// the fork (verify instead), CANNOT read the upstream repo (skip findOpenPull; the Worker dedups), and CANNOT
// open the upstream PR (delegate to the Worker's POST /membership/open-pr, which uses GBTI's App installation).
// All fork-side operations (push/branch/contents) are unchanged. Classic mode keeps the current behavior.

import { isAppMode, SIGNUP_BASE } from './signup-base.mjs';

export class GitHubError extends Error {
  constructor(status, body) {
    super(`github error ${status}: ${body}`);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Base64 of a UTF-8 string (the Contents API wants base64). Cross-environment: the npm host runs in node
 * (Buffer), but the MV3 service worker has NO Buffer global, so fall back to TextEncoder + btoa over the
 * UTF-8 bytes (btoa alone mangles multibyte characters). The read path already decodes with TextDecoder.
 */
export function toBase64(text) {
  const s = String(text);
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Decode base64 (the Contents API returns file content base64-encoded, possibly newline-wrapped) to a UTF-8
 *  string. Cross-environment mirror of toBase64: node has Buffer, the MV3 service worker uses atob + TextDecoder
 *  (atob alone mangles multibyte characters). */
export function fromBase64(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Map the gate's combined-status state to a member-facing meaning. */
export function interpretGateState(state) {
  switch (state) {
    case 'success': return 'mergeable';
    case 'pending': return 'checking';
    case 'failure': return 'held';
    case 'error': return 'error';
    default: return 'unknown';
  }
}

export function createRepoClient({ token, upstream, fetch = globalThis.fetch, baseUrl = 'https://api.github.com', appMode = isAppMode(), signupBase = SIGNUP_BASE }) {
  if (!token) throw new Error('createRepoClient: token is required');
  if (!upstream) throw new Error('createRepoClient: upstream ("owner/name") is required');
  const GATE_CONTEXT = 'membership-gate';

  async function req(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gbti-network-client',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) throw new GitHubError(res.status, text);
    return text ? JSON.parse(text) : null;
  }

  // App mode (SOW-026): call a signup-Worker endpoint with the member's bearer token. The Worker performs the
  // upstream read/write with GBTI's App installation (the fork-scoped member token cannot reach the canonical
  // repo). Used by openPull (write) + listMyPulls / gateStatus (read proxies).
  async function callWorker(method, path, body) {
    const res = await fetch(`${String(signupBase).replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new GitHubError(res.status, text);
    return text ? JSON.parse(text) : {};
  }

  return {
    _req: req,
    upstream,

    /** The authenticated user ({ login, id }) from the device-flow token. */
    async getAuthUser() {
      const u = await req('GET', '/user');
      return { login: u.login, id: String(u.id) };
    },

    /** Ensure the member has a fork of upstream. Classic: POST /forks (idempotent, returns the existing fork).
     *  App mode (SOW-026): VERIFY the fork exists (the fork-scoped token cannot create it; the member forks via
     *  the web UI in the onboarding wizard). A missing fork means setup is incomplete. */
    async ensureFork() {
      if (appMode) {
        const me = await req('GET', '/user');
        const full = `${String(me.login).toLowerCase()}/${upstream.split('/')[1]}`;
        let r;
        try {
          r = await req('GET', `/repos/${full}`);
        } catch (err) {
          if (err instanceof GitHubError && err.status === 404) {
            throw new GitHubError(404, 'no fork found. Finish setup in the GBTI extension (make your copy of the network), then publish again.');
          }
          throw err;
        }
        if (!r.fork) throw new GitHubError(409, `${full} is not a fork of ${upstream}; rename it and make your copy from the extension.`);
        return { full_name: r.full_name, owner: r.owner?.login, default_branch: r.default_branch };
      }
      const f = await req('POST', `/repos/${upstream}/forks`);
      return { full_name: f.full_name, owner: f.owner?.login, default_branch: f.default_branch };
    },

    /** Upstream's default branch name (e.g. "main"). */
    async getDefaultBranch(repoFullName = upstream) {
      const r = await req('GET', `/repos/${repoFullName}`);
      return r.default_branch;
    },

    /** The head commit SHA of a branch on a repo. */
    async getBranchSha(repoFullName, branch) {
      const r = await req('GET', `/repos/${repoFullName}/git/ref/heads/${encodeURIComponent(branch)}`);
      return r.object?.sha;
    },

    /** Force-move a branch ref to sha (used ONLY to reset a leftover publish branch with no open PR). */
    async forceBranch(repoFullName, branch, sha) {
      await req('PATCH', `/repos/${repoFullName}/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: true });
    },

    /** Create the branch if absent (from fromSha). A 422 (already exists) is treated as success. */
    async ensureBranch(repoFullName, branch, fromSha) {
      try {
        await req('POST', `/repos/${repoFullName}/git/refs`, { ref: `refs/heads/${branch}`, sha: fromSha });
      } catch (err) {
        if (err instanceof GitHubError && err.status === 422) return; // already exists
        throw err;
      }
    },

    /** The blob SHA of a file on a branch, or null when it does not exist yet (needed to UPDATE vs CREATE). */
    async getFileSha(repoFullName, path, ref) {
      try {
        const r = await req('GET', `/repos/${repoFullName}/contents/${path}?ref=${encodeURIComponent(ref)}`);
        return Array.isArray(r) ? null : (r.sha ?? null);
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null;
        throw err;
      }
    },

    /** Create or update a file on a branch (Contents API). content is base64. */
    async putFile(repoFullName, path, { message, contentBase64, branch, sha }) {
      return req('PUT', `/repos/${repoFullName}/contents/${path}`, {
        message,
        content: contentBase64,
        branch,
        ...(sha ? { sha } : {}),
      });
    },

    /** Delete a file on a branch (Contents API DELETE; needs the current blob sha). */
    async deleteFile(repoFullName, path, { message, branch, sha }) {
      return req('DELETE', `/repos/${repoFullName}/contents/${path}`, { message, branch, sha });
    },

    /** Open a PR upstream. head is "forkOwner:branch". Classic: POST directly with the member token. App mode
     *  (SOW-026): delegate to the Worker (the fork-scoped token cannot open a PR into the canonical repo); the
     *  Worker opens it with GBTI's App installation and dedups an existing PR (returns { already: true }). */
    async openPull({ title, head, base, body }) {
      if (appMode) {
        const p = await callWorker('POST', '/membership/open-pr', { title, head, base, body });
        return { number: p.number ?? null, html_url: p.html_url ?? null, already: p.already === true };
      }
      const p = await req('POST', `/repos/${upstream}/pulls`, { title, head, base, body });
      return { number: p.number, html_url: p.html_url };
    },

    /** Find an OPEN upstream PR for a given head ("forkOwner:branch"), or null. App mode (SOW-026): the
     *  fork-scoped token cannot read the upstream, so skip the check and let the Worker dedup on open. */
    async findOpenPull({ head }) {
      if (appMode) return null;
      const list = await req('GET', `/repos/${upstream}/pulls?state=open&head=${encodeURIComponent(head)}&per_page=1`);
      const p = list?.[0];
      return p ? { number: p.number, html_url: p.html_url } : null;
    },

    /** A member's PRs upstream, with title + number + url + state + merged. SOW-033 P4: returns OPEN *and*
     *  recently-updated CLOSED/MERGED PRs (newest activity first, capped) so the workspace can show Accepted
     *  (merged) and Declined (closed) in addition to Proposed/Needs-changes. App mode (SOW-026): the fork-scoped
     *  token cannot read the upstream + the PRs are opened by GBTI's App, so the Worker lists them scoped to the
     *  member's fork (and likewise returns state + merged). The `author:`/head-owner scoping is unchanged: a
     *  member only ever sees their own PRs. */
    async listMyPulls(login) {
      if (appMode) {
        const p = await callWorker('GET', '/membership/my-pulls');
        return p.items ?? [];
      }
      // Drop `state:open` so merged/closed PRs are included; sort by recent activity and cap so an old PR history
      // stays bounded. A search-issue result for a PR carries pull_request.merged_at (set only when merged).
      const q = encodeURIComponent(`repo:${upstream} type:pr author:${login}`);
      const r = await req('GET', `/search/issues?q=${q}&sort=updated&order=desc&per_page=100`);
      return (r.items ?? []).map((i) => ({
        number: i.number,
        title: i.title,
        html_url: i.html_url,
        state: i.state ?? 'open',
        merged: Boolean(i.pull_request?.merged_at),
      }));
    },

    /** Open upstream PRs ({ number, title, html_url, author:{login,id}, headSha, createdAt, updatedAt }), newest
     *  first. SOW-028: the owner's contribution inbox lists these and keeps only the PRs whose files fall
     *  entirely inside the owner's folder. App mode (SOW-026): the fork-scoped token cannot read the upstream, so
     *  the Worker lists them (GBTI's App installation); classic reads the upstream directly. */
    async listOpenPulls() {
      if (appMode) {
        const p = await callWorker('GET', '/membership/open-pulls');
        return p.items ?? [];
      }
      const list = await req('GET', `/repos/${upstream}/pulls?state=open&sort=created&direction=desc&per_page=100`);
      return (list ?? []).map((p) => ({
        number: p.number,
        title: p.title,
        html_url: p.html_url,
        author: { login: p.user?.login ?? null, id: p.user?.id != null ? String(p.user.id) : null },
        headSha: p.head?.sha ?? null,
        createdAt: p.created_at ?? null,
        updatedAt: p.updated_at ?? null,
      }));
    },

    /** The changed files of a PR ([{ filename, status, additions, deletions }]). SOW-028: used to scope an open
     *  PR to the owner's folder (the inbox filter) and to render the diff. App mode (SOW-026): the Worker reads
     *  the upstream files; classic reads them directly. */
    async listPullFiles(prNumber) {
      if (appMode) {
        const p = await callWorker('GET', `/membership/pr-files?number=${encodeURIComponent(prNumber)}`);
        return p.files ?? [];
      }
      const files = await req('GET', `/repos/${upstream}/pulls/${prNumber}/files?per_page=100`);
      return (files ?? []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      }));
    },

    /** The gate status for a PR: { state, meaning, sha }. App mode (SOW-026): the Worker reads the upstream PR +
     *  combined status with GBTI's App installation, scoped to the member's own PR. Classic reads it directly. */
    async gateStatus(prNumber) {
      if (appMode) {
        const p = await callWorker('GET', `/membership/pr-status?number=${encodeURIComponent(prNumber)}`);
        return { state: p.state ?? 'unknown', meaning: p.meaning ?? 'unknown', sha: p.sha ?? null, description: p.description };
      }
      const pr = await req('GET', `/repos/${upstream}/pulls/${prNumber}`);
      const sha = pr.head?.sha;
      if (!sha) return { state: 'unknown', meaning: 'unknown', sha: null };
      const status = await req('GET', `/repos/${upstream}/commits/${sha}/status`);
      const gate = (status.statuses ?? []).find((s) => s.context === GATE_CONTEXT);
      const state = gate?.state ?? status.state ?? 'unknown';
      return { state, meaning: interpretGateState(state), sha, description: gate?.description };
    },

    // ----- SOW-028 P2/P3: the owner-side contribution review (read one PR, render its diff, decide) -----

    /** One PR's review metadata: { number, title, body, html_url, state, headSha, author:{login,id} }. App mode
     *  (SOW-026): the Worker reads it with GBTI's installation; classic reads the upstream directly. */
    async getPull(prNumber) {
      if (appMode) return callWorker('GET', `/membership/pr?number=${encodeURIComponent(prNumber)}`);
      const p = await req('GET', `/repos/${upstream}/pulls/${prNumber}`);
      return {
        number: p.number,
        title: p.title,
        body: p.body ?? '',
        html_url: p.html_url,
        state: p.state,
        headSha: p.head?.sha ?? null,
        author: { login: p.user?.login ?? null, id: p.user?.id != null ? String(p.user.id) : null },
      };
    },

    /** A PR's changed files WITH the unified `patch` for the diff view ([{ filename, status, additions,
     *  deletions, patch }]). Heavier than listPullFiles (which omits patch for the inbox list). */
    async getPullDiffFiles(prNumber) {
      if (appMode) {
        const p = await callWorker('GET', `/membership/pr-files?number=${encodeURIComponent(prNumber)}&patch=1`);
        return p.files ?? [];
      }
      const files = await req('GET', `/repos/${upstream}/pulls/${prNumber}/files?per_page=100`);
      return (files ?? []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        patch: f.patch ?? null,
      }));
    },

    /** The decoded text of a file at a ref (the PR head SHA), or null if it does not exist there (a removed file).
     *  Used to render the "preview as merged" view of the proposed content. */
    async getFileContent(path, ref) {
      if (appMode) {
        const p = await callWorker('GET', `/membership/file?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`);
        return p.text ?? null;
      }
      try {
        const r = await req('GET', `/repos/${upstream}/contents/${path}?ref=${encodeURIComponent(ref)}`);
        if (Array.isArray(r) || !r?.content) return null;
        return fromBase64(r.content);
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null;
        throw err;
      }
    },

    // ----- SOW-082: fork-staged draft I/O. A draft is a per-item branch gbti/<type>-<slug> on the member's FORK
    // with NO open PR. All three operate DIRECTLY on the fork in both classic and app mode (the fork is the
    // member's own repo; the app-mode fork-scoped token can read+write+delete it), so none need a Worker proxy. -----

    /** List branch refs on a repo matching `heads/<prefix>` (GET git/matching-refs). Used to enumerate a member's
     *  fork-staged draft branches (prefix 'gbti/'). Returns [{ branch, sha }]; an empty/absent set -> []. */
    async listMatchingRefs(repoFullName, prefix) {
      try {
        const r = await req('GET', `/repos/${repoFullName}/git/matching-refs/heads/${prefix}`);
        return (Array.isArray(r) ? r : []).map((x) => ({ branch: String(x.ref || '').replace(/^refs\/heads\//, ''), sha: x.object?.sha ?? null }));
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return [];
        throw err;
      }
    },

    /** Delete a branch ref on a repo (DELETE git/refs/heads). Used to discard a fork-staged draft. The branch is
     *  NOT URL-encoded: the slashes in `heads/gbti/<slug>` are real path separators in the git-refs API. */
    async deleteBranch(repoFullName, branch) {
      return req('DELETE', `/repos/${repoFullName}/git/refs/heads/${branch}`);
    },

    /** The decoded text of a file at a ref on a SPECIFIC repo (the member's fork), or null if absent. Unlike
     *  getFileContent (which targets the upstream / Worker), this reads the fork directly with the member token. */
    async getForkFileContent(repoFullName, path, ref) {
      try {
        const r = await req('GET', `/repos/${repoFullName}/contents/${path}?ref=${encodeURIComponent(ref)}`);
        if (Array.isArray(r) || !r?.content) return null;
        return fromBase64(r.content);
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null;
        throw err;
      }
    },

    /** Submit a PR review as the signed-in owner (CLASSIC mode only). The gate honors an APPROVE only when
     *  commit_id is the current head SHA (a later push invalidates a stale approval), so the caller passes the
     *  freshly-read headSha. There is deliberately no app-mode proxy: a fork-scoped token cannot post to the
     *  upstream, and the installation token would author as GBTI's app (which the gate must not trust as a
     *  universal approver), so in app mode the owner approves on github.com (operations guards this). */
    async submitReview(prNumber, { event, body = '', commitId } = {}) {
      return req('POST', `/repos/${upstream}/pulls/${prNumber}/reviews`, { event, body, ...(commitId ? { commit_id: commitId } : {}) });
    },

    /** Close a PR without merging. Best-effort: a non-collaborator owner cannot close another member's PR, so the
     *  caller treats a failure as non-fatal (the declining review still stands). Classic mode only. */
    async closePull(prNumber) {
      return req('PATCH', `/repos/${upstream}/pulls/${prNumber}`, { state: 'closed' });
    },
  };
}
