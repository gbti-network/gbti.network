// sow-462: IndexNow tells Bing and the other IndexNow engines which addresses a production deploy changed. The diff
// decides what is announced, and the key file is how an engine checks that the notice really comes from this site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSitemapUrls, parseSitemapIndex, changedUrls, indexNowPayload, INDEXNOW_KEY, INDEXNOW_MAX_URLS } from '../scripts/lib/indexnow-diff.mjs';

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://gbti.network/</loc></url>
<url><loc>https://gbti.network/articles/a/</loc><lastmod>2025-09-16T00:00:00.000Z</lastmod></url>
<url><loc>https://gbti.network/feeds/?tag=a&amp;b</loc></url></urlset>`;

test('a sitemap reads as address to lastmod, with entities decoded and an undated entry kept', () => {
  const m = parseSitemapUrls(SITEMAP);
  assert.equal(m.size, 3);
  assert.equal(m.get('https://gbti.network/'), '');
  assert.equal(m.get('https://gbti.network/articles/a/'), '2025-09-16T00:00:00.000Z');
  assert.ok(m.has('https://gbti.network/feeds/?tag=a&b'));
  const index = '<sitemapindex><sitemap><loc>https://gbti.network/sitemap-0.xml</loc><lastmod>x</lastmod></sitemap></sitemapindex>';
  assert.deepEqual(parseSitemapIndex(index), ['https://gbti.network/sitemap-0.xml']);
});

test('only new, re-dated and removed addresses of this site are announced', () => {
  const before = new Map([['https://gbti.network/same/', '1'], ['https://gbti.network/edited/', '1'], ['https://gbti.network/gone/', '1']]);
  const after = new Map([['https://gbti.network/same/', '1'], ['https://gbti.network/edited/', '2'], ['https://gbti.network/new/', ''], ['https://other.example/x/', '']]);
  assert.deepEqual(changedUrls(before, after).sort(), ['https://gbti.network/edited/', 'https://gbti.network/gone/', 'https://gbti.network/new/']);
  assert.deepEqual(changedUrls(after, after), [], 'an unchanged sitemap announces nothing');
});

test('the request names the key file and stays inside one request', () => {
  const urls = Array.from({ length: INDEXNOW_MAX_URLS + 5 }, (_, i) => `https://gbti.network/p${i}/`);
  const body = indexNowPayload(urls);
  assert.equal(body.host, 'gbti.network');
  assert.equal(body.keyLocation, `https://gbti.network/${INDEXNOW_KEY}.txt`);
  assert.equal(body.urlList.length, INDEXNOW_MAX_URLS);
});

test('the key file is published and holds exactly the key', () => {
  assert.match(INDEXNOW_KEY, /^[a-f0-9]{32}$/);
  const file = new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url);
  assert.equal(fs.readFileSync(file, 'utf8'), INDEXNOW_KEY, 'an engine compares the file to the key byte for byte');
});
