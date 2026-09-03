// sow-196: the product -> project rename, and the compatibility that has to outlive it.
//
// The rename itself is uninteresting to test: the build fails loudly if the collection or a route is wrong.
// What CANNOT fail loudly is the other half. Every one of these boundaries reads a type string that was
// PERSISTED before 2026-09-02, and every one of them drops what it does not recognise WITHOUT an error, a
// log line, or an empty-state a person would notice. So each case below is paired with its consequence, and
// each is written so it would fail if the alias were removed.
import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalType, legacyNamesOf, typeKeysFor, LEGACY_TYPE_ALIASES } from '../membership/content-types.mjs';
import { canonicalType as uiCanonicalType, LEGACY_TYPE_ALIASES as UI_ALIASES } from '../client-ui/src/content-types.mjs';
import { normalizeActivity, filterActivity } from '../membership/member-activity.mjs';
import { normalizeTouches } from '../membership/member-touches.mjs';
import { aggregateFavoriteCounts } from '../scripts/lib/favorite-counts.mjs';
import { buildQueueItem } from '../membership/syndication-queue.mjs';
import { readCommentsIndex, typeSlugKey } from '../scripts/lib/collaboration-gather.mjs';
import { TYPE_BASE, publicUrlFor } from '../client-ui/src/public-url.mjs';
import { RENAME_URL_BASE } from '../client/src/operations-publish.mjs';
import { RENAME_URL_BASE as WB_RENAME_URL_BASE } from '../src/lib/workbench-client-core.mjs';
import { contentItemPath } from '../src/lib/content-index.mjs';

test('canonicalType resolves a retired name, passes everything else through untouched', () => {
  assert.equal(canonicalType('product'), 'project');
  assert.equal(canonicalType('post'), 'post');
  assert.equal(canonicalType('prompt'), 'prompt');
  assert.equal(canonicalType('project'), 'project', 'already-current names are idempotent');
  // Arbitrary caller input is safe to pass in: it comes back unchanged rather than throwing or becoming ''.
  assert.equal(canonicalType('nonsense'), 'nonsense');
  assert.equal(canonicalType(null), '');
  assert.equal(canonicalType(undefined), '');
  assert.equal(canonicalType({}), '');
  // Object.prototype keys must not resolve through the alias map.
  assert.equal(canonicalType('constructor'), 'constructor');
  assert.equal(canonicalType('__proto__'), '__proto__');
});

test('legacyNamesOf and typeKeysFor put the CURRENT name first so a first-hit read never double counts', () => {
  assert.deepEqual(legacyNamesOf('project'), ['product']);
  assert.deepEqual(legacyNamesOf('post'), []);
  assert.deepEqual(typeKeysFor('project', 'radle'), ['project:radle', 'product:radle']);
  assert.deepEqual(typeKeysFor('post', 'hello'), ['post:hello']);
});

test('the client-ui MIRROR agrees with the canonical module, so the browser copy cannot drift silently', () => {
  // client-ui is a browser bundle and imports nothing from membership/, so the alias map is duplicated there.
  // A drift here means a deep link resolves on the server and not in the extension, or the reverse.
  assert.deepEqual(UI_ALIASES, LEGACY_TYPE_ALIASES);
  for (const name of [...Object.keys(LEGACY_TYPE_ALIASES), 'post', 'prompt', 'share', 'nonsense', '']) {
    assert.equal(uiCanonicalType(name), canonicalType(name), `mirror disagrees on ${JSON.stringify(name)}`);
  }
});

test("CONSEQUENCE a member's saved shelf empties: a stored `product` favorite survives normalizeActivity", () => {
  const stored = {
    favorites: [{ type: 'product', slug: 'radle', addedAt: 1 }],
    collections: [{ id: 'c1', name: 'Tools', createdAt: 1, items: [{ type: 'product', slug: 'ryker', addedAt: 1 }] }],
  };
  const a = normalizeActivity(stored);
  assert.deepEqual(a.favorites, [{ type: 'project', slug: 'radle', addedAt: 1 }]);
  assert.deepEqual(a.collections[0].items, [{ type: 'project', slug: 'ryker', addedAt: 1 }]);
  // And the Saved view's chip row: an old chip value still selects the items it names.
  assert.equal(filterActivity(stored, ['product']).favorites.length, 1);
  assert.equal(filterActivity(stored, ['project']).favorites.length, 1);
  // The control: normalizeActivity really does DISCARD an unknown type, silently. That is the whole risk.
  assert.deepEqual(normalizeActivity({ favorites: [{ type: 'widget', slug: 'x', addedAt: 1 }] }).favorites, []);
});

