// sow-378: a body link that leaves the site opens in a new tab, and one that does not is left alone.
//
// WHY THIS EXISTS. The share page's chrome (Visit, the read CTA, the sow-222 source card) has always carried
// target="_blank" rel="noopener nofollow". The rendered BODY had nothing, so a citation in an author note
// replaced the page the reader was on. Measured on the live page before the fix: the note's two links were
// bare `<a href="...">` while every chrome link beside them was decorated.
//
// The interesting cases are the ones that must NOT be touched. A footnote marker and its back-reference are
// fragment links (`#user-content-fn-1`), and opening those in a new tab would break footnotes outright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isExternalHref, relFor, rehypeExternalLinks } from '../src/lib/rehype-external-links.mjs';

const a = (href, props = {}) => ({ type: 'element', tagName: 'a', properties: { href, ...props }, children: [] });
const run = (tree) => { rehypeExternalLinks()(tree); return tree; };

test('sow-378: an href leaving the site is external, and everything else is not', () => {
  for (const h of ['https://www.youtube.com/watch?v=x', 'http://example.com', 'https://EXAMPLE.com/a']) {
    assert.equal(isExternalHref(h), true, h);
  }
  for (const h of [
    '/blog/a-post/', '#user-content-fn-1', '#user-content-fnref-2', '', null, undefined,
    'https://gbti.network/about/', 'https://www.gbti.network/about/', 'https://GBTI.network/x',
    'mailto:opportunities@gbti.network', 'javascript:alert(1)', 'not a url', './images/a.png',
  ]) {
    assert.equal(isExternalHref(h), false, JSON.stringify(h));
  }
});

test('sow-378: rel is merged, never replaced, so a value another pass set survives', () => {
  assert.deepEqual(relFor(undefined), ['noopener', 'nofollow']);
  assert.deepEqual(relFor('nofollow'), ['nofollow', 'noopener'], 'no duplicate, and the existing order is kept');
  assert.deepEqual(relFor(['sponsored']), ['sponsored', 'noopener', 'nofollow']);
  assert.deepEqual(relFor('noopener nofollow'), ['noopener', 'nofollow']);
});

test('sow-378: the pass decorates external links and leaves internal ones untouched', () => {
  const ext = a('https://www.youtube.com/watch?v=XMMP-T3EF8s');
  const internal = a('/blog/a-post/');
  const footnote = a('#user-content-fn-1', { dataFootnoteRef: true });
  const backref = a('#user-content-fnref-1', { dataFootnoteBackref: true });
  run({ type: 'root', children: [ext, internal, { type: 'element', tagName: 'p', children: [footnote, backref] }] });

  assert.equal(ext.properties.target, '_blank');
  assert.deepEqual(ext.properties.rel, ['noopener', 'nofollow']);
  for (const n of [internal, footnote, backref]) {
    assert.equal(n.properties.target, undefined, `${n.properties.href} must stay in this tab`);
    assert.equal(n.properties.rel, undefined);
  }
});

test('sow-378: the pass runs after the sanitizer and before the sponsored pass', () => {
  // Order is load-bearing twice over: before the sanitizer these attributes are stripped, and after the
  // sponsored pass this one would append nofollow/noopener to a rel that pass sets deliberately.
  const cfg = fs.readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
  const chain = (/^\s*rehypePlugins:.*$/m.exec(cfg) || [''])[0];
  // A guard that reads a line it cannot find passes vacuously, so prove the line was located first.
  assert.match(chain, /rehypeSanitize/, 'the rehype chain line was not found, so this guard checked nothing');
  assert.ok(chain.indexOf('rehypeSanitize') < chain.indexOf('rehypeExternalLinks'), 'must run after the sanitizer');
  assert.ok(chain.indexOf('rehypeExternalLinks') < chain.indexOf('rehypeSponsoredLinks'), 'must run before the sponsored pass');
});
