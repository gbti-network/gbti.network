// sow-327: the staged-draft banner now answers "which changes?" with an ordered list. Owner, 2026-09-12:
// "we need to add a button to [the banner] ... that when clicked highlights the unpublished changes in an
// ordered list, if possible."
//
// It has to be a REAL comparison against the committed file, because the banner itself is not one: `staged`
// is a boolean written once at load, and the editor is filled from the draft alone (sow-326). So the element
// fetches the live item on demand and this module does the arithmetic, pure and node-testable.
//
// The body is compared BLOCK by block with the editor's own parser. A line diff would report a rewrapped
// paragraph as an edit, and a block index is what lets the list scroll to the block on screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  publishChanges, frontmatterChanges, blockChanges, changeLabel, fieldLabel, formatValue, snippet,
  sameValue, IGNORED_FIELDS, DIFF_CELL_CAP,
} from '../client-ui/src/publish-diff.mjs';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// ---------------------------------------------------------------- metadata

test('a changed field is listed with both values', () => {
  const items = frontmatterChanges({ title: 'Old' }, { title: 'New' });
  assert.equal(items.length, 1);
  assert.deepEqual({ ...items[0] }, { kind: 'field', key: 'title', label: 'Title', was: 'Old', now: 'New' });
});

test('POSITIVE CONTROL: identical metadata produces nothing', () => {
  const fm = { title: 'T', tags: ['a', 'b'], featured: false, categories: [] };
  assert.deepEqual(frontmatterChanges(fm, { ...fm, tags: ['a', 'b'] }), [],
    'a diff that reports changes on identical input would make the whole list noise');
});

test('absent, null and empty string are the same value, so a re-save is not a change', () => {
  assert.ok(sameValue(undefined, ''));
  assert.ok(sameValue(null, ''));
  assert.ok(sameValue('  spaced  ', 'spaced'));
  assert.ok(!sameValue(['a', 'b'], ['b', 'a']), 'array ORDER is meaningful for categories and tags');
});

test('a field added in the draft and one removed from it both surface', () => {
  const items = frontmatterChanges({ video: 'https://v' }, { coverAlt: 'A cat' });
  const keys = items.map((i) => i.key).sort();
  assert.deepEqual(keys, ['coverAlt', 'video']);
});

test('the always-differs fields are never listed, or they would bury the real changes', () => {
  const live = { title: 'T', updatedAt: '2026-01-01', publishedAt: '2026-01-01', status: 'published' };
  const draft = { title: 'T', updatedAt: '2026-09-12', publishedAt: '2026-08-15', status: 'draft' };
  assert.deepEqual(frontmatterChanges(live, draft), []);
  for (const k of ['updatedAt', 'publishedAt', 'status']) assert.ok(IGNORED_FIELDS.has(k));
});

test('metadata is ordered by what the reader cares about, not by key', () => {
  const items = frontmatterChanges(
    { canonicalUrl: 'a', title: 'a', layout: 'journal' },
    { canonicalUrl: 'b', title: 'b', layout: 'card' },
  );
  assert.deepEqual(items.map((i) => i.key), ['title', 'layout', 'canonicalUrl']);
});

test('an unlabelled key still reads as words', () => {
  assert.equal(fieldLabel('someNewField'), 'Some new field');
  assert.equal(fieldLabel('coverAlt'), 'Cover image alt text');
});

test('values are formatted for a person, and an empty one says so', () => {
  assert.equal(formatValue(['a', 'b']), 'a, b');
  assert.equal(formatValue(true), 'yes');
  assert.equal(formatValue(''), 'empty');
  assert.equal(formatValue([]), 'empty');
  assert.equal(formatValue('a'.repeat(200)).length, 120, 'a long value is truncated, not wrapped into the list');
});

// ---------------------------------------------------------------- the body

test('an edited paragraph is ONE entry, not a removal plus an addition', () => {
  const items = blockChanges('One.\n\nTwo.\n\nThree.', 'One.\n\nTwo, edited.\n\nThree.');
  assert.equal(items.length, 1);
  assert.equal(items[0].op, 'changed');
  assert.equal(items[0].index, 1, 'the index is the block position in the DRAFT, which is its position on screen');
});

test('an edited block indexes by its DRAFT position, not its live one', () => {
  // A block inserted ahead of the edit shifts everything after it. Taking the index off the live side would
  // scroll the author to the wrong paragraph, and it would be right whenever nothing moved, which is most
  // of the time and is exactly why this case is written out.
  const items = blockChanges('One.\n\nTwo.', 'Inserted.\n\nOne.\n\nTwo, edited.');
  const edited = items.find((i) => i.op === 'changed');
  assert.ok(edited, 'the edit itself must still be found');
  assert.equal(edited.index, 2, 'live position 1, draft position 2');
});

