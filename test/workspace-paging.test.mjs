// sow-377: the WorkBench pages its lists, including the Shares tab, which did not.
//
// WHY THIS EXISTS. The content tabs and the Pull requests tab each carried their own copy of the same page
// arithmetic, and the Shares tab carried none: `items.map(...)` rendered every row. In Network scope that is
// every share on the network, which the owner met as several hundred rows in one scroll.
//
// Two things are worth guarding rather than one. The obvious one is that the list is sliced. The one that
// actually bites is the INDEX: every row action in these lists is wired by the row's position in the FULL
// list, so a slice rendered with its own 0-based index silently wires page two's Edit buttons to page one's
// items. That is a data-loss shape, not a layout one: you edit a share you did not open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pageWindow, WORKSPACE_PAGE_SIZE } from '../client-ui/src/workspace-core.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('sow-377: a page window is clamped into range and never reports zero pages', () => {
  assert.deepEqual(pageWindow(0, 0), { page: 0, pages: 1, start: 0, end: 0, size: 15 });
  assert.deepEqual(pageWindow(1, 0), { page: 0, pages: 1, start: 0, end: 1, size: 15 });
  // An exact multiple must not manufacture a trailing empty page.
  assert.deepEqual(pageWindow(15, 0), { page: 0, pages: 1, start: 0, end: 15, size: 15 });
  assert.deepEqual(pageWindow(30, 1), { page: 1, pages: 2, start: 15, end: 30, size: 15 });
  assert.equal(pageWindow(31, 0).pages, 3);
});

test('sow-377: a list that shrinks under the reader lands on the last page, not an empty one', () => {
  // The reader is on page 4 of the network shares; a filter or a removal cuts the list to 20.
  const w = pageWindow(20, 3);
  assert.equal(w.page, 1, 'clamped to the last page that has rows');
  assert.equal(w.pages, 2);
  assert.deepEqual([w.start, w.end], [15, 20]);
  // Garbage in, first page out, rather than NaN arithmetic reaching a slice.
  for (const bad of [-5, null, undefined, NaN, 'x', {}]) assert.equal(pageWindow(40, bad).page, 0, String(bad));
  assert.equal(pageWindow(40, 0, 0).size, WORKSPACE_PAGE_SIZE, 'a zero page size falls back rather than dividing by zero');
});

test('sow-377: the window slices a list into pages that lose and duplicate nothing', () => {
  const items = Array.from({ length: 52 }, (_, i) => i);
  const seen = [];
  const { pages } = pageWindow(items.length, 0);
  for (let p = 0; p < pages; p += 1) {
    const w = pageWindow(items.length, p);
    seen.push(...items.slice(w.start, w.end));
  }
  assert.deepEqual(seen, items, 'every item appears exactly once, in order, across the pages');
  assert.equal(pages, 4);
});

test('sow-377: the share list renders a slice, and by ABSOLUTE index', () => {
  const src = read('client-ui/src/elements/gbti-share-list.mjs');
  assert.match(src, /pageWindow\(/, 'the share list no longer computes a page window');
  assert.match(src, /items\.slice\(w\.start, w\.end\)/, 'the share list renders the whole array again');
  // The row index handed to rowHtml must be offset by the slice start. `map((it, j) => ... w.start + j)` is
  // the correct shape; a bare `(it, i) => ... i` is the bug this asserts against.
  assert.match(src, /\.map\(\(it, j\) => this\.rowHtml\(it, w\.start \+ j\)\)/,
    'the share list rows are indexed within the slice, so row actions on page two reach the wrong items');
  assert.match(src, /data-page=/, 'the share list has no pager');
});

test('sow-377: no WorkBench list keeps its own copy of the page arithmetic', () => {
  for (const f of ['client-ui/src/elements/gbti-workspace.mjs', 'client-ui/src/elements/gbti-share-list.mjs']) {
    const src = read(f);
    assert.equal(/Math\.ceil\([a-zA-Z._]+\.length \/ PAGE\)/.test(src), false, `${f} still computes its own page count`);
    assert.equal(/const PAGE = \d+;/.test(src), false, `${f} still declares its own page size`);
  }
  // And the workspace really does call the shared helper, twice: the content list and the PR list.
  const ws = read('client-ui/src/elements/gbti-workspace.mjs');
  assert.equal((ws.match(/pageWindow\(/g) || []).length, 2, 'both workspace lists must use the shared window');
});
