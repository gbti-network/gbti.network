// sow-462: structured data for search engines, and the escaping that keeps member text inside a <script> data block.
// The escaping half is a security fix: the homepage wrote member display names into a JSON block with a bare
// JSON.stringify, and a display name accepts any text, so "</script>" in one would have closed the element and run
// whatever followed it for every visitor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonForScript, articleJsonLd, breadcrumbJsonLd, authorNode, siteJsonLd, GBTI_ORGANIZATION } from '../src/lib/json-ld.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('jsonForScript keeps a hostile display name inside the data block and still parses to the same value', () => {
  const hostile = { name: '</script><script>alert(1)</script><!-- & \u2028\u2029' };
  const out = jsonForScript(hostile);
  assert.doesNotMatch(out, /</, 'a raw "<" can end the script element');
  assert.doesNotMatch(out, />/);
  assert.doesNotMatch(out, /&/);
  assert.doesNotMatch(out, /[\u2028\u2029]/);
  assert.deepEqual(JSON.parse(out), hostile, 'escaping must not change the value the page reads back');
  assert.equal(jsonForScript(undefined), 'null');
});

test('articleJsonLd carries what Google reads, and falls back to the published date when there is no update', () => {
  const author = authorNode({ name: 'Naresh', url: 'https://gbti.network/members/nareshdevineni/' });
  const rec = articleJsonLd({
    url: 'https://gbti.network/articles/x/', headline: 'X', description: 'About X', image: 'https://gbti.network/_astro/x.webp',
    publishedAt: new Date('2025-06-12T00:00:00Z'), updatedAt: undefined, author,
  });
  assert.equal(rec['@type'], 'BlogPosting');
  assert.equal(rec.headline, 'X');
  assert.deepEqual(rec.image, ['https://gbti.network/_astro/x.webp']);
  assert.equal(rec.datePublished, '2025-06-12T00:00:00.000Z');
  assert.equal(rec.dateModified, '2025-06-12T00:00:00.000Z');
  assert.deepEqual(rec.author, { '@type': 'Person', name: 'Naresh', url: 'https://gbti.network/members/nareshdevineni/' });
  assert.equal(rec.publisher, GBTI_ORGANIZATION);
  assert.equal(rec.mainEntityOfPage['@id'], 'https://gbti.network/articles/x/');

  const later = articleJsonLd({ url: 'u', headline: 'h', publishedAt: '2025-06-12', updatedAt: '2025-09-16', author });
  assert.equal(later.dateModified, '2025-09-16T00:00:00.000Z');
  const parsed = JSON.parse(jsonForScript(articleJsonLd({ url: 'u', headline: 'h', description: '', publishedAt: 'not a date', author })));
  assert.equal('description' in parsed, false, 'an empty description is left out, not sent blank');
  assert.equal('datePublished' in parsed, false, 'a date that does not parse is left out, not sent as "Invalid Date"');
});

test('the network writes as the organization; a member without a profile page has no url', () => {
  assert.equal(authorNode({ network: true, name: 'GBTI Network' }), GBTI_ORGANIZATION);
  assert.deepEqual(authorNode({ name: 'someone' }), { '@type': 'Person', name: 'someone' });
});

test('breadcrumbs number from 1 and the page itself may leave its address out', () => {
  const b = breadcrumbJsonLd([{ name: 'GBTI Network', url: 'https://gbti.network/' }, { name: 'Articles', url: 'https://gbti.network/articles/' }, { name: 'X' }]);
  assert.deepEqual(b.itemListElement.map((i) => i.position), [1, 2, 3]);
  assert.equal(b.itemListElement[1].item, 'https://gbti.network/articles/');
  assert.equal('item' in b.itemListElement[2], false);
});

test('the homepage records keep only absolute social profiles', () => {
  const [site, org] = siteJsonLd({ sameAs: ['https://x.com/gbti_network', '/membership/', 'https://github.com/gbti-network'] });
  assert.equal(site['@type'], 'WebSite');
  assert.equal(site.name, 'GBTI Network');
  assert.deepEqual(org.sameAs, ['https://x.com/gbti_network', 'https://github.com/gbti-network']);
});

test('the article page and the homepage pass their records through the layout', () => {
  assert.match(read('src/layouts/BaseLayout.astro'), /type="application\/ld\+json" is:inline set:html=\{jsonForScript\(jsonLd\)\}/);
  assert.match(read('src/pages/articles/[slug].astro'), /jsonLd=\{jsonLd\}/);
  assert.match(read('src/pages/index.astro'), /jsonLd=\{siteJsonLd\(/);
});

test('no page writes a bare JSON.stringify into a script element except the static speculation rules', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(astro|mdx)$/.test(e.name)) {
        read(rel).split('\n').forEach((line, i) => { if (/set:html=\{JSON\.stringify\(/.test(line)) hits.push(`${rel}:${i + 1}`); });
      }
    }
  };
  walk('src');
  assert.ok(hits.length >= 1, 'the scan found nothing at all, so it may be looking in the wrong place');
  const allowed = hits.filter((h) => h.startsWith(path.join('src', 'layouts', 'BaseLayout.astro')));
  assert.deepEqual(hits, allowed, `use jsonForScript (src/lib/json-ld.mjs) instead of JSON.stringify at: ${hits.join(', ')}`);
  assert.match(read('src/pages/index.astro'), /id="gbti-personalize-data" set:html=\{jsonForScript\(personalizeData\)\}/);
});