test('a long body with one edit still gets a precise answer, not the coarse fallback', () => {
  // This is what the common head and tail trim buys: without it a 600-block article against its own edit
  // exceeds the cell cap and the author is told only that "the body changed substantially".
  const many = (mark) => Array.from({ length: 600 }, (_, i) => `Paragraph ${i}${i === 300 && mark ? ' edited' : ''}.`).join('\n\n');
  assert.ok(600 * 600 > DIFF_CELL_CAP, 'the fixture must exceed the cap untrimmed or this proves nothing');
  const items = blockChanges(many(false), many(true));
  assert.deepEqual(items.map((i) => [i.op, i.index]), [['changed', 300]]);
});

test('an added and a removed block are reported as such, in draft order', () => {
  const added = blockChanges('One.\n\nTwo.', 'One.\n\nTwo.\n\nThree.');
  assert.deepEqual(added.map((i) => [i.op, i.index]), [['added', 2]]);
  const removed = blockChanges('One.\n\nTwo.\n\nThree.', 'One.\n\nThree.');
  assert.equal(removed[0].op, 'removed');
});

test('POSITIVE CONTROL: an unchanged body produces nothing', () => {
  const body = '# Title\n\nA paragraph.\n\n- one\n- two\n\n```js\ncode()\n```';
  assert.deepEqual(blockChanges(body, body), []);
});

test('a block keeps its type, so the list can name it', () => {
  const items = blockChanges('# Old heading\n\nBody.', '# New heading\n\nBody.');
  assert.equal(items[0].type, 'heading');
  assert.equal(changeLabel(items[0]), 'Heading edited');
  assert.equal(changeLabel({ kind: 'block', op: 'added', type: 'image' }), 'Image added');
  assert.equal(changeLabel({ kind: 'field', label: 'Layout' }), 'Layout changed');
});

test('an edit in a long body does not report the untouched blocks around it', () => {
  const many = (n, mark) => Array.from({ length: n }, (_, i) => `Paragraph ${i}${i === 40 && mark ? ' edited' : ''}.`).join('\n\n');
  const items = blockChanges(many(120, false), many(120, true));
  assert.equal(items.length, 1, 'the common head and tail are trimmed before anything is compared');
  assert.equal(items[0].index, 40);
});

test('a pathological pair degrades to a count instead of freezing the tab', () => {
  const a = Array.from({ length: 600 }, (_, i) => `A${i}`).join('\n\n');
  const b = Array.from({ length: 600 }, (_, i) => `B${i}`).join('\n\n');
  assert.ok(600 * 600 > DIFF_CELL_CAP, 'the fixture must actually exceed the cap or this test proves nothing');
  const items = blockChanges(a, b);
  assert.equal(items.length, 1);
  assert.equal(items[0].op, 'coarse');
  assert.equal(changeLabel(items[0]), 'The body changed substantially');
});

test('a body edit is found in under a second on a realistic article', () => {
  const base = Array.from({ length: 300 }, (_, i) => `Paragraph number ${i} with a sentence of prose in it.`).join('\n\n');
  const edited = base.replace('number 150 ', 'number 150, edited, ');
  const t0 = process.hrtime.bigint();
  const items = blockChanges(base, edited);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(items.length, 1);
  assert.ok(ms < 1000, `took ${ms}ms`);
});

// ---------------------------------------------------------------- the whole answer

test('a never-published item is not a diff, it is "all of this is new"', () => {
  const res = publishChanges({ live: null, draft: { frontmatter: { title: 'T' }, body: 'One.\n\nTwo.' } });
  assert.equal(res.isNew, true);
  assert.equal(res.blockCount, 2);
  assert.deepEqual(res.items, [], 'listing every block of a new item as an addition tells the author nothing');
});

test('metadata comes before the body, and the body stays in document order', () => {
  const res = publishChanges({
    live: { frontmatter: { title: 'Old' }, body: 'A.\n\nB.\n\nC.' },
    draft: { frontmatter: { title: 'New' }, body: 'A.\n\nB edited.\n\nC.\n\nD.' },
  });
  assert.deepEqual(res.items.map((i) => i.kind), ['field', 'block', 'block']);
  assert.deepEqual(res.items.slice(1).map((i) => i.index), [1, 3]);
});

test('the author note is compared only when its live value is known', () => {
  const live = { frontmatter: {}, body: 'A.' };
  const draft = { frontmatter: {}, body: 'A.' };
  assert.deepEqual(publishChanges({ live, draft, liveNote: null, draftNote: 'typed' }).items.map((i) => i.kind), ['note']);
  assert.deepEqual(publishChanges({ live, draft, liveNote: 'same', draftNote: 'same' }).items, []);
  assert.deepEqual(publishChanges({ live, draft, liveNote: null, draftNote: null }).items, [],
    'an unknown live note must not read as an emptied one');
});

// ---------------------------------------------------------------- the wiring

test('the banner carries the control, and only inside the staged branch', () => {
  const e = src('client-ui/src/elements/gbti-content-editor.mjs');
  const line = e.split('\n').find((l) => l.includes('id="pubbanner"') && l.includes('warn'));
  assert.ok(line.includes('id="whatchanged"'), 'the control belongs to the staged banner, not to the info one');
  assert.ok(line.includes('id="changedlist"'));
  assert.match(e, /this\.on\('#whatchanged', 'click', \(\) => this\._toggleChanges\(\)\)/);
});

