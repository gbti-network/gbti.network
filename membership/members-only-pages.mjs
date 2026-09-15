// sow-323 Phase 3: the site paths of published MEMBERS-ONLY content items, read from the repository's frontmatter.
//
// The sitemap filter (astro.config.mjs) drops them and the build guard (scripts/check-build-secrets.mjs) proves they
// are gone, because the owner ruled on 2026-09-12 that a members-only item keeps its page but is "not publicly
// indexed" until a superadmin approves it. The page itself also carries a robots noindex; the two are not redundant
// (the meta asks a crawler, the sitemap stops advertising the URL), which is the same pairing sow-189 uses for an
// unindexed article.
//
// Read from the FILES rather than from a content collection, because astro.config cannot load collections. Only the
// frontmatter block is parsed, so a body line cannot claim an audience.
import fs from 'node:fs';
import path from 'node:path';

/** The URL segment each content directory publishes under. `products` is the retired name of `projects`. */
const SEG = Object.freeze({ posts: 'articles', projects: 'projects', products: 'projects', prompts: 'prompts' });

const field = (fm, name) => {
  const m = new RegExp(`^${name}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm').exec(fm);
  return m ? m[1].trim() : null;
};

/** The frontmatter block of a content file, or '' when it has none (which is never a members-only claim). */
const frontmatter = (text) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  return m ? m[1] : '';
};

/** True for published + `visibility: members`. An absent visibility is public (the schema default). */
export function isMembersOnlyFrontmatter(fm) {
  return (field(fm, 'status') ?? 'published') === 'published' && field(fm, 'visibility') === 'members';
}

/**
 * Every `/articles|projects|prompts/<slug>/` path whose item is published and members-only, from house/ and every
 * member folder. A Mode A item (no public stub) has no page at all, so naming it here is harmless and keeps the
 * rule one line: a members-only item is never in the sitemap.
 */
export function membersOnlyPagePaths(root = '.') {
  const out = new Set();
  const scan = (base) => {
    for (const [sub, seg] of Object.entries(SEG)) {
      const dir = path.join(base, sub);
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const slugDir of names) {
        const idx = path.join(dir, slugDir, 'index.md');
        let text;
        try { text = fs.readFileSync(idx, 'utf8'); } catch { continue; }
        const fm = frontmatter(text);
        if (!isMembersOnlyFrontmatter(fm)) continue;
        out.add(`/${seg}/${field(fm, 'slug') || slugDir}/`);
      }
    }
  };
  scan(path.join(root, 'house'));
  const members = path.join(root, 'members');
  let users = [];
  try { users = fs.readdirSync(members); } catch { users = []; }
  for (const u of users) scan(path.join(members, u));
  return out;
}
