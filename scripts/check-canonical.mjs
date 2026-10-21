#!/usr/bin/env node
// Build guard: rel=canonical on every built article agrees with its frontmatter, and og:url never leaves us.
//
// WHY THIS EXISTS. `canonicalUrl` shipped in both content schemas and in the editor's own field list, and
// for months NOTHING read it. A member cross-posting an article could set it, watch the editor accept it,
// watch it appear in their publish diff, and get a published page that still declared ITSELF the original,
// competing in search with the copy they had actually written first. The unit tests pin the rule; this pins
// the artifact, because a correct resolver proves nothing if the layout or the page stops calling it.
//
// TWO-SIDED ON PURPOSE. Forbidding a wrong canonical passes perfectly on a build where the field is ignored
// everywhere, which is the exact defect. So this also REQUIRES that an article declaring canonicalUrl emits
// it, and that an article without one points at itself.
//
// og:url is checked too and deliberately differs: a cross-post still has to collect its shares, comments and
// referral attribution HERE, so only rel=canonical moves.
//   node scripts/check-canonical.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCanonical } from '../src/lib/canonical.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DIST = path.join(ROOT, 'dist');
const SITE = 'https://gbti.network';

const tag = (html, re) => (html.match(re) || [])[1] || null;
const CANON = /<link rel="canonical" href="([^"]*)"/i;
const OGURL = /<meta property="og:url" content="([^"]*)"/i;

/** Every article's declared canonicalUrl, by slug. Read from the content files, not from the build. */
function declaredBySlug() {
  const out = new Map();
  const roots = [path.join(ROOT, 'members'), path.join(ROOT, 'house')];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.md')) continue;
      if (!/[\\/](posts)[\\/]/.test(full)) continue;
      const raw = fs.readFileSync(full, 'utf8');
      const end = raw.indexOf('\n---', 4);
      if (!raw.startsWith('---') || end < 0) continue;
      const fm = raw.slice(4, end);
      const slug = (fm.match(/^slug:\s*['"]?([a-z0-9-]+)['"]?\s*$/m) || [])[1];
      if (!slug) continue;
      const canonical = (fm.match(/^canonicalUrl:\s*['"]?(\S+?)['"]?\s*$/m) || [])[1];
      if (canonical) out.set(slug, canonical);
    }
  };
  roots.forEach(walk);
  return out;
}

const articlesDir = path.join(DIST, 'articles');
let slugs = [];
try {
  slugs = fs.readdirSync(articlesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(articlesDir, e.name, 'index.html')))
    .map((e) => e.name);
} catch { /* handled below */ }

// A run with no subjects proves nothing. An empty or half-built dist must fail here rather than pass green.
if (slugs.length < 20) {
  console.error(`check-canonical: expected at least 20 built articles under dist/articles, found ${slugs.length}.`);
  console.error('Run `npm run build` first. A guard with nothing to check is not a passing guard.');
  process.exit(1);
}

const declared = declaredBySlug();
const problems = [];
let crossPosted = 0;

for (const slug of slugs) {
  const html = fs.readFileSync(path.join(articlesDir, slug, 'index.html'), 'utf8');
  const own = `${SITE}/articles/${slug}/`;
  const want = resolveCanonical({ override: declared.get(slug), pageUrl: own });
  const got = tag(html, CANON);
  const og = tag(html, OGURL);
  if (declared.has(slug)) crossPosted += 1;
  if (!got) problems.push(`${slug}: no rel=canonical in the built page`);
  else if (got !== want) problems.push(`${slug}: rel=canonical is ${got}, expected ${want}`);
  if (!og) problems.push(`${slug}: no og:url in the built page`);
  else if (og !== own) problems.push(`${slug}: og:url is ${og}, expected this page (${own}). Only rel=canonical may move.`);
}

if (problems.length) {
  console.error('check-canonical FAILED:');
  for (const p of problems.slice(0, 20)) console.error('  - ' + p);
  if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`);
  process.exit(1);
}

console.log(`✓ canonical check passed: ${slugs.length} articles, ${crossPosted} cross-posted, og:url never leaves the site.`);