test('the live file is read on click, never on render', () => {
  const e = src('client-ui/src/elements/gbti-content-editor.mjs');
  const fn = e.slice(e.indexOf('async _toggleChanges()'), e.indexOf('_changesHtml(res) {'));
  assert.ok(fn.length > 400, 'the method moved; this assertion measures nothing');
  assert.match(fn, /await this\.client\?\.getContentItem\?\.\(\{ path: this\.itemPath \}\)/,
    'the editor holds no copy of the committed file, so the comparison needs a read');
  assert.match(fn, /catch \{/, 'a failed read must not leave the author staring at "Comparing..."');
  const calls = e.split('\n').filter((l) => l.includes('this._toggleChanges()'));
  assert.equal(calls.length, 1, 'opening the panel is an explicit action, so it may have exactly one caller');
  assert.match(calls[0], /'#whatchanged', 'click'/, 'and that caller is the button');
});

test('the list asks the body editor to highlight, rather than reaching into its shadow root', () => {
  const e = src('client-ui/src/elements/gbti-content-editor.mjs');
  assert.match(e, /this\.\$\('#body'\)\?\.highlightBlock\?\.\(Number\(el\.dataset\.jump\)\)/);
  const d = src('client-ui/src/elements/gbti-doc-editor.mjs');
  assert.match(d, /\n  highlightBlock\(i\) \{/, 'the method must be PUBLIC on the body editor (no underscore)');
  assert.match(d, /return false;/, 'and it must report a block that is no longer there');
  const css = src('client-ui/src/doc-editor-css.mjs');
  assert.ok(d.includes('blk-flash') && css.includes('@keyframes blkflash'), 'the highlight needs its own style');
});

test('a removed block offers no jump, because there is nothing to jump to', () => {
  const e = src('client-ui/src/elements/gbti-content-editor.mjs');
  const fn = e.slice(e.indexOf('_changesHtml(res)'), e.indexOf('async doPublish()'));
  assert.match(fn, /it\.op !== 'removed'/);
});

test('an unreadable frontmatter is not nine fields the author emptied', () => {
  // The editor builds its rail from a FETCHED field list, so a failed fetch renders no inputs and gathers an
  // empty frontmatter. Driving the real component with that list stubbed out produced nine confident rows
  // saying the title, permalink, author and visibility had all been cleared. That is the state this guards.
  const live = { frontmatter: { title: 'T', slug: 's', author: 'a', visibility: 'public' }, body: 'One.\n\nTwo.' };
  const res = publishChanges({ live, draft: { frontmatter: {}, body: 'One.\n\nTwo, edited.' } });
  assert.equal(res.metaUnread, true);
  assert.deepEqual(res.items.map((i) => i.kind), ['block'], 'the body is still compared; only the phantom fields go');
});

test('POSITIVE CONTROL: a real field clearance is still reported', () => {
  const live = { frontmatter: { title: 'T', excerpt: 'gone soon' }, body: 'A.' };
  const res = publishChanges({ live, draft: { frontmatter: { title: 'T' }, body: 'A.' } });
  assert.equal(res.metaUnread, false, 'a draft that still carries SOME metadata is a real edit, not a failed read');
  assert.deepEqual(res.items.map((i) => i.key), ['excerpt']);
});

test('an absent boolean and an explicit false are the same state', () => {
  // The editor's checkboxes always gather a value; a content file usually omits the field. Without this,
  // "Featured changed, was empty, now no" appeared on every item that had never been featured. Found by
  // driving the real component, not by reading it.
  assert.ok(sameValue(undefined, false));
  assert.ok(sameValue(false, null));
  assert.deepEqual(frontmatterChanges({ title: 'T' }, { title: 'T', featured: false, publicStub: false }), []);
});

test('POSITIVE CONTROL: turning a boolean ON is still a change', () => {
  const items = frontmatterChanges({ title: 'T' }, { title: 'T', featured: true });
  assert.deepEqual(items.map((i) => i.key), ['featured']);
  assert.equal(formatValue(items[0].now), 'yes');
});

test('the author is never diffed from the frontmatter, because it does not travel there', () => {
  // It rides as authorTarget from the Author picker, while the committed file always carries `author`, so
  // comparing the two reported "Author changed, was atwellpub, now empty" on every item, always.
  assert.ok(IGNORED_FIELDS.has('author'));
  assert.deepEqual(frontmatterChanges({ author: 'atwellpub' }, {}), []);
});

test('a pending reassignment IS listed, from the picker rather than from the frontmatter', () => {
  const res = publishChanges({
    live: { frontmatter: { title: 'T' }, body: 'A.' },
    draft: { frontmatter: { title: 'T' }, body: 'A.' },
    reassign: { from: { scope: 'member', username: 'atwellpub' }, to: { scope: 'house' } },
  });
  assert.deepEqual(res.items.map((i) => [i.key, i.was, i.now]), [['author', 'atwellpub', 'House / GBTI Network']]);
  assert.deepEqual(publishChanges({ live: { frontmatter: {}, body: 'A.' }, draft: { frontmatter: {}, body: 'A.' }, reassign: null }).items, [],
    'no pick, no row');
});