test('CONSEQUENCE a member loses revenue attribution: a stored `product` touch survives normalizeTouches', () => {
  const stored = { items: [{ owner: 'atwellpub', type: 'product', slug: 'radle', firstAt: 1, lastAt: 2 }], invite: null, updatedAt: 2 };
  const t = normalizeTouches(stored);
  assert.equal(t.items.length, 1, 'a first-touch record dropped here is a member silently not being paid');
  assert.equal(t.items[0].type, 'project', 'and it is REWRITTEN, so the next save persists the current name');
  // The control: an unknown type is dropped, which is exactly what would happen to `product` without the alias.
  assert.equal(normalizeTouches({ items: [{ owner: 'a', type: 'widget', slug: 'x', firstAt: 1, lastAt: 2 }] }).items.length, 0);
});

test('CONSEQUENCE counts split across two keys and read 0: the KV -> git fold canonicalizes', () => {
  // Two members, one favoriting under the OLD name and one under the new, must fold to ONE key with 2.
  const counts = aggregateFavoriteCounts([
    { favorites: [{ type: 'product', slug: 'radle' }] },
    { favorites: [{ type: 'project', slug: 'radle' }] },
  ]);
  assert.deepEqual(counts, { 'project:radle': 2 });
});

test('CONSEQUENCE a publish never announces: a queue item enqueued under the old name still drains', () => {
  const item = buildQueueItem({ source: 'product', targetSlug: 'radle', visibility: 'public' }, { now: () => 0 });
  assert.equal(item.source, 'project');
});

test('CONSEQUENCE commenters drop out of the payout pool: a legacy comment indexes under the current type', () => {
  const files = ['c1.md'];
  const readFile = () => '---\ntype: comment\nauthor: dana\ntargetType: product\ntargetSlug: radle\ncreatedAt: 1\n---\nx';
  const idx = readCommentsIndex('/root', { files, readFile });
  assert.equal(idx.get(typeSlugKey('project', 'radle'))?.length, 1);
});

test('CONSEQUENCE the alias is silently clobbered: the type-keyed URL maps still answer for the old name', () => {
  // This case exists because it ALREADY HAPPENED during the rename. A bulk key rename turned every
  // `{ project: X, product: X }` pair into `{ project: X, project: X }`, a duplicate key that JavaScript
  // collapses without complaint. Behaviour for the CURRENT name stayed correct, the whole suite stayed
  // green, and every legacy alias was gone. Only an esbuild warning caught it.
  //
  // So these assert BEHAVIOUR for the retired name rather than the shape of a map, and they are the reason
  // a future bulk edit cannot quietly delete the compatibility again.
  for (const [label, map] of [['client-ui TYPE_BASE', TYPE_BASE], ['client RENAME_URL_BASE', RENAME_URL_BASE], ['workbench RENAME_URL_BASE', WB_RENAME_URL_BASE]]) {
    for (const legacy of Object.keys(LEGACY_TYPE_ALIASES)) {
      const current = LEGACY_TYPE_ALIASES[legacy];
      assert.ok(map[legacy] !== undefined, `${label} lost its "${legacy}" alias`);
      assert.equal(map[legacy], map[current], `${label} sends "${legacy}" somewhere other than "${current}"`);
    }
  }
  assert.equal(publicUrlFor({ type: 'product', slug: 'radle' }), publicUrlFor({ type: 'project', slug: 'radle' }));
  assert.equal(contentItemPath('product', 'bob', 'radle'), contentItemPath('project', 'bob', 'radle'));
});
