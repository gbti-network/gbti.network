// sow-296: ONE feed list, two hosts. The website's FEED_NAV and the extension's tab row are both built from
// client-ui/src/feed-nav.mjs, so a label or an order change lands on both. Before this, the seven entries were
// written out twice (src/lib/site-nav.ts and the extension's left rail) and agreed only by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEED_TABS, FEED_TAB_KEYS, feedTabLabel } from '../client-ui/src/feed-nav.mjs';
import { feedTabs, typeForTabKey, tabKeyForType, TYPE_FILTERS } from '../client-ui/src/feed-route.mjs';
import { readFileSync } from 'node:fs';

// node --test cannot import the site's TypeScript, so the WEBSITE half is guarded at the source: site-nav.ts must
// READ the shared list rather than carry its own copy of the seven entries. The Astro build is what proves the
// import resolves; this is what catches someone pasting the list back in beside it.
test('the website nav reads the shared list instead of carrying its own copy', () => {
  const src = readFileSync(new URL('../src/lib/site-nav.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ FEED_TABS \} from '\.\.\/\.\.\/client-ui\/src\/feed-nav\.mjs'/);
  assert.match(src, /FEED_TABS\.map\(/, 'FEED_NAV is derived from the shared list');
  const feedNav = src.slice(src.indexOf('export const FEED_NAV'), src.indexOf('export const FOOTER_FEED_LINKS'));
  for (const label of FEED_TABS.map((t) => t.label)) {
    assert.ok(!feedNav.includes(`'${label}'`), `FEED_NAV hardcodes the label ${label}`);
  }
});

test('every tab resolves to a real extension feed type, and back', () => {
  for (const tab of feedTabs()) {
    assert.ok(TYPE_FILTERS.has(tab.type), `${tab.key} -> ${tab.type}`);
    assert.equal(tabKeyForType(tab.type), tab.key);
    assert.equal(tab.href, `newtab.html#type=${tab.type}`);
    assert.equal(tab.label, feedTabLabel(tab.key));
  }
  assert.equal(feedTabs().length, FEED_TABS.length);
});

test('an unknown key or type falls back to the river rather than emptying the feed', () => {
  assert.equal(typeForTabKey('nonsense'), 'all');
  assert.equal(typeForTabKey(undefined), 'all');
  assert.equal(tabKeyForType('nonsense'), 'all');
  assert.equal(tabKeyForType('product'), 'projects', 'sow-196: the retired product type still resolves');
  assert.equal(feedTabLabel('nonsense'), '');
});
