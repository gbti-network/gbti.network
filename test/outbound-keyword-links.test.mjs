// 2026-10-28: a partner's name in a page body links to its masked partner path, from the `keywords` on a live row of
// house/outbound-links.yml (first: SurfacedBy, owner's affiliate program at 25% lifetime). The owner's rule for how
// many: in each body, the FIRST mention, and the LAST as well when the word appears more than three times.
//
// Also here: the SurfacedBy rows themselves, the project buttons that now carry rel="sponsored", and the share card
// that must still read "surfacedby.com" when its url is a masked path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

import { validateOutboundLinks, keywordLinksOf, updateOutboundLink, linkSummary } from '../membership/outbound-link-edits.mjs';
import { outboundRows, outboundKeywords } from '../scripts/lib/outbound-links-store.mjs';
import { rehypeKeywordLinks, chosenMentions, termPattern } from '../src/lib/rehype-keyword-links.mjs';
import { rehypeExternalLinks } from '../src/lib/rehype-external-links.mjs';
import { rehypeSponsoredLinks, partnerRel, displayHrefOf } from '../src/lib/rehype-sponsored-links.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KEYWORDS = [{ term: 'SurfacedBy', path: '/outbound/surfacedby' }];
const PATHS = outboundRows(ROOT).map(([p]) => p);

/** Markdown through the same link passes, in the same order, as astro.config.mjs runs them. */
function render(md, keywords = KEYWORDS) {
  return String(unified().use(remarkParse).use(remarkGfm).use(remarkRehype)
    .use(rehypeKeywordLinks, { keywords }).use(rehypeExternalLinks).use(rehypeSponsoredLinks, { paths: PATHS })
    .use(rehypeStringify).processSync(md));
}
const keywordLinks = (html) => [...html.matchAll(/<a href="\/outbound\/surfacedby"[^>]*data-keyword-link[^>]*>([^<]*)<\/a>/g)];

const good = (over = {}) => ({ path: '/outbound/x', destination: 'https://example.com/?ref=1', partner: 'example', status: 'live', note: 'why', ...over });

// ---- the store ------------------------------------------------------------------------------------------------

test('the committed store mints the five SurfacedBy paths on the issued code, with the program recorded', () => {
  const rows = Object.fromEntries(outboundRows(ROOT));
  assert.equal(rows['/outbound/surfacedby'], 'https://surfacedby.com/?atp=GBTI', 'exactly the link the program issued');
  assert.equal(rows['/outbound/surfacedby/pricing'], 'https://surfacedby.com/pricing?atp=GBTI');
  assert.equal(rows['/outbound/surfacedby/demo'], 'https://surfacedby.com/demo?atp=GBTI');
  assert.equal(rows['/outbound/surfacedby/docs'], 'https://docs.surfacedby.com/?atp=GBTI');
  assert.equal(rows['/outbound/surfacedby/blog/chatgpt-no-longer-reads-your-page'], 'https://surfacedby.com/blog/chatgpt-no-longer-reads-your-page?atp=GBTI');
  const root = yaml.load(read('house/outbound-links.yml')).links.find((e) => e.path === '/outbound/surfacedby');
  assert.match(root.note, /25% lifetime commission/);
  assert.match(root.note, /https:\/\/surfacedby\.affonso\.io\/success-hub/, 'the admin portal is on the row');
  assert.deepEqual(outboundKeywords(ROOT), KEYWORDS, 'the build links SurfacedBy, and nothing else yet');
});

test('keywords are validated: a list of plain words, and one word belongs to one path', () => {
  const v = (links) => validateOutboundLinks({ links });
  assert.deepEqual(v([good({ keywords: ['SurfacedBy', 'Open GEO'] })]), []);
  assert.match(v([good({ keywords: 'SurfacedBy' })])[0], /keywords that are not a list/);
  for (const bad of ['', 'ab', 'Surfaced(By)', ' SurfacedBy', 7, 'x'.repeat(41)]) {
    assert.match(v([good({ keywords: [bad] })])[0] ?? '', /invalid keyword/, JSON.stringify(bad));
  }
  const dup = v([good({ keywords: ['SurfacedBy'] }), good({ path: '/outbound/y', keywords: ['surfacedby'] })]);
  assert.match(dup[0] ?? '', /repeats the keyword "surfacedby", already on \/outbound\/x/, 'case-insensitively');
});

