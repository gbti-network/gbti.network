// Thin GitHub REST client for the PR-gate (read PR metadata, set the required status + label) and
// the reconcile (open + merge content status-flip PRs). Injectable fetch. The gate uses ONLY the
// read + status + label methods and NEVER checks out PR code (pull_request_target safety).

export class GitHubError extends Error {
  constructor(status, body) {
    super(`github error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

export function createGitHubClient({ token, repo, fetch = globalThis.fetch, baseUrl = 'https://api.github.com' }) {
  if (!token) throw new Error('createGitHubClient: token is required');
  if (!repo) throw new Error('createGitHubClient: repo ("owner/name") is required');

  async function req(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gbti-network-controller',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) throw new GitHubError(res.status, text);
    return text ? JSON.parse(text) : null;
  }

  return {
    _req: req,

    // ---- PR-gate reads (metadata only) ----
    getPull(number) {
      return req('GET', `/repos/${repo}/pulls/${number}`);
    },
    /** Changed file paths only. Paginates so large PRs are fully classified. */
    async listPullFilePaths(number) {
      const paths = [];
      for (let page = 1; ; page++) {
        const batch = await req('GET', `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
        if (!batch?.length) break;
        for (const f of batch) paths.push(f.filename);
        if (batch.length < 100) break;
      }
      return paths;
    },
    /** All reviews on a PR (metadata: user.id, state, commit_id). Paginates. Used to read owner approval. */
    async listReviews(number) {
      const reviews = [];
      for (let page = 1; ; page++) {
        const batch = await req('GET', `/repos/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`);
        if (!batch?.length) break;
        for (const r of batch) reviews.push(r);
        if (batch.length < 100) break;
      }
      return reviews;
    },

    // ---- required status check + label ----
    setStatus(sha, { state, context, description, targetUrl }) {
      return req('POST', `/repos/${repo}/statuses/${sha}`, {
        state, // success | failure | pending | error
        context,
        description: description?.slice(0, 140),
        ...(targetUrl ? { target_url: targetUrl } : {}),
      });
    },
    setLabels(number, labels) {
      return req('PUT', `/repos/${repo}/issues/${number}/labels`, { labels });
    },
    /** Post an optional comment, then close the PR. Used to auto-reject non-member PRs with a nudge. */
    async closePull(number, { comment } = {}) {
      if (comment) await req('POST', `/repos/${repo}/issues/${number}/comments`, { body: comment });
      return req('PATCH', `/repos/${repo}/pulls/${number}`, { state: 'closed' });
    },

    // ---- reconcile content flips (open + merge a status-change PR) ----
    getRef(ref) {
      return req('GET', `/repos/${repo}/git/ref/${ref}`);
    },
    createRef(branch, sha) {
      return req('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
    },
    /** Delete a branch ref. Used by the SOW-035 E2E cleanup to scrub a test branch after closing its PR. */
    deleteRef(branch) {
      return req('DELETE', `/repos/${repo}/git/refs/heads/${branch}`);
    },
    getContent(path, ref) {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      return req('GET', `/repos/${repo}/contents/${path}${q}`);
    },
    putContent(path, { message, content, branch, sha }) {
      return req('PUT', `/repos/${repo}/contents/${path}`, {
        message,
        content, // base64
        branch,
        ...(sha ? { sha } : {}),
      });
    },
    createPull({ title, head, base, body, draft = false }) {
      // draft: a GitHub draft PR cannot auto-merge, so the SOW-035 E2E authoring cycle opens drafts to avoid any
      // race with the gate's auto-merge before it scrubs the PR.
      return req('POST', `/repos/${repo}/pulls`, { title, head, base, body, draft });
    },
    mergePull(number, { method = 'squash' } = {}) {
      return req('PUT', `/repos/${repo}/pulls/${number}/merge`, { merge_method: method });
    },
  };
}
