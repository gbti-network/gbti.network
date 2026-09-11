// The compact WorkBench editor under a comment (owner, 2026-09-11): the same <gbti-doc-editor>, with the
// palette a reply needs and none of an article's tools. The palette subset is pure; the element's compact
// mode is pinned in source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { paletteFor, COMPACT_KEYS, commentBodyTooLong, COMMENT_MAX_BYTES } from '../client-ui/src/doc-editor-core.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const FULL = ['paragraph', 'h1', 'h2', 'h3', 'quote', 'callout', 'code', 'ul', 'ol', 'table', 'image', 'embed'].map((key) => ({ key }));

test('paletteFor: compact keeps text, quote, code, the two lists and a video, in the full order; full returns a copy', () => {
  assert.deepEqual(paletteFor(FULL, { compact: true }).map((c) => c.key), ['paragraph', 'quote', 'code', 'ul', 'ol', 'embed']);
  assert.deepEqual(COMPACT_KEYS, ['paragraph', 'quote', 'code', 'ul', 'ol', 'embed']);
  const full = paletteFor(FULL);
  assert.deepEqual(full.map((c) => c.key), FULL.map((c) => c.key));
  assert.notEqual(full, FULL, 'a copy, never the shared list');
  assert.deepEqual(paletteFor(null, { compact: true }), []);
  for (const gone of ['image', 'h1', 'h2', 'h3', 'table', 'callout']) assert.ok(!paletteFor(FULL, { compact: true }).some((c) => c.key === gone), `${gone} is not offered under a comment`);
});

test('commentBodyTooLong: the 8000-byte cap counts bytes, not characters', () => {
  assert.equal(COMMENT_MAX_BYTES, 8000);
  assert.equal(commentBodyTooLong('x'.repeat(8000)), false);
  assert.equal(commentBodyTooLong('x'.repeat(8001)), true);
  assert.equal(commentBodyTooLong('é'.repeat(4001)), true, 'two bytes each');
  assert.equal(commentBodyTooLong(''), false);
});

test('the element: every palette menu reads the mode, the members-only split is not offered compact, and the compact host is a bordered reply-sized field', () => {
  const src = read('client-ui/src/elements/gbti-doc-editor.mjs');
  assert.match(src, /get compact\(\) \{ return this\.hasAttribute\('compact'\); \}/);
  assert.match(src, /_palette\(\) \{ return paletteFor\(CONVERT, \{ compact: this\.compact \}\); \}/);
  assert.equal((src.match(/this\._palette\(\)\.(map|filter)\(/g) || []).length, 3, 'the add menu, the turn-into menu and the slash menu');
  assert.doesNotMatch(src, /CONVERT\.map\(|CONVERT\.filter\(/, 'no menu reads the full list directly');
  assert.match(src, /\$\{\(hasMembers \|\| this\.compact\) \? '' : `<button class="add-btn" data-addmembers/);
  assert.match(src, /:host\(\[compact\]\) \.doc-blocks \{ min-height:90px; border:1\.5px solid var\(--s-line\); border-radius:10px;/);
  assert.match(src, /:host\(\[compact\]\) \{ --blk-gutter:118px; \}/);
});