test('only a LIVE row lends its keywords, and a board edit keeps them', () => {
  const store = { links: [
    good({ path: '/outbound/a', keywords: ['Alpha'] }),
    good({ path: '/outbound/b', status: 'placeholder', keywords: ['Bravo'] }),
    good({ path: '/outbound/c', status: 'retired', keywords: ['Charlie'] }),
  ] };
  assert.deepEqual(keywordLinksOf(store), [{ term: 'Alpha', path: '/outbound/a' }]);
  // The board's repoint (outbound-update) rewrites the row; the keyword must survive it, or one edit would
  // silently stop every mention on the site from linking.
  const { next } = updateOutboundLink(store, { path: '/outbound/a', destination: 'https://example.com/?ref=2' });
  assert.deepEqual(next.links[0].keywords, ['Alpha']);
  assert.deepEqual(linkSummary(next.links[0]).keywords, ['Alpha'], 'and the board sees them');
});

// ---- the mention linker -----------------------------------------------------------------------------------------

test('which mentions are linked: the first, and the last too only past three', () => {
  assert.deepEqual(chosenMentions(0), []);
  assert.deepEqual(chosenMentions(1), [0]);
  assert.deepEqual(chosenMentions(3), [0]);
  assert.deepEqual(chosenMentions(4), [0, 3]);
  assert.deepEqual(chosenMentions(9), [0, 8]);
});

test('one mention is linked, rel=sponsored by the existing pass', () => {
  const html = render('We use SurfacedBy every day.');
  const links = keywordLinks(html);
  assert.equal(links.length, 1);
  assert.equal(links[0][1], 'SurfacedBy');
  assert.match(links[0][0], /rel="sponsored nofollow noopener"/, 'marked by rehypeSponsoredLinks, which runs after it');
});

test('three mentions link only the first; four link the first and the last', () => {
  const three = keywordLinks(render('SurfacedBy one.\n\nSurfacedBy two.\n\nSurfacedBy three.'));
  assert.equal(three.length, 1);
  const four = render('First SurfacedBy.\n\nSecond SurfacedBy.\n\nThird SurfacedBy.\n\nFourth SurfacedBy, the end.');
  const links = keywordLinks(four);
  assert.equal(links.length, 2);
  assert.ok(four.indexOf(links[0][0]) < four.indexOf('Second'), 'the first is in the first paragraph');
  assert.ok(four.lastIndexOf('data-keyword-link') > four.indexOf('Fourth'), 'the last is in the last paragraph');
  // Both chosen mentions in ONE text node must both link, and the text around them survive.
  const same = render('SurfacedBy, SurfacedBy, SurfacedBy and SurfacedBy.');
  assert.equal(keywordLinks(same).length, 2);
  assert.match(same, /<\/a>, SurfacedBy, SurfacedBy and <a /);
});

test('headings, table headers, code and existing links are neither linked nor counted', () => {
  const html = render([
    '## SurfacedBy', '', 'Use `SurfacedBy` in code, or [SurfacedBy docs](https://example.com/).', '',
    '```\nSurfacedBy\n```', '', '| SurfacedBy | Rival |', '| --- | --- |', '| 1 | 2 |', '', 'Then SurfacedBy in prose.',
  ].join('\n'));
  const links = keywordLinks(html);
  assert.equal(links.length, 1, 'only the prose mention counts, so it is the first and only one');
  assert.match(html, /<h2>SurfacedBy<\/h2>/);
  assert.match(html, /<code>SurfacedBy<\/code>/);
  assert.match(html, /<th>SurfacedBy<\/th>/, 'the sortable-table script rebuilds a header from its text, so a link there would vanish');
  assert.match(html, /Then <a href="\/outbound\/surfacedby"/);
});

test('an address, a handle, a path or a lower-case package name is not a mention of the brand', () => {
  const re = (s) => { const r = termPattern('SurfacedBy'); return r.test(s); };
  for (const s of ['surfacedby.com', 'SurfacedBy.com', 'docs.surfacedby.com', '@SurfacedBy', 'github.com/SurfacedBy/OpenGEO', 'SurfacedBy/OpenGEO', 'SurfacedBy:', 'SurfacedBy_api', 'SurfacedBy-app', 'NotSurfacedBy',
    'pip install surfacedby', 'surfacedby', 'SURFACEDBY']) {
    assert.equal(re(s), false, s);
  }
  for (const s of ['SurfacedBy', "SurfacedBy's", 'SurfacedBy.', 'SurfacedBy, then', '(SurfacedBy)', 'with SurfacedBy Console']) {
    assert.equal(re(s), true, s);
  }
});

