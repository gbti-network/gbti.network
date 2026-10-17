#!/usr/bin/env node
// sow-462: tell search engines which addresses a production deploy changed (IndexNow). Two steps in deploy.yml:
//   node scripts/indexnow.mjs snapshot <file>   before the deploy: save the LIVE sitemap's addresses and dates
//   node scripts/indexnow.mjs submit <file>     after it: send what is new, re-dated or gone in dist's sitemap
// Both run on production only and are continue-on-error, because a notice is a courtesy to the engines and never a
// reason to fail a deploy. Without a snapshot (the live sitemap could not be read) nothing is sent, rather than
// announcing the whole site on every deploy. The diff itself is scripts/lib/indexnow-diff.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSitemapUrls, parseSitemapIndex, changedUrls, indexNowPayload, INDEXNOW_ENDPOINT, INDEXNOW_HOST } from './lib/indexnow-diff.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const [mode, file] = process.argv.slice(2);

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'gbti-deploy-indexnow' } });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.text();
}

async function liveSitemap() {
  const all = new Map();
  for (const shard of parseSitemapIndex(await get(`https://${INDEXNOW_HOST}/sitemap-index.xml`))) {
    for (const [u, lastmod] of parseSitemapUrls(await get(shard))) all.set(u, lastmod);
  }
  return all;
}

function builtSitemap() {
  const dist = path.join(ROOT, 'dist');
  const all = new Map();
  for (const shard of parseSitemapIndex(fs.readFileSync(path.join(dist, 'sitemap-index.xml'), 'utf8'))) {
    const xml = fs.readFileSync(path.join(dist, new URL(shard).pathname), 'utf8');
    for (const [u, lastmod] of parseSitemapUrls(xml)) all.set(u, lastmod);
  }
  return all;
}

if (!file || !['snapshot', 'submit'].includes(mode)) {
  console.error('usage: node scripts/indexnow.mjs snapshot|submit <file>');
  process.exit(2);
}

if (mode === 'snapshot') {
  try {
    const live = await liveSitemap();
    if (!live.size) throw new Error('the live sitemap listed no addresses');
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(live)));
    console.log(`indexnow: saved ${live.size} live addresses`);
  } catch (e) {
    console.log(`indexnow: could not read the live sitemap (${e.message}), so this deploy sends no notice`);
  }
} else {
  let before;
  try {
    before = new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
  } catch {
    console.log('indexnow: there is no snapshot of the live sitemap, so no notice is sent');
    process.exit(0);
  }
  const urls = changedUrls(before, builtSitemap());
  if (!urls.length) {
    console.log('indexnow: no address in the sitemap is new, re-dated or gone');
    process.exit(0);
  }
  const body = indexNowPayload(urls);
  const r = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  console.log(`indexnow: sent ${body.urlList.length} address(es); IndexNow answered ${r.status}`);
  // 200 = received, 202 = received while the key is still being checked. Anything else is worth a red step.
  if (r.status !== 200 && r.status !== 202) {
    console.log((await r.text().catch(() => '')).slice(0, 500));
    process.exit(1);
  }
}
