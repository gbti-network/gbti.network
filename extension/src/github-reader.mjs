// The EXTENSION's Reader (SOW-006 v2 P4). The npm host reads content from a local working copy (repo-fs.mjs);
// the Chrome extension has no filesystem, so it reads the SAME content via the GitHub Contents API over the
// member's token. It implements the host-agnostic Reader interface the core depends on
// ({ list, listMembersOnly, get, readFile }), so operations.mjs / api.mjs / role resolution run unchanged.
// Pure + injectable-fetch (no chrome APIs here), so it is unit-tested in node. The NESTED content layout
// (members/<u>/<sub>/<slug>/index.md) is the canonical on-disk layout reconciled in P5.

import { parseContentFile, shareSummary, byShareNewest } from '../../client/src/content-ops.mjs';

const SUBDIR = Object.freeze({ post: 'posts', product: 'products', prompt: 'prompts' });
const TYPES = ['post', 'product', 'prompt', 'profile'];
const SHARE_PATH = /^members\/[^/]+\/shares\/[^/]+\.(md|mdx)$/;
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

/** Decode GitHub's base64 (which contains newlines) into a UTF-8 string. */
function decodeBase64Utf8(b64) {
  const clean = String(b64 || '').replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function safeRel(relPath) {
  return (
    typeof relPath === 'string' &&
    relPath.length > 0 &&
    !relPath.includes('..') &&
    !relPath.includes('\\') &&
    !relPath.startsWith('/')
  );
}

/**
 * @param {object} a
 * @param {string} a.upstream   "owner/name" of the content repo.
 * @param {string} [a.token]    the member's GitHub token (higher rate limit; the repo is public so reads work
 *                              without it too).
 * @param {string} [a.ref]      branch/ref to read (default the repo default branch via 'HEAD').
 * @param {Function} [a.fetch]  injected for tests.
 */
export function createGithubReader({ upstream, token, ref = 'HEAD', fetch = globalThis.fetch } = {}) {
  const [owner, repo] = String(upstream || '').split('/');
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function contents(relPath) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(relPath)}?ref=${encodeURIComponent(ref)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return res.json();
  }

  // SOW-018: the WHOLE repo tree in ONE call (the Git Trees API resolves a branch/HEAD to its tree). Used to
  // enumerate members/*/shares/ across all members without N per-folder Contents calls (the reason
  // listMembersOnly was deferred). Returns { tree: [{ path, type }], truncated } or null.
  async function tree() {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return res.json();
  }

  async function readFile(relPath) {
    if (!owner || !repo || !safeRel(relPath)) return null;
    const j = await contents(relPath);
    if (!j || Array.isArray(j) || j.type !== 'file' || typeof j.content !== 'string') return null;
    return decodeBase64Utf8(j.content);
  }

  async function get(username, relPath) {
    if (!username || typeof relPath !== 'string') return null;
    if (relPath.includes('..') || relPath.includes('\\') || !relPath.startsWith(`members/${username}/`)) return null;
    const text = await readFile(relPath);
    if (text == null) return null;
    const { frontmatter, body } = parseContentFile(text);
    return { path: relPath, frontmatter, body };
  }

  function summarize(relPath, frontmatter) {
    return {
      path: relPath,
      type: frontmatter.type ?? null,
      title: frontmatter.title ?? frontmatter.displayName ?? relPath,
      slug: frontmatter.slug ?? null,
      status: frontmatter.status ?? null,
      visibility: frontmatter.visibility ?? null,
    };
  }

  async function listType(username, type) {
    if (type === 'profile') {
      const rel = `members/${username}/profile.md`;
      const text = await readFile(rel);
      if (text == null) return [];
      return [summarize(rel, parseContentFile(text).frontmatter)];
    }
    const sub = SUBDIR[type];
    if (!sub) return [];
    const dir = await contents(`members/${username}/${sub}`);
    if (!Array.isArray(dir)) return [];
    const out = [];
    for (const entry of dir) {
      if (entry.type !== 'dir') continue; // each item is <slug>/index.md
      const rel = `members/${username}/${sub}/${entry.name}/index.md`;
      const text = await readFile(rel);
      if (text != null) out.push(summarize(rel, parseContentFile(text).frontmatter));
    }
    return out;
  }

  return {
    readFile,
    get,
    async list(username, type) {
      if (!username) return [];
      if (type) return listType(username, type);
      const all = [];
      for (const t of TYPES) all.push(...(await listType(username, t)));
      return all;
    },
    /** Browsing ALL members-only content over the Contents API is too many calls for the live overlay; the npm
     * host portal (local working copy) is the surface for that. Deferred: returns []. */
    async listMembersOnly() {
      return [];
    },

    /**
     * SOW-018: list PUBLISHED Shares across ALL members for the extension Shares feed. ONE recursive Git Trees
     * call enumerates every members/<u>/shares/<id>.md path; because the Share id is a timestamp-slug, sorting
     * by the FILENAME yields newest-first, so we read only the newest `limit` files (bounded API calls), filter
     * drafts, and re-sort by createdAt. A members Share's plaintext is NOT read here (the stub body is empty;
     * its .enc is decrypted client-side via the Worker).
     */
    async listShares(limit = 40) {
      if (!owner || !repo) return [];
      const t = await tree();
      if (!t || !Array.isArray(t.tree)) return [];
      // The recursive Git Trees API truncates at ~100k entries / ~7MB and sets t.truncated; for this co-op's
      // repo that ceiling is years away. If it is ever hit, paths past the cut are dropped and this feed is
      // best-effort (a paginated per-folder fallback would be the future fix). The canonical repo holds only
      // PUBLISHED shares (trial drafts stay on forks), so the read loop below is ~cap reads in practice.
      const paths = t.tree
        .filter((e) => e && e.type === 'blob' && typeof e.path === 'string' && SHARE_PATH.test(e.path))
        .map((e) => e.path)
        .sort((a, b) => basename(b).localeCompare(basename(a))); // timestamp-slug filename -> newest first
      const cap = Math.max(0, limit);
      const out = [];
      // Read newest-first until the cap is met (or paths are exhausted) so filtered drafts never starve the feed
      // below the cap — matching the npm reader's completeness (which reads every file then slices).
      for (const rel of paths) {
        if (out.length >= cap) break;
        const text = await readFile(rel);
        if (text == null) continue;
        const { frontmatter, body } = parseContentFile(text);
        if (frontmatter?.status !== 'published') continue;
        out.push(shareSummary(rel, frontmatter, body));
      }
      out.sort(byShareNewest);
      return out.slice(0, cap);
    },
  };
}
