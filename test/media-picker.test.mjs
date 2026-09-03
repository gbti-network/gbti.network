// sow-165 (Q36): the pure half of the editor's image reuse picker. The element's fetching and DOM are not
// reachable from node --test, so everything that DECIDES anything lives here and is asserted here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaFor, filterMedia, reusePlan, authorFromItemPath, MEDIA_INDEX_URL } from '../client-ui/src/media-picker.mjs';

const ROW = (name, itemPath, itemTitle) => ({ name, itemPath, itemTitle, type: 'post', slug: 's', author: 'alice' });
const INDEX = {
  byAuthor: {
    alice: [ROW('cover.webp', 'members/alice/posts/one/index.md', 'The Upwork post'), ROW('shot.png', 'members/alice/posts/two/index.md', 'Second piece')],
    bob: [ROW('b.webp', 'members/bob/posts/x/index.md', 'Bob item')],
  },
};

test('sow-165: the picker offers one author and fail-softs everywhere else', () => {
  assert.deepEqual(mediaFor(INDEX, 'alice').map((r) => r.name), ['cover.webp', 'shot.png']);
  assert.deepEqual(mediaFor(INDEX, 'bob').map((r) => r.name), ['b.webp']);
  // A member with no images, a missing index, and a malformed one are all an EMPTY PICKER, never a throw:
  // this runs inside the editor's render path and an exception would take the whole editor down.
  for (const bad of [undefined, null, {}, { byAuthor: null }, { byAuthor: { alice: 'nope' } }]) {
    assert.deepEqual(mediaFor(bad, 'alice'), [], `expected [] for ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(mediaFor(INDEX, 'nobody'), []);
  // A row missing either field cannot address an image, so it is dropped rather than rendered broken.
  assert.deepEqual(mediaFor({ byAuthor: { a: [{ name: 'x' }, { itemPath: 'p' }, ROW('ok.webp', 'members/a/posts/s/index.md')] } }, 'a').map((r) => r.name), ['ok.webp']);
});

test('sow-165: search covers the item TITLE as well as the file name', () => {
  const rows = mediaFor(INDEX, 'alice');
  // The point of searching the title: a member remembers "the Upwork post", not the filename.
  assert.deepEqual(filterMedia(rows, 'upwork').map((r) => r.name), ['cover.webp']);
  assert.deepEqual(filterMedia(rows, 'SHOT').map((r) => r.name), ['shot.png'], 'case-insensitive');
  assert.deepEqual(filterMedia(rows, '  ').map((r) => r.name), ['cover.webp', 'shot.png'], 'a blank query shows everything');
  assert.deepEqual(filterMedia(rows, 'zzz'), []);
  assert.deepEqual(filterMedia(null, 'x'), []);
  // Must not mutate its input, or a search would permanently shrink the cached row list.
  filterMedia(rows, 'upwork');
  assert.equal(rows.length, 2, 'filterMedia must not mutate the rows it is given');
});

test('sow-165: selecting an image from ANOTHER item plans a copy', () => {
  const plan = reusePlan(ROW('cover.webp', 'members/alice/posts/one/index.md'), 'members/alice/posts/two/index.md');
  assert.equal(plan.alreadyHere, false, 'a different item means the bytes must be copied in');
  assert.equal(plan.ref, './images/cover.webp', 'the stored reference is identical to what an upload produces');
  assert.match(plan.sourceUrl, /cdn\.jsdelivr\.net\/gh\/gbti-network\/gbti\.network@main\/members\/alice\/posts\/one\/images\/cover\.webp$/,
    'the source URL resolves against the SOURCE item, which is where the bytes actually are');
});

test('sow-165: selecting an image ALREADY in this item plans no copy', () => {
  // Re-staging it would upload a byte-identical file over itself, and on a host that de-duplicates by name it
  // would look like it worked while doing nothing.
  const here = 'members/alice/posts/one/index.md';
  const plan = reusePlan(ROW('cover.webp', here), here);
  assert.equal(plan.alreadyHere, true);
  assert.equal(plan.ref, './images/cover.webp');
});

test('sow-165: a brand-new unsaved item still gets a usable plan', () => {
  // No itemPath yet (the item has never been saved), so nothing can be "already here" and the copy stands.
  const plan = reusePlan(ROW('cover.webp', 'members/alice/posts/one/index.md'), null);
  assert.equal(plan.alreadyHere, false);
  assert.ok(plan.sourceUrl, 'the source is still addressable without a destination');
  for (const bad of [null, undefined, {}, { name: 'x' }, { itemPath: 'p' }]) {
    assert.equal(reusePlan(bad, 'members/a/posts/s/index.md'), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('sow-165: the author comes from the item folder, and a house item declines to guess', () => {
  assert.equal(authorFromItemPath('members/alice/posts/x/index.md'), 'alice');
  assert.equal(authorFromItemPath('members/gbti-labs/projects/y/index.md'), 'gbti-labs');
  // House content carries whatever author its frontmatter names, so the folder does not identify a member.
  // Offering the wrong person's library is worse than offering none.
  assert.equal(authorFromItemPath('house/posts/x/index.md'), null);
  for (const bad of [null, undefined, '', 'members/', 'members//posts/x', 'nonsense']) {
    assert.equal(authorFromItemPath(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('sow-165: the index URL is absolute so the extension can fetch it cross-origin', () => {
  assert.equal(MEDIA_INDEX_URL, 'https://gbti.network/media-index.json');
});
