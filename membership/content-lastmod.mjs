// sow-462: the last-edited date of every content page, for the sitemap's <lastmod>.
//
// Search engines use <lastmod> to decide which pages to fetch again, and they stop trusting it from a site that
// stamps every page on every deploy. So the date is the item's own record of its last real revision: `updatedAt`,
// else `publishedAt` (a share: `updatedAt`, else `createdAt`; a house page: `updatedAt` only). A value that does not
// parse is left out rather than guessed, and a page with no date carries no <lastmod> at all.
//
// Read from the FILES, like members-only-pages.mjs and for the same reason: astro.config cannot load collections.
// Mapping a page that never builds (a draft, a members-only item) is harmless: the sitemap only asks about pages it
// already lists.
import fs from 'node:fs';
import path from 'node:path';
import { frontmatterField as field, frontmatterBlock as frontmatter, CONTENT_URL_SEGMENTS as SEG } from './members-only-pages.mjs';

/** A frontmatter date ("2025-06-12" or a full ISO stamp) as a Date, or null when it is absent or does not parse. */
export function parseContentDate(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const list = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const readFrontmatter = (file) => { try { return frontmatter(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/** Every content page path (`/articles/<slug>/`, `/shares/<owner>/<id>/`, ...) mapped to its last-edited Date. */
export function contentLastmod(root = '.') {
  const out = new Map();
  const put = (url, fm, keys) => {
    for (const k of keys) {
      const d = parseContentDate(field(fm, k));
      if (d) { out.set(url, d); return; }
    }
  };
  const scanFolder = (base, owner) => {
    for (const [sub, seg] of Object.entries(SEG)) {
      for (const slugDir of list(path.join(base, sub))) {
        const fm = readFrontmatter(path.join(base, sub, slugDir, 'index.md'));
        if (fm) put(`/${seg}/${field(fm, 'slug') || slugDir}/`, fm, ['updatedAt', 'publishedAt']);
      }
    }
    if (!owner) return; // house/ holds no shares
    for (const name of list(path.join(base, 'shares'))) {
      if (!name.endsWith('.md')) continue;
      const fm = readFrontmatter(path.join(base, 'shares', name));
      if (fm) put(`/shares/${owner}/${field(fm, 'id') || name.slice(0, -3)}/`, fm, ['updatedAt', 'createdAt']);
    }
  };
  scanFolder(path.join(root, 'house'), null);
  for (const name of list(path.join(root, 'house', 'pages'))) {
    if (!name.endsWith('.md')) continue;
    const fm = readFrontmatter(path.join(root, 'house', 'pages', name));
    if (fm) put(`/${field(fm, 'slug') || name.slice(0, -3)}/`, fm, ['updatedAt']);
  }
  for (const u of list(path.join(root, 'members'))) scanFolder(path.join(root, 'members', u), u);
  return out;
}

/**
 * The sitemap plugin's `serialize` hook. It must NEVER throw: @astrojs/sitemap answers a throw by writing no sitemap
 * at all, which would take every page out of the sitemap to add a date to some of them.
 */
export function withLastmod(map) {
  return (item) => {
    try {
      const d = map.get(new URL(item.url).pathname);
      return d ? { ...item, lastmod: d.toISOString() } : item;
    } catch {
      return item;
    }
  };
}
