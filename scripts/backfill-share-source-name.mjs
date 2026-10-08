#!/usr/bin/env node
// sow-445: one-off backfill of `sourceName` (the publication's name, "Quanta Magazine") onto existing PUBLIC shares,
// so their link cards read "<title> | Quanta Magazine" as new shares do (the composer saves it at publish time).
//
// Only where it changes the card. A share whose card already names its source without a saved name (a news source
// by host, "Ars Technica"; a platform, "YouTube") is left alone, and so is one whose page names nothing: those cards
// show the same thing either way, and an untouched file is the cheapest kind.
//
// Usage:
//   node scripts/backfill-share-source-name.mjs             # dry run, prints the plan, writes nothing
//   node scripts/backfill-share-source-name.mjs --apply     # writes the frontmatter
//   node scripts/backfill-share-source-name.mjs --limit 5   # bound the run while checking the output
//
// Copied from scripts/backfill-share-creator.mjs (sow-222), and for its reasons: no credential (public pages and
// public oEmbed), one request per share with a pause, no PR, `updatedAt` untouched, and a SURGICAL edit through the
// share-covers `editFrontmatter` that adds one line and leaves every other byte alone. `sourceName` is a system-only
// field (scripts/lib/system-only-change.mjs), so the content checks do not treat this as the member's edit.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { editFrontmatter } from './lib/share-covers.mjs';
import { siteNameOf } from '../workers/lib/og-scrape.mjs';
import { oembedEndpointFor, previewFromOembed } from '../workers/lib/oembed-providers.mjs';
import { cardSourceFor, newsHostNames } from '../src/lib/link-card.mjs';
import { readNewsSourceList } from '../src/lib/news-source-list.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) || 0 : 0; })();
const UA = 'gbti-link-preview/0.1 (+https://gbti.network)'; // the Worker's own preview agent
const PAGE_BYTES = 200000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shareFiles() {
  const out = [];
  const members = path.join(ROOT, 'members');
  for (const user of fs.readdirSync(members, { withFileTypes: true })) {
    if (!user.isDirectory()) continue;
    const dir = path.join(members, user.name, 'shares');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) out.push(path.join(dir, f));
  }
  return out.sort();
}

const frontmatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  try { return yaml.load(m[1]) || {}; } catch { return null; }
};

/** The name the Worker's preview would report for this link today: the provider's, else the page's own. */
async function nameFor(url) {
  const ctl = AbortSignal.timeout(8000);
  try {
    const endpoint = oembedEndpointFor(url);
    if (endpoint) {
      const res = await fetch(endpoint, { headers: { accept: 'application/json', 'user-agent': UA }, signal: ctl });
      return res.ok ? previewFromOembed(await res.json())?.siteName || '' : '';
    }
    const res = await fetch(url, { redirect: 'follow', headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': UA }, signal: ctl });
    if (!res.ok || !/html|xml/i.test(res.headers.get('content-type') || 'html')) return '';
    return siteNameOf((await res.text()).slice(0, PAGE_BYTES));
  } catch { return ''; }
}

async function main() {
  const hosts = newsHostNames(readNewsSourceList(ROOT));
  const rows = [];
  for (const file of shareFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    if (!fm || typeof fm.url !== 'string' || fm.status !== 'published' || fm.visibility !== 'public') continue;
    if (typeof fm.sourceName === 'string' && fm.sourceName.trim()) continue; // already recorded
    rows.push({ file, url: fm.url, today: cardSourceFor({ url: fm.url }, hosts) });
  }
  const todo = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`${rows.length} public share(s) without a saved name; ${todo.length} in this run.${APPLY ? '' : ' DRY RUN (nothing is written).'}`);

  let written = 0;
  let same = 0;
  let none = 0;
  for (const row of todo) {
    const name = await nameFor(row.url);
    const rel = path.relative(ROOT, row.file);
    if (!name) { none++; console.log(`  -  ${rel}: the page names nothing; the card keeps "${row.today}"`); }
    else if (name === row.today) { same++; console.log(`  =  ${rel}: "${name}", which the card already shows`); }
    else {
      console.log(`  +  ${rel}: "${row.today}" -> "${name}"`);
      if (APPLY) {
        const next = editFrontmatter(fs.readFileSync(row.file, 'utf8'), [{ key: 'sourceName', value: name, after: 'url' }]);
        if (next) { fs.writeFileSync(row.file, next); written++; }
      }
    }
    await sleep(250);
  }
  console.log(`\n${APPLY ? `wrote ${written} file(s)` : 'dry run'}; ${same} already named, ${none} named nothing.`);
  if (APPLY && written) console.log('Review `git diff members/` before committing: one added line per file and nothing else.');
}

main().catch((e) => { console.error(e); process.exit(1); });
