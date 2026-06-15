// Node host fs adapters (SOW-006): the Reader (lists + reads content from the cloned content repo) and the
// Stager (writes a staged image into the working copy). These are the NODE implementations of the
// host-agnostic Reader/Stager seams the core (operations.mjs, admin-ops.mjs, context.mjs) depends on; the
// Chrome-extension host provides its own implementations (GitHub Contents API / chrome.storage) over the
// SAME interfaces, so the core never imports node:fs. Read-only + own-folder-scoped for content; the
// general readFile is used by admin tools to read house/*.yml. Authoring/publishing go through publish.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { parseContentFile, shareSummary, byShareNewest } from './content-ops.mjs';
import { rolesFromText } from './roles.mjs';

const SUBDIR = Object.freeze({ post: 'posts', product: 'products', prompt: 'prompts' });
const TYPES = ['post', 'product', 'prompt', 'profile'];

/** Reject a path that escapes the repo root (traversal, backslash, absolute). */
function safeRel(relPath) {
  return (
    typeof relPath === 'string' &&
    relPath.length > 0 &&
    !relPath.includes('..') &&
    !relPath.includes('\\') &&
    !relPath.startsWith('/')
  );
}

export function createReader(repoPath) {
  function readItem(absPath, relPath) {
    const { frontmatter } = parseContentFile(fs.readFileSync(absPath, 'utf8'));
    return {
      path: relPath,
      type: frontmatter.type ?? null,
      title: frontmatter.title ?? frontmatter.displayName ?? relPath,
      slug: frontmatter.slug ?? null,
      status: frontmatter.status ?? null,
      visibility: frontmatter.visibility ?? null,
    };
  }

  function listType(username, type) {
    const out = [];
    if (type === 'profile') {
      const rel = `members/${username}/profile.md`;
      const abs = path.join(repoPath, 'members', username, 'profile.md');
      if (fs.existsSync(abs)) out.push(readItem(abs, rel));
      return out;
    }
    const sub = SUBDIR[type];
    if (!sub) return out;
    const dir = path.join(repoPath, 'members', username, sub);
    if (!fs.existsSync(dir)) return out;
    // NESTED layout: each item is members/<u>/<sub>/<slug>/index.md (a folder per item). Walk the slug
    // folders and read their index.md (.md or .mdx); skip stray flat files for resilience.
    for (const slug of fs.readdirSync(dir).sort()) {
      const slugDir = path.join(dir, slug);
      let isDir = false;
      try {
        isDir = fs.statSync(slugDir).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      for (const idx of ['index.md', 'index.mdx']) {
        const abs = path.join(slugDir, idx);
        if (fs.existsSync(abs)) {
          out.push(readItem(abs, `members/${username}/${sub}/${slug}/${idx}`));
          break;
        }
      }
    }
    return out;
  }

  return {
    /** List the member's content of a type, or all authorable types when type is omitted. */
    list(username, type) {
      if (!repoPath || !username) return [];
      if (type) return listType(username, type);
      return TYPES.flatMap((t) => listType(username, t));
    },

    /**
     * List members-only content (visibility: members) across ALL member folders + house, for the
     * members-only portal. This content lives in the public repo but is excluded from the public build, so
     * the portal is how a member browses it locally. Read-only; not scoped to one folder.
     */
    listMembersOnly() {
      if (!repoPath) return [];
      const out = [];
      const roots = [path.join(repoPath, 'members'), path.join(repoPath, 'house')];
      const walk = (dir) => {
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (/\.(md|mdx)$/.test(e.name) && /\/(posts|products|prompts)\//.test(full.split(path.sep).join('/'))) {
            const { frontmatter } = parseContentFile(fs.readFileSync(full, 'utf8'));
            if (frontmatter.visibility === 'members') {
              out.push({
                path: path.relative(repoPath, full).split(path.sep).join('/'),
                type: frontmatter.type ?? null,
                title: frontmatter.title ?? full,
                author: frontmatter.author ?? null,
                status: frontmatter.status ?? null,
              });
            }
          }
        }
      };
      roots.forEach(walk);
      return out;
    },

    /**
     * SOW-018: list PUBLISHED Shares across ALL member folders (members/<u>/shares/<id>.md), newest-first,
     * capped. Returns feed summaries (metadata + the PUBLIC body only; a members Share's body stays in its
     * .enc, decrypted client-side via the Worker). This is the extension/client-only Shares stream (no public
     * website surface). The npm host walks the local working copy.
     */
    listShares(limit = 40) {
      if (!repoPath) return [];
      const membersRoot = path.join(repoPath, 'members');
      let users;
      try { users = fs.readdirSync(membersRoot, { withFileTypes: true }); } catch { return []; }
      const out = [];
      for (const u of users) {
        if (!u.isDirectory()) continue;
        const sharesDir = path.join(membersRoot, u.name, 'shares');
        let files;
        try { files = fs.readdirSync(sharesDir); } catch { continue; } // no shares/ folder for this member
        for (const f of files) {
          if (!/\.(md|mdx)$/.test(f)) continue;
          let parsed;
          try { parsed = parseContentFile(fs.readFileSync(path.join(sharesDir, f), 'utf8')); } catch { continue; }
          if (parsed.frontmatter?.status !== 'published') continue; // drafts never surface
          out.push(shareSummary(`members/${u.name}/shares/${f}`, parsed.frontmatter, parsed.body));
        }
      }
      out.sort(byShareNewest);
      return out.slice(0, Math.max(0, limit));
    },

    /** Read one item (frontmatter + body), scoped to the member's own folder. Returns null if out of scope/missing. */
    get(username, relPath) {
      if (!repoPath || !username) return null;
      if (typeof relPath !== 'string') return null;
      if (relPath.includes('..') || relPath.includes('\\') || !relPath.startsWith(`members/${username}/`)) return null;
      const abs = path.join(repoPath, relPath);
      if (!fs.existsSync(abs)) return null;
      const { frontmatter, body } = parseContentFile(fs.readFileSync(abs, 'utf8'));
      return { path: relPath, frontmatter, body };
    },

    /** Read ANY repo-relative file as text (for admin tools reading house/*.yml). Null when missing/unreadable. */
    readFile(relPath) {
      if (!repoPath || !safeRel(relPath)) return null;
      try {
        return fs.readFileSync(path.join(repoPath, relPath), 'utf8');
      } catch {
        return null;
      }
    },
  };
}

/** Read house/roles.yml from the local repo into a role Map (the node convenience; the host-agnostic path
 * is rolesFromText + a reader). Missing/unparseable -> empty Map (everyone is a plain member). */
export function loadRoles(repoPath) {
  if (!repoPath) return new Map();
  try {
    return rolesFromText(fs.readFileSync(path.join(repoPath, 'house', 'roles.yml'), 'utf8'));
  } catch {
    return new Map();
  }
}

/** The NODE Stager: write a staged image into the working copy. The extension host stages via the GitHub
 * Contents API instead; both satisfy the same `writeImage(relPath, dataBase64)` seam the core calls. */
export function createStager(repoPath) {
  return {
    writeImage(relPath, dataBase64) {
      if (!repoPath) throw new Error('no local working copy configured');
      if (!safeRel(relPath)) throw new Error('invalid image path');
      const abs = path.join(repoPath, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(dataBase64, 'base64'));
    },
  };
}
