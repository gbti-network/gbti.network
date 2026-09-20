// sow-374: the news manager is two subtabs, and the source weight is reachable from the source row.
//
// Two defects this pins, both of them "the control exists but nobody can reach it":
//   1. The blocked-word list shipped appended BELOW 126 source rows, so finding it meant scrolling past the
//      whole pool. Two different decisions, two views.
//   2. The five-step weight shipped in sow-338 with its ONLY control on an individual news story's sidebar. A
//      superadmin could turn down the publication whose story they happened to be reading, and no other. The
//      write path was website-only as well, so the extension's manager could list a source it had no way to
//      weight at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { WORKER_ADMIN_ACTIONS, toWorkerRequest, isWorkerAdminAction } from '../client/src/admin-worker-actions.mjs';
import { weightLabel, stepToward, WEIGHT_MIN, WEIGHT_MAX } from '../membership/news-source-weight-edits.mjs';

const ROOT = new URL('../', import.meta.url);
const MANAGER = fs.readFileSync(new URL('client-ui/src/elements/gbti-news-source-manager.mjs', ROOT), 'utf8');

test('sow-374: the weight write reaches the Worker from BOTH hosts, not just the website', () => {
  // The extension and the npm client forward through this table. Without the row, the manager's arrows throw
  // "unknown action" on one host and work on the other, which is the kind of split nothing reports.
  assert.ok(WORKER_ADMIN_ACTIONS.has('news-source-weight'));
  assert.ok(isWorkerAdminAction('news-source-weight'));
  assert.deepEqual(
    toWorkerRequest({ action: 'news-source-weight', id: 'techcrunch', weight: -2 }),
    { action: 'news-source-weight', payload: { id: 'techcrunch', weight: -2 } },
    'forwarded unchanged, not translated',
  );
});

test('sow-374: both pool reads carry the weights back, or the manager renders every source as neutral', () => {
  // A manager that cannot see the current weights shows "Normal" for all 126, and the first click on a weighted
  // source moves it from the value it never displayed. Silent, and wrong in a way a screenshot cannot show.
  const worker = fs.readFileSync(new URL('workers/signup/membership-admin-author.mjs', ROOT), 'utf8');
  assert.match(worker, /body: \{ ok: true, sources, banwords, weights \}/, 'the Worker pool read must return weights');
  assert.match(worker, /readWeights/, 'and read them through the shared core, not by hand');
  const host = fs.readFileSync(new URL('client/src/admin-ops.mjs', ROOT), 'utf8');
  assert.match(host, /weights: readWeights\(w\)/, 'the npm/extension pool read must return them too');
});

test('sow-374: the manager renders two subtabs and keeps the chosen one across a save', () => {
  for (const view of ['sources', 'banwords']) {
    assert.ok(MANAGER.includes(`data-view="${view}"`), `a ${view} subtab`);
  }
  // The selection lives on the element, not in the markup it just replaced, so the re-render after a save does
  // not throw the reader back to the first view. Driven in a browser too; this pins the mechanism.
  assert.match(MANAGER, /_viewKey/, 'the chosen view is held on the element');
  assert.match(MANAGER, /get _view\(\)/, 'and read back through one accessor');
});

test('sow-374: the weight control is in the SOURCE ROW, not in a third subtab', () => {
  // The owner offered both shapes. A third tab listing only the sources that already diverge from neutral shows
  // the same data through a keyhole: you can adjust what is adjusted, and never reach the other hundred.
  // The METHOD, not the call site above it: indexOf finds `this._sourcesView()` in render() first, which
  // sliced an empty region and failed on working code. The instrument was wrong, not the subject.
  const from = MANAGER.indexOf('\n  _sourcesView() {');
  const to = MANAGER.indexOf('\n  _weightControl(s) {');
  assert.ok(from > -1 && to > from, 'could not find the sources view method');
  const rowFn = MANAGER.slice(from, to);
  assert.match(rowFn, /_weightControl\(s\)/, 'every source row carries the control');
  assert.doesNotMatch(MANAGER, /data-view="weights"/, 'there is no third subtab');
  assert.match(MANAGER, /weightLabel/, 'the row shows the label, not the number');
});

test('sow-374: a step never leaves the scale, and the ends say so by disabling', () => {
  // The arrows disable at each end rather than wrapping or silently clamping, so the edges are visible instead
  // of being discovered by clicking into nothing.
  assert.match(MANAGER, /w <= WEIGHT_MIN \? ' disabled' : ''/);
  assert.match(MANAGER, /w >= WEIGHT_MAX \? ' disabled' : ''/);
  // And the core behind it holds, whatever the UI does.
  assert.equal(stepToward(WEIGHT_MAX, 1), WEIGHT_MAX);
  assert.equal(stepToward(WEIGHT_MIN, -1), WEIGHT_MIN);
  assert.equal(stepToward(0, 1), 1);
  assert.equal(stepToward(0, -1), -1);
});

test('sow-374: the label says what the step DOES, never the number it is', () => {
  // -1 is only meaningful to whoever wrote the table. This is the same reasoning as the sow-338 control, and
  // the manager reuses that function rather than growing a second vocabulary for the same five steps.
  assert.deepEqual(
    [-2, -1, 0, 1, 2].map(weightLabel),
    ['Much less', 'Less', 'Normal', 'More', 'Much more'],
  );
  assert.equal(weightLabel(0), 'Normal', 'neutral reads as a value, not as a blank');
});

test('sow-374: neutral is ABSENCE, and the manager reads a missing key as neutral', () => {
  // The stored file lists only the sources somebody has actually weighted, so a fork inherits a short readable
  // record rather than 126 zeroes. The manager has to agree with that or every unweighted source reads as
  // unknown.
  assert.match(MANAGER, /Number\(this\._weights\?\.\[id\]\) \|\| 0/);
});
