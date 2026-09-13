// A sized avatar must never give up width in a flex row. Owner report, 2026-09-13: the share page's sidebar author
// card rendered its 52px avatar at 43x52, a tall oval, because the member headline beside it wrapped and flex took
// the width from the avatar. A sweep of every built page found 15 (the sidebar card on every GBTI Network share
// page) before the fix and 0 after, with no page gaining horizontal overflow at 400px or 1440px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { shareCardHtml } from '../src/lib/feed-share-cards.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

test('the Avatar component pins its size with flex-shrink:0', () => {
  const src = readFileSync(join(ROOT, 'src/components/Avatar.astro'), 'utf8');
  const dim = src.match(/const dim = size \? `([^`]*)` : '';/);
  assert.ok(dim, 'found the sized-avatar style expression');
  assert.match(dim[1], /width:\$\{size\}px;height:\$\{size\}px;/, 'control: this is the size expression');
  assert.match(dim[1], /flex-shrink:0;/, 'a sized avatar in a flex row beside wrapping text squashes into an oval');
});

test('the live share card avatar carries the same rule as the component', () => {
  const html = shareCardHtml({ author: 'gbtilabs', id: '20260913-x', title: 'T', url: 'https://example.com/', visibility: 'public', createdAt: '2026-09-13T00:00:00Z' }, { now: Date.parse('2026-09-13T01:00:00Z'), fallbackImage: '/fb.png' });
  const av = html.match(/<span class="av" style="([^"]*)"/);
  assert.ok(av, 'found the card avatar');
  assert.match(av[1], /width:26px;height:26px;/, 'control: the sized avatar');
  assert.match(av[1], /flex-shrink:0;/);
});