test('the committed SurfacedBy project body gets exactly two links: the first prose mention and the last', () => {
  const md = read('members/bomsn/projects/surfacedby/index.md').split(/^---$/m).slice(2).join('---');
  const html = render(md);
  const links = keywordLinks(html);
  assert.equal(links.length, 2, 'six prose mentions, so the first and the last');
  assert.match(html, /<h2>SurfacedBy<\/h2>/, 'the heading is the brand on its own page and stays plain');
  assert.match(html, /<p><a href="\/outbound\/surfacedby"[^>]*>SurfacedBy<\/a> tracks how AI assistants/);
  assert.match(html, /in the <a href="\/outbound\/surfacedby"[^>]*>SurfacedBy<\/a> Console/);
  // Absolute, like every other partner link in a body: the extension and WorkBench renderer (client/src/markdown.mjs)
  // links only http(s) urls, so a relative one would show there as raw markdown.
  assert.match(html, /<a href="https:\/\/gbti\.network\/outbound\/surfacedby\/pricing" rel="sponsored nofollow noopener">pricing page<\/a>/);
});

// ---- outside the body ---------------------------------------------------------------------------------------------

test('partnerRel marks a partner path, relative or absolute, and leaves every other link alone', () => {
  for (const u of ['https://gbti.network/outbound/surfacedby', '/outbound/surfacedby/pricing', 'https://www.gbti.network/outbound/surfacedby/']) {
    assert.equal(partnerRel(u, PATHS), 'sponsored nofollow noopener', u);
  }
  for (const u of ['https://surfacedby.com/', 'https://github.com/surfacedby/OpenGEO', '/projects/surfacedby/', '', undefined]) {
    assert.equal(partnerRel(u, PATHS), 'noopener', String(u));
  }
});

test('a masked share url still shows the partner domain on its card', () => {
  const rows = outboundRows(ROOT);
  const masked = 'https://gbti.network/outbound/surfacedby/blog/chatgpt-no-longer-reads-your-page';
  assert.equal(new URL(displayHrefOf(masked, rows)).hostname, 'surfacedby.com');
  assert.equal(displayHrefOf('https://example.com/a', rows), 'https://example.com/a', 'a plain link is untouched');
  assert.equal(displayHrefOf('https://gbti.network/blog/x/', rows), 'https://gbti.network/blog/x/', 'so is our own page');
});

test('the project page, the feed card and the share page use the helpers (source pins)', () => {
  const page = read('src/pages/projects/[slug].astro');
  assert.doesNotMatch(page, /href=\{primary\.url\} rel="noopener"/, 'a primary button kept the plain rel');
  assert.equal((page.match(/rel=\{relOf\(primary\.url\)\}/g) || []).length, 2, 'both primary buttons');
  assert.match(page, /class="pd-rail-link" href=\{l\.url\} rel=\{relOf\(l\.url\)\}/, 'the rail links');
  assert.match(read('src/lib/feed-items.ts'), /new URL\(displayHrefOf\(d\.url, partnerRows\(\)\)\)\.hostname/);
  assert.match(read('src/pages/shares/[author]/[id].astro'), /new URL\(displayHrefOf\(link, outboundRows\(process\.cwd\(\)\)\)\)\.hostname/);
});

