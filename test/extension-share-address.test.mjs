// A share opened in the extension gets a real address (owner, 2026-10-17). Chrome hides the address of the overridden
// new tab, so opening a share from the feed must LOAD the share's own page; a hash rewrite alone never shows. These pin
// the address, the open decision, and the hand-over that makes the load feel instant. Pure; no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  shareSlugOf, shareAddress, isSharePage, openMode, writeHandoff, takeHandoff, shareTitle, SHARE_HANDOFF_KEY,
} from '../extension/src/share-address.mjs';
import { parseBrowseHash } from '../client-ui/src/browse-hash.mjs';
import { resolveOpenPage } from '../extension/src/open-page.mjs';

const SHARE = { type: 'share', author: 'gbtilabs', id: '20260927010634-dms519-age-of-enlightenment-drum-and-bass-mix', title: 'DMS519 - Age Of Enlightenment - Drum and Bass MIX' };
const SLUG = `${SHARE.author}/${SHARE.id}`;
const store = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('a share\'s address is a real page load that the new tab already knows how to read', () => {
  const addr = shareAddress(SLUG);
  assert.equal(addr, `newtab.html?view=share#tab=share&read=${encodeURIComponent(SLUG)}`);
  const u = new URL(addr, 'chrome-extension://abc/');
  assert.equal(u.pathname, '/newtab.html');
  assert.equal(isSharePage(u.search), true, 'the query is what makes it a different document from the new tab');
  assert.deepEqual(parseBrowseHash(u.hash), { tab: 'share', read: SLUG, action: null }, 'the existing deep-link parser reads it');
  assert.equal(isSharePage(''), false);
  assert.equal(isSharePage('?view=other'), false);
});

test('only a share opened away from the share page loads its address; everything else opens in place', () => {
  assert.equal(openMode(SHARE, ''), 'load', 'from the new tab');
  assert.equal(openMode(SHARE, '?view=share'), 'inplace', 'already on a visible address');
  assert.equal(openMode({ type: 'post', path: 'members/a/posts/x/index.md' }, ''), 'inplace');
  assert.equal(openMode({ type: 'share', author: 'a' }, ''), 'inplace', 'a share without an id has no address');
  assert.equal(shareSlugOf({ type: 'post', author: 'a', id: 'b' }), null);
});

test('the hand-over delivers the share once, only to the page it names, and says whether it came from a feed', () => {
  const s = store();
  assert.equal(writeHandoff(s, SHARE, { fromFeed: true }), true);
  assert.deepEqual(takeHandoff(s, SLUG), { item: SHARE, fromFeed: true });
  assert.equal(s.m.has(SHARE_HANDOFF_KEY), false, 'consumed');
  assert.equal(takeHandoff(s, SLUG), null, 'a reload of the bookmarked address resolves the share itself');
  writeHandoff(s, SHARE);
  assert.equal(takeHandoff(s, 'someone/else'), null, 'a different address never shows this share');
  assert.equal(s.m.has(SHARE_HANDOFF_KEY), false, 'and the stale hand-over is cleared anyway');
  writeHandoff(s, SHARE);
  assert.equal(takeHandoff(s, SLUG).fromFeed, false, 'a deep link is not a feed click');
  s.setItem(SHARE_HANDOFF_KEY, '{not json');
  assert.equal(takeHandoff(s, SLUG), null);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.equal(writeHandoff(blocked, SHARE), false);
  assert.equal(takeHandoff(blocked, SLUG), null);
  assert.equal(writeHandoff(null, SHARE), false);
});

test('the tab is named after the share, so a bookmark is too', () => {
  assert.equal(shareTitle(SHARE), 'DMS519 - Age Of Enlightenment - Drum and Bass MIX · GBTI Network');
  assert.equal(shareTitle({}), 'Share · GBTI Network');
});

test('the new tab loads the address for a share clicked in the feed, and shows the handed-over share on arrival', () => {
  const src = readFileSync(new URL('../extension/src/newtab.mjs', import.meta.url), 'utf8');
  assert.match(src, /addEventListener\('card-open', \(e\) => openReader\(e\.detail\?\.item, \{ fromFeed: true \}\)\)/);
  assert.match(src, /if \(!inPlace && openMode\(item, location\.search\) === 'load'\) \{/);
  assert.match(src, /if \(fromFeed\) location\.assign\(to\); else location\.replace\(to\);/, 'a deep link replaces, so Back never loops');
  assert.match(src, /takeHandoff\(tabStorage\(\), deepRead\)/);
  assert.match(src, /openReader\(item, \{ inPlace: true \}\); \/\/ a just-posted share stays here/);
  // A link arriving in an already open tab: the item is read before the feed switch strips it from the address.
  const hc = src.slice(src.indexOf("window.addEventListener('hashchange'"));
  assert.ok(hc.indexOf('const rd = readFromHash();') < hc.indexOf('selectType(t);'), 'read= is taken before selectType clears it');
});

test('the website\'s hand-off into the extension still passes the open-page allowlist with the share hash', () => {
  // The website opens newtab.html#tab=share&read=<encoded slug> in a new tab; that tab then loads the share's address.
  assert.equal(resolveOpenPage({ page: 'newtab.html', hash: `tab=share&read=${encodeURIComponent(SLUG)}` }), `newtab.html#tab=share&read=${encodeURIComponent(SLUG)}`);
});
