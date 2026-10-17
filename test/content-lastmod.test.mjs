// sow-462: the sitemap's last-edited dates. Search engines use <lastmod> to choose what to fetch again and stop trusting
// a site that stamps every page on every deploy, so each date must be the item's own record of its last revision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contentLastmod, withLastmod, parseContentDate } from '../membership/content-lastmod.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-lastmod-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('members/ana/posts/anime/index.md', '---\nslug: anime-styles\npublishedAt: 2025-06-12\nupdatedAt: "2025-09-16"\n---\nbody\nupdatedAt: 2099-01-01\n');
  put('members/ana/prompts/p1/index.md', "---\npublishedAt: '2026-01-02T03:04:05.000Z'\n---\n");
  put('members/ana/projects/broken/index.md', '---\npublishedAt: soon\n---\n');
  put('members/ana/shares/20260718-x.md', "---\nid: 20260718-x\ncreatedAt: '2026-07-18T17:29:29.675Z'\n---\n");
  put('house/pages/terms.md', '---\nslug: terms\nupdatedAt: 2026-10-01\n---\n');
  put('house/pages/contact.md', '---\nslug: contact\n---\n');
  return root;
}

test('each page gets its own last revision: updatedAt, else publishedAt, a share its createdAt, a house page its updatedAt', () => {
  const map = contentLastmod(fixture());
  assert.equal(map.get('/articles/anime-styles/')?.toISOString(), '2025-09-16T00:00:00.000Z', 'the frontmatter slug names the page, and updatedAt wins');
  assert.equal(map.get('/prompts/p1/')?.toISOString(), '2026-01-02T03:04:05.000Z');
  assert.equal(map.get('/shares/ana/20260718-x/')?.toISOString(), '2026-07-18T17:29:29.675Z');
  assert.equal(map.get('/terms/')?.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(map.has('/projects/broken/'), false, 'a date that does not parse is left out, never guessed');
  assert.equal(map.has('/contact/'), false, 'a page with no date carries no lastmod');
  assert.equal(map.size, 4);
});

test('a date in the body is never read as the frontmatter date', () => {
  assert.notEqual(contentLastmod(fixture()).get('/articles/anime-styles/')?.getUTCFullYear(), 2099);
});

test('the serialize hook dates known pages, leaves the rest alone, and never throws', () => {
  const hook = withLastmod(new Map([['/articles/a/', new Date('2025-01-02T00:00:00Z')]]));
  assert.deepEqual(hook({ url: 'https://gbti.network/articles/a/' }), { url: 'https://gbti.network/articles/a/', lastmod: '2025-01-02T00:00:00.000Z' });
  assert.deepEqual(hook({ url: 'https://gbti.network/feeds/' }), { url: 'https://gbti.network/feeds/' });
  assert.deepEqual(hook({ url: 'not a url' }), { url: 'not a url' }, 'a throw here would make the plugin write no sitemap at all');
  assert.equal(parseContentDate(''), null);
  assert.equal(parseContentDate('2025-13-45'), null);
});

test('the sitemap plugin is given the hook', () => {
  const config = fs.readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
  assert.match(config, /sitemap\(\{[^\n]*serialize: withLastmod\(LASTMOD\)/);
});