test('no SurfacedBy link on the site skips the masked paths, and every masked one it uses exists', () => {
  const paths = new Set(PATHS);
  for (const f of ['members/bomsn/projects/surfacedby/index.md', 'members/bomsn/shares/20260928191738-chatgpt-no-longer-reads-your-page-before-recomme.md']) {
    const text = read(f).split('\n').filter((l) => !/^imageSource:/.test(l)).join('\n'); // an image credit, not a link
    assert.doesNotMatch(text, /https?:\/\/(?:[a-z0-9-]+\.)*surfacedby\.com/i, `${f} still links SurfacedBy directly`);
    for (const m of text.matchAll(/(?:https:\/\/gbti\.network)?(\/outbound\/surfacedby[^\s)"']*)/g)) {
      assert.ok(paths.has(m[1]), `${f} links ${m[1]}, which is not in the store`);
    }
  }
});

test('the build runs the linker after the sanitizer and before both link passes', () => {
  const cfg = read('astro.config.mjs');
  const chain = cfg.slice(cfg.indexOf('rehypePlugins: ['));
  const at = (name) => chain.indexOf(name);
  assert.ok(at('[rehypeKeywordLinks, { keywords: outboundKeywords(process.cwd()) }]') > at('rehypeIdSafety'), 'after the sanitizer passes');
  assert.ok(at('rehypeKeywordLinks') < at('rehypeExternalLinks'), 'before the new-tab pass');
  assert.ok(at('rehypeKeywordLinks') < at('rehypeSponsoredLinks'), 'before the sponsored pass, which must mark what it inserts');
});

// ---- the extension and account hub (client/src/partner-links.mjs) --------------------------------------------------

test('the client resolves a masked share url through the public link list, and fails to "as it is"', async () => {
  const { maskedPathOf, displayUrlOf, loadPartnerLinks, resetPartnerLinksCache } = await import('../client/src/partner-links.mjs');
  const masked = 'https://gbti.network/outbound/surfacedby/blog/chatgpt-no-longer-reads-your-page';
  assert.equal(maskedPathOf(masked), '/outbound/surfacedby/blog/chatgpt-no-longer-reads-your-page');
  assert.equal(maskedPathOf('https://surfacedby.com/blog/x'), null);
  assert.equal(maskedPathOf('https://gbti.network/blog/x/'), null, 'only partner paths are looked up');
  // The list the client reads is exactly the build artifact the board reads.
  const artifact = { links: outboundRows(ROOT).map(([p, d]) => ({ path: p, destination: d, partner: 'x', status: 'live', note: '' })) };
  resetPartnerLinksCache();
  let calls = 0;
  const fetchImpl = async (u) => { calls += 1; assert.equal(u, 'https://gbti.network/outbound-links.json'); return { ok: true, json: async () => artifact }; };
  const links = await loadPartnerLinks({ fetchImpl });
  await loadPartnerLinks({ fetchImpl });
  assert.equal(calls, 1, 'fetched once per page load');
  assert.equal(new URL(displayUrlOf(masked, links)).hostname, 'surfacedby.com');
  assert.equal(displayUrlOf('https://example.com/a', links), 'https://example.com/a');
  resetPartnerLinksCache();
  assert.deepEqual(await loadPartnerLinks({ fetchImpl: async () => { throw new Error('offline'); } }), [], 'offline reads as no list');
  assert.equal(displayUrlOf(masked, []), masked, 'and the url then shows as it is');
  resetPartnerLinksCache();
});

test('the source card names the real destination while its action keeps the masked path', async () => {
  const { sourceCardModel } = await import('../client/src/share-source.mjs');
  const masked = 'https://gbti.network/outbound/surfacedby/blog/chatgpt-no-longer-reads-your-page';
  const card = sourceCardModel({ url: masked, displayUrl: 'https://surfacedby.com/blog/chatgpt-no-longer-reads-your-page?atp=GBTI', memberName: 'Ali' });
  assert.equal(card.host, 'surfacedby.com');
  assert.equal(card.name, 'surfacedby.com');
  assert.equal(card.action.title, 'Open surfacedby.com');
  assert.equal(card.action.href, masked, 'the click still earns');
  const plain = sourceCardModel({ url: 'https://example.com/a', memberName: 'Ali' });
  assert.equal(plain.host, 'example.com', 'no displayUrl, unchanged behaviour');
});

test('every share surface passes the display url (source pins)', () => {
  const page = read('src/pages/shares/[author]/[id].astro');
  assert.match(page, /sourceCardModel\(\{ url: link, displayUrl: displayHrefOf\(link, outboundRows\(process\.cwd\(\)\)\)/);
  const reader = read('client-ui/src/elements/gbti-reader.mjs');
  assert.match(reader, /this\._srcUrl = maskedPathOf\(shareUrl\) \? displayUrlOf\(shareUrl, await loadPartnerLinks\(\{ site: SITE \}\)\) : null;/);
  assert.match(reader, /faviconFor\(srcUrl\)[\s\S]*faviconFor\(srcUrl\)/, 'both favicons');
  assert.match(reader, /\$\{shareLinkVerb\(srcUrl\)\} on \$\{esc\(hostOf\(srcUrl\)\)\}/);
  assert.match(reader, /sourceCardModel\(\{ url: it\.url, displayUrl: srcUrl,/);
  assert.match(reader, /const sumHost = hostOf\(srcUrl \|\| ''\);/);
  assert.match(reader, /href="\$\{esc\(shareOut\)\}"/, 'the reader link still goes through the masked url');
  const feed = read('client-ui/src/elements/gbti-shares-feed.mjs');
  assert.match(feed, /\$\{shareLinkVerb\(shown\)\} on \$\{esc\(hostOf\(shown\)\)\}/);
  assert.match(feed, /href="\$\{esc\(utmLink\(share\.url,/, 'the feed link still goes through the masked url');
});
