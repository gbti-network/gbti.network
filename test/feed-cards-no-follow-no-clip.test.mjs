// Two owner reports on the homepage feed cards, 2026-09-13.
//
// 1. "follow actions should be on content pages not feed entity entries". A feed card carried a Follow pill (a
//    megaphone icon) for its author, built in two places: the server-rendered card (FeedList.astro) and the live
//    share card the feed merges in on the client (feed-share-cards.mjs). Both must stay free of it, or the next
//    live share reintroduces a pill the server card no longer has.
// 2. The Save to collection popover was clipped: the card-view feed card set overflow: hidden (only to round the
//    cover image), and the popover opens below the pill and past the card, so its list and Create field could
//    not be seen or clicked. Measured before the fix by hit-testing inside the open popover: 0 of 4 points
//    reachable on the homepage, 1 of 4 on /feeds/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { shareCardHtml } from '../src/lib/feed-share-cards.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const markup = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FOLLOW = /follow-pill|feed-follow|data-follow-user|ico-mega/;

test('the server-rendered feed card carries no follow control', () => {
  const list = markup(read('src/components/feeds/FeedList.astro') + read('src/components/feeds/FeedCard.astro')); // sow-323 Phase 3: the card moved into FeedCard
  assert.match(list, /<FavoriteButton /, 'control: the read found the card markup (it still renders the heart)');
  assert.doesNotMatch(list, FOLLOW);
  assert.doesNotMatch(list, /setFollow|getFollows/, 'and no follow wiring is left behind');
});

test('the live share card the feed merges in carries no follow control', () => {
  const html = shareCardHtml({ author: 'atwellpub', id: '20260913-x', title: 'T', url: 'https://example.com/', visibility: 'public', createdAt: '2026-09-13T00:00:00Z' }, { now: Date.parse('2026-09-13T01:00:00Z'), fallbackImage: '/fb.png' });
  assert.match(html, /<gbti-collection /, 'control: the builder produced a card (it still renders Save)');
  assert.doesNotMatch(html, FOLLOW);
});

test('the stylesheet keeps no card-view follow rules', () => {
  assert.doesNotMatch(read('src/styles/gbti-v3.css'), /follow-pill|follow-t\b/);
});

test('the card-view feed card does not clip, and the cover rounds its own top corners', () => {
  const css = read('src/styles/gbti-v3.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const item = css.match(/\.feed-page\[data-view="card"\] \.feed-item \{([^}]*)\}/);
  assert.ok(item, 'found the card-view feed item rule');
  assert.match(item[1], /border-radius: var\(--r-lg\)/, 'control: this is the rounded card rule');
  assert.doesNotMatch(item[1], /overflow\s*:\s*(hidden|clip)/, 'a clipped card hides the Save to collection popover');
  const cover = css.match(/\.feed-page\[data-view="card"\] \.feed-cover \{([^}]*)\}/);
  assert.ok(cover, 'found the card-view cover rule');
  assert.match(cover[1], /border-radius: calc\(var\(--r-lg\) - 1\.5px\) calc\(var\(--r-lg\) - 1\.5px\) 0 0/, 'the cover keeps the card corners without the card clipping');
});
