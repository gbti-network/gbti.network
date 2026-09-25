// sow-399: Manually syndicate moved from the extension reader to the website's content pages. The button posts
// what its data-gbti-* attributes say, so the website must fill them by the reader's rules. These tests pin the
// rules, and pin that the website helper covers EVERY attribute the element reads: an attribute the element
// gains later, and the website never sends, would post with that detail silently missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syndicateAttrs } from '../src/lib/syndicate-attrs.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const LINKS = { discord: 'hud#1', x: 'hudx', bluesky: 'hud.bsky.social', mastodon: '@hud@m.social', reddit: 'hudr', devto: 'hudd' };

test('an article: its own slug, its absolute page, the top-level category and the full path', () => {
  const a = syndicateAttrs({
    type: 'post', slug: 'my-post', author: 'atwellpub', authorName: 'Hudson', title: 'My post', blurb: 'Short.',
    url: 'https://gbti.network/articles/my-post/', visibility: 'members', categories: ['ai', 'prompts', 'skill'],
    tags: ['llm', '', 3, 'agents'], links: LINKS, image: '/_astro/x.webp',
  });
  assert.equal(a['data-gbti-type'], 'post');
  assert.equal(a['data-gbti-slug'], 'my-post');
  assert.equal(a['data-gbti-url'], 'https://gbti.network/articles/my-post/');
  assert.equal(a['data-gbti-category'], 'ai');
  assert.equal(a['data-gbti-category-path'], 'ai,prompts,skill');
  assert.equal(a['data-gbti-visibility'], 'members');
  assert.equal(a['data-gbti-tags'], 'llm,agents', 'non-string and empty tags are dropped');
  assert.equal(a['data-gbti-author-name'], 'Hudson');
  assert.equal(a['data-gbti-blurb'], 'Short.');
  assert.equal(a['data-gbti-x'], 'hudx');
  assert.equal(a['data-gbti-devto'], 'hudd');
  assert.equal(a['data-gbti-image'], '/_astro/x.webp');
});

test('a share: "<author>/<id>", the shared link, its flat topic and no category path', () => {
  const s = syndicateAttrs({ type: 'share', id: '20260924-x', author: 'gbtilabs', title: 'T', url: 'https://example.com/a', category: 'devops', categories: ['ignored'] });
  assert.equal(s['data-gbti-slug'], 'gbtilabs/20260924-x');
  assert.equal(s['data-gbti-url'], 'https://example.com/a');
  assert.equal(s['data-gbti-category'], 'devops');
  assert.equal('data-gbti-category-path' in s, false);
});

test('empty values are left out, visibility defaults to public, and an unusable item gives null', () => {
  const a = syndicateAttrs({ type: 'prompt', slug: 'p', author: 'gbti', title: 'P', url: 'https://gbti.network/prompts/p/' });
  assert.equal(a['data-gbti-visibility'], 'public');
  for (const k of ['data-gbti-author-name', 'data-gbti-blurb', 'data-gbti-category', 'data-gbti-category-path', 'data-gbti-tags', 'data-gbti-image', 'data-gbti-discord']) {
    assert.equal(k in a, false, `${k} should be absent, not empty`);
  }
  assert.equal(syndicateAttrs({ type: 'news', slug: 'n' }), null);
  assert.equal(syndicateAttrs({ type: 'post' }), null, 'no slug');
  assert.equal(syndicateAttrs({ type: 'share', author: 'a' }), null, 'a share needs its id');
});

test('the website sends every attribute the button reads', () => {
  const src = read('client-ui/src/elements/gbti-syndicate-now.mjs');
  const item = src.slice(src.indexOf('_item() {'), src.indexOf('async _loadInfo()'));
  const read_ = [...item.matchAll(/d\.gbti([A-Z][A-Za-z]*)/g)].map((m) => 'data-gbti-' + m[1].replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase()));
  assert.ok(read_.length >= 15, `control: expected the element to read many attributes, found ${read_.length}`);
  const full = syndicateAttrs({
    type: 'post', slug: 's', author: 'a', authorName: 'A', title: 't', blurb: 'b', url: 'https://gbti.network/articles/s/',
    visibility: 'public', categories: ['c', 'd'], tags: ['x'], links: LINKS, image: '/i.webp',
  });
  for (const attr of new Set(read_)) assert.ok(attr in full, `the element reads ${attr} but the website never sends it`);
});
