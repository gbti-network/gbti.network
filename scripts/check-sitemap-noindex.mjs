#!/usr/bin/env node
// sow-266 Phase 4 build guard: a page that tells search engines not to index it must not also be listed in the
// sitemap, which is an invitation to come and index it.
//
// WHY THIS EXISTS, AND WHY IT IS A GUARD RATHER THAN A FIX. The exclusion lives in astro.config.mjs as a hand
// written regular expression naming each unindexed route. That list is maintained by whoever remembers, and it
// had gone stale: when this was written, EIGHT unindexed pages were in the sitemap, including the admin tools,
// the WorkBench and the sign-in page. Nothing had gone wrong visibly, because the noindex still works and a
// search engine resolves the contradiction in the page's favour. It simply publishes the address of every
// private surface the site has, in a file whose whole purpose is to be read by crawlers.
//
// Astro's sitemap filter runs BEFORE any page is written, so it cannot read the robots meta it needs and the
// hand list cannot be derived away. What can be done is to check the two against each other afterwards, which
// is what this is. Add a page's route to the filter in astro.config.mjs and this passes again.
//
//   node scripts/check-sitemap-noindex.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOINDEX_META = /<meta\s+name="robots"\s+content="[^"]*noindex/i;

/** Every route under dist whose built page asks not to be indexed. */
export function noindexRoutes(distDir) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.html')) continue;
      let html = '';
      try { html = fs.readFileSync(p, 'utf8'); } catch { continue; }
      if (!NOINDEX_META.test(html)) continue;
      const rel = path.relative(distDir, p).split(path.sep).join('/');
      out.push('/' + rel.replace(/index\.html$/, '').replace(/\.html$/, ''));
    }
  };
  walk(distDir);
  return out.sort();
}

/** Every path listed in every sitemap shard, normalized to a trailing slash so the two sides compare. */
export function sitemapPaths(distDir) {
  const out = new Set();
  let files = [];
  try { files = fs.readdirSync(distDir).filter((f) => /^sitemap.*\.xml$/.test(f)); } catch { return out; }
  for (const f of files) {
    let xml = '';
    try { xml = fs.readFileSync(path.join(distDir, f), 'utf8'); } catch { continue; }
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      try {
        const p = new URL(m[1]).pathname;
        out.add(p.endsWith('/') ? p : `${p}/`);
      } catch { /* a malformed loc is not this guard's subject */ }
    }
  }
  return out;
}

export function checkSitemapNoindex({ distDir }) {
  const noindex = noindexRoutes(distDir);
  const listed = sitemapPaths(distDir);
  const norm = (p) => (p.endsWith('/') ? p : `${p}/`);
  const leaks = noindex.filter((p) => listed.has(norm(p)));
  return { leaks, checkedPages: noindex.length, sitemapEntries: listed.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const distDir = path.join(ROOT, 'dist');
  const { leaks, checkedPages, sitemapEntries } = checkSitemapNoindex({ distDir });

  // A guard that passes on an empty set proves nothing. If there are no unindexed pages at all, or no sitemap,
  // something has changed about the build rather than the site suddenly becoming perfect.
  if (!sitemapEntries) {
    console.error('✗ sitemap/noindex guard could not run: dist carries no sitemap. Build first, or say why there is none.');
    process.exit(1);
  }
  if (!checkedPages) {
    console.error('✗ sitemap/noindex guard found NO unindexed pages at all, which has not been true of this site. The robots meta tag or the layout has changed shape and this guard is now looking for the wrong thing.');
    process.exit(1);
  }
  if (leaks.length) {
    console.error(`✗ sitemap/noindex guard failed: ${leaks.length} page${leaks.length === 1 ? '' : 's'} say noindex and are listed in the sitemap anyway:`);
    for (const p of leaks) console.error('  - ' + p);
    console.error('  Add each route to the sitemap filter in astro.config.mjs. A sitemap entry invites a crawler to a page that then tells it to go away.');
    process.exit(1);
  }
  console.log(`✓ sitemap/noindex guard passed (${checkedPages} unindexed pages, none of them among the ${sitemapEntries} sitemap entries)`);
}
