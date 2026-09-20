// sow-266 Phase 4: the guard that keeps unindexed pages out of the sitemap.
//
// WHY THE GUARD NEEDED ONE OF ITS OWN. It found eight real leaks the day it was written (the admin tools, the
// WorkBench and its two sub-pages, sign-in, browse, embed, account notifications), which means it worked. But a
// guard that is only ever run against a repository that currently passes is a guard nobody has seen fail, and
// the next person to touch its regular expressions has no way to tell a fix from a break. These run it against
// fixtures where the answer is known.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSitemapNoindex, noindexRoutes, sitemapPaths } from '../scripts/check-sitemap-noindex.mjs';

/** A throwaway dist with the pages and sitemap entries named. */
function fixture({ pages = {}, locs = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-guard-'));
  for (const [route, noindex] of Object.entries(pages)) {
    const file = path.join(dir, route.replace(/^\//, ''), 'index.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `<!doctype html><html><head>${noindex ? '<meta name="robots" content="noindex">' : ''}</head><body></body></html>`);
  }
  fs.writeFileSync(path.join(dir, 'sitemap-0.xml'),
    `<urlset>${locs.map((l) => `<url><loc>https://gbti.network${l}</loc></url>`).join('')}</urlset>`);
  return dir;
}

test('a noindex page listed in the sitemap is reported, by route', () => {
  const dir = fixture({ pages: { '/admin': true, '/articles': false }, locs: ['/admin/', '/articles/'] });
  const { leaks } = checkSitemapNoindex({ distDir: dir });
  assert.deepEqual(leaks, ['/admin/']);
});

test('an unindexed page absent from the sitemap is fine, and so is an indexed page present in it', () => {
  const dir = fixture({ pages: { '/admin': true, '/articles': false }, locs: ['/articles/'] });
  assert.deepEqual(checkSitemapNoindex({ distDir: dir }).leaks, []);
});

test('a trailing slash on one side only is still the same page', () => {
  // The sitemap writes one form and the built path gives the other. Comparing them literally is how a guard
  // passes while the leak it exists to catch is right in front of it.
  const dir = fixture({ pages: { '/login': true }, locs: ['/login'] });
  assert.deepEqual(checkSitemapNoindex({ distDir: dir }).leaks, ['/login/']);
});

test('robots values that merely CONTAIN noindex count', () => {
  // sow-189 emits "noindex, follow" on an unindexed article, which an equality check would miss entirely.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitemap-guard-'));
  fs.mkdirSync(path.join(dir, 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'x', 'index.html'), '<meta name="robots" content="noindex, follow">');
  fs.writeFileSync(path.join(dir, 'sitemap-0.xml'), '<urlset><url><loc>https://gbti.network/x/</loc></url></urlset>');
  assert.deepEqual(checkSitemapNoindex({ distDir: dir }).leaks, ['/x/']);
});

test('the two halves are read independently, so a failure names which one is empty', () => {
  const dir = fixture({ pages: { '/admin': true }, locs: [] });
  assert.deepEqual(noindexRoutes(dir), ['/admin/']);
  assert.equal(sitemapPaths(dir).size, 0);
  // An empty subject and an empty sitemap are what the runner refuses to call a pass, because a guard that
  // discharges on an empty set is the shape of one that proves nothing.
  const { checkedPages, sitemapEntries } = checkSitemapNoindex({ distDir: dir });
  assert.equal(checkedPages, 1);
  assert.equal(sitemapEntries, 0);
});

test('the real build passes it', () => {
  // The repository's own dist, when there is one. Skipped rather than faked when the tree has not been built,
  // because a test that quietly passes on a missing directory is the empty-set failure one line up.
  const dist = new URL('../dist/', import.meta.url).pathname;
  if (!fs.existsSync(path.join(dist, 'sitemap-0.xml'))) return;
  const { leaks, checkedPages } = checkSitemapNoindex({ distDir: dist });
  assert.ok(checkedPages > 0, 'the built site has unindexed pages; finding none means the check is looking for the wrong thing');
  assert.deepEqual(leaks, [], 'add each route to the sitemap filter in astro.config.mjs');
});
