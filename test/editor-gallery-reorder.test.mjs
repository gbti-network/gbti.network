// sow-268: the gallery row reorder, which the owner chose to drive with drag handles. The index arithmetic
// lives in client-ui/src/gallery.mjs rather than inside the drag handlers, because that is where reordering
// actually goes wrong and it is unreachable from a test once it is tangled up with DOM events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveGalleryRow } from '../client-ui/src/gallery.mjs';

const L = () => ['a', 'b', 'c', 'd'];

test('sow-268: moving DOWN lands where the user dropped it, not one short', () => {
  // The whole reason this is a function. Removing the row first shifts every later index by one, so a naive
  // implementation puts 'a' before 'c' when the user asked for it to sit at index 2.
  assert.deepEqual(moveGalleryRow(L(), 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveGalleryRow(L(), 0, 3), ['b', 'c', 'd', 'a']);
});

test('sow-268: moving UP lands correctly too', () => {
  assert.deepEqual(moveGalleryRow(L(), 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveGalleryRow(L(), 2, 1), ['a', 'c', 'b', 'd']);
});

test('sow-268: a single step in each direction is the keyboard path', () => {
  // ArrowUp / ArrowDown on a focused handle. This is the accessibility half of the owner's drag decision,
  // so it is asserted separately from the drag cases even though it shares the function.
  assert.deepEqual(moveGalleryRow(L(), 1, 0), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveGalleryRow(L(), 1, 2), ['a', 'c', 'b', 'd']);
});

test('sow-268: a no-op move returns the same order rather than corrupting it', () => {
  assert.deepEqual(moveGalleryRow(L(), 2, 2), L());
});

test('sow-268: ArrowUp on the first row and ArrowDown on the last are inert, not destructive', () => {
  // Both are reachable by simply holding a key, so they must not drop or duplicate a row.
  assert.deepEqual(moveGalleryRow(L(), 0, -1), L());
  assert.deepEqual(moveGalleryRow(L(), 3, 4), L());
});

test('sow-268: junk indices and a junk list never throw and never lose a row', () => {
  assert.deepEqual(moveGalleryRow(L(), 9, 0), L());
  assert.deepEqual(moveGalleryRow(L(), -1, 0), L());
  assert.deepEqual(moveGalleryRow(L(), 1.5, 0), L());
  assert.deepEqual(moveGalleryRow(L(), 0, NaN), L());
  assert.deepEqual(moveGalleryRow(null, 0, 1), []);
  assert.deepEqual(moveGalleryRow(undefined, 0, 1), []);
});

test('sow-268: the input array is never mutated, so a failed drag cannot corrupt live state', () => {
  const src = L();
  moveGalleryRow(src, 0, 3);
  assert.deepEqual(src, L(), 'moveGalleryRow must be pure');
});

test('sow-268: every move is a permutation, so no row is ever dropped or duplicated', () => {
  const src = L();
  for (let f = 0; f < 4; f++) for (let t = 0; t < 4; t++) {
    const out = moveGalleryRow(src, f, t);
    assert.equal(out.length, 4, `length changed moving ${f}->${t}`);
    assert.deepEqual([...out].sort(), [...src].sort(), `row lost or duplicated moving ${f}->${t}`);
  }
});
