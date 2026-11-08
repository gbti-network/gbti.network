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
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeIframeHostAllowlist, rehypeStyleAllowlist, rehypeIdSafety } from '../src/lib/markdown-sanitize.mjs';

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

// 2026-11-08, owner: "make sure the footnotes links are nofollow please". They already were: the footnotes section is
// part of the body tree, so this pass reaches it (measured on a live article: 3 of 3 source links carried nofollow).
// Nothing pinned it, though. This runs the real markdown chain, in astro.config.mjs order, over a footnote whose
// definition links out, one cited from inside an ```faq answer (sow-495, whose answers are spliced in as parsed
// markdown), and one that links back to the site.
test('owner 2026-11-08: a source link in a footnote is nofollow on the published page; the back arrows and own-site links are not', async () => {
  const md = 'Servers report to bStats.[^a]\n\n```faq\nQ: Why?\nHypixel said so.[^b]\n```\n\nOur own note.[^c]\n\n'
    + '[^a]: [bStats](https://bstats.org/global/bukkit): the charts.\n\n[^b]: [Hypixel](https://hypixel.net/threads/x.1/): the post.\n\n'
    + '[^c]: [About GBTI](https://gbti.network/about/): our page.\n';
  const html = String(await unified()
    .use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
    .use(rehypeIframeHostAllowlist).use(rehypeStyleAllowlist).use(rehypeIdSafety)
    .use(rehypeExternalLinks).use(rehypeStringify).process(md));
  const section = (/<section[^>]*data-footnotes[\s\S]*?<\/section>/.exec(html) || [''])[0];
  assert.ok(section, 'the footnotes section was not found, so nothing below checks anything');
  const links = section.match(/<a\b[^>]*>/g) || [];
  for (const href of ['https://bstats.org/global/bukkit', 'https://hypixel.net/threads/x.1/']) {
    const tag = links.find((t) => t.includes(`href="${href}"`));
    assert.ok(tag, `no link to ${href} in the footnotes`);
    assert.match(tag, /rel="noopener nofollow"/, `${href} must be nofollow`);
    assert.match(tag, /target="_blank"/);
  }
  const own = links.find((t) => t.includes('href="https://gbti.network/about/"'));
  assert.ok(own);
  assert.doesNotMatch(own, /nofollow/, 'a link back to the site is not nofollow');
  const back = links.filter((t) => t.includes('data-footnote-backref'));
  assert.equal(back.length, 3, 'one back arrow per note');
  for (const t of back) assert.doesNotMatch(t, /\brel=|target=/, 'a back arrow stays a plain in-page link');
});
