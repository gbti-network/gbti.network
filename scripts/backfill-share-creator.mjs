#!/usr/bin/env node
// sow-222: one-off backfill of `creatorUrl` + `creatorName` onto the shares whose creator cannot be derived
// from the link.
//
// WHY. Eight of the nine platforms carry the creator in the path of the shared url, so their source card
// resolves at render time with nothing stored and no backfill needed. YouTube and Vimeo do not: a watch url
// names the video and never the channel, and the only place we ever learn it is the oEmbed response at publish
// time. Every share published before that was recorded therefore keeps the old plain "Visit" button. Measured
// at origin when this was written: 34 of 69 shares are YouTube, which is the whole reason the feature exists.
//
// Usage:
//   node scripts/backfill-share-creator.mjs             # dry run, prints the plan, writes nothing
//   node scripts/backfill-share-creator.mjs --apply     # writes the frontmatter
//   node scripts/backfill-share-creator.mjs --limit 5   # bound the run while checking the output
//
// No credential of any kind: the provider oEmbed endpoints are public. One request per share, sequential, with
// a pause between them.
//
// IT DOES NOT OPEN A PR, deliberately, and it does not touch `updatedAt`. This edits member-owned content, a
// diff read in a working tree is more reviewable than a bot pull request (sow-303 set that precedent), and a
// metadata backfill is not an edit the member made.
//
// THE EDIT IS SURGICAL: it splices two lines into the existing frontmatter through the same `editFrontmatter`
// the share-covers switch uses, and leaves every other byte alone. A YAML round trip would reorder keys and
// restyle scalars across 34 files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { editFrontmatter } from './lib/share-covers.mjs';
import { oembedEndpointFor, previewFromOembed } from '../workers/lib/oembed-providers.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) || 0 : 0; })();
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

async function main() {
  const rows = [];
  for (const file of shareFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    if (!fm || typeof fm.url !== 'string') continue;
    if (typeof fm.creatorUrl === 'string' && fm.creatorUrl) continue; // already recorded
    const endpoint = oembedEndpointFor(fm.url);
    if (!endpoint) continue; // not a provider that can answer; the other eight derive at render time
    rows.push({ file, url: fm.url, endpoint });
  }
  const todo = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`${rows.length} share(s) need a creator; ${todo.length} in this run.${APPLY ? '' : ' DRY RUN (nothing is written).'}`);

  let written = 0;
  let missed = 0;
  for (const row of todo) {
    let preview = null;
    try {
      const res = await fetch(row.endpoint, { headers: { accept: 'application/json' } });
      if (res.ok) preview = previewFromOembed(await res.json());
    } catch { preview = null; }
    const rel = path.relative(ROOT, row.file);
    if (!preview?.creatorUrl) {
      missed++;
      console.log(`  -  ${rel}: no channel came back (the card keeps Visit)`);
      await sleep(250);
      continue;
    }
    console.log(`  +  ${rel}: ${preview.creatorName || '(unnamed)'} ${preview.creatorUrl}`);
    if (APPLY) {
      const text = fs.readFileSync(row.file, 'utf8');
      const edits = [{ key: 'creatorUrl', value: preview.creatorUrl, after: 'url' }];
      if (preview.creatorName) edits.push({ key: 'creatorName', value: preview.creatorName, after: 'creatorUrl' });
      const next = editFrontmatter(text, edits);
      if (next) { fs.writeFileSync(row.file, next); written++; }
    }
    await sleep(250);
  }
  console.log(`\n${APPLY ? `wrote ${written} file(s)` : 'dry run'}, ${missed} without a channel.`);
  if (APPLY && written) console.log('Review `git diff members/` before committing: two added lines per file and nothing else.');
}

main().catch((e) => { console.error(e); process.exit(1); });
