// SOW-076 Phase 3: the pure post-publish remediation planner. No IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseError, planRemediation } from '../scripts/lib/post-publish-remediation.mjs';

const POST = 'members/alice/posts/x/index.md';
const HOUSE = 'house/products/y/index.md';

test('parseError extracts a content-path file prefix; a global error has no file', () => {
  assert.deepEqual(parseError(`${POST}: categories must be an array path`), { file: POST, message: 'categories must be an array path' });
  assert.deepEqual(parseError(HOUSE + ': bad'), { file: HOUSE, message: 'bad' });
  assert.deepEqual(parseError('duplicate slug "x" across two folders'), { file: '', message: 'duplicate slug "x" across two folders' });
  // a colon in the message does not confuse the split (file = the path before the FIRST ": ")
  assert.deepEqual(parseError(`${POST}: bad value: see SOW-016`), { file: POST, message: 'bad value: see SOW-016' });
  // a non-content path (not flippable) is treated as global
  assert.equal(parseError('README.md: x').file, '');
});

test('planRemediation flips only PUBLISHED content items; everything else is alert-only', () => {
  const errors = [
    `${POST}: invalid category`,                 // published content -> flip
    `${HOUSE}: bad status`,                       // a DRAFT content item -> alert only (already not public)
    'duplicate slug "z" across folders',          // global -> alert only
    'members/bob/posts/q/index.md: x',            // not in publishedFiles -> alert only
  ];
  const out = planRemediation({ errors, publishedFiles: [POST] });
  assert.deepEqual(out.flip, [POST]);
  assert.equal(out.alertOnly.length, 3);
  assert.ok(out.alertOnly.some((e) => e.file === HOUSE));
  assert.ok(out.alertOnly.some((e) => e.file === '' && /duplicate/.test(e.message)));
});

test('planRemediation dedupes multiple errors on one file + accepts pre-parsed objects', () => {
  const out = planRemediation({
    errors: [`${POST}: a`, { file: POST, message: 'b' }, `${POST}: c`],
    publishedFiles: new Set([POST]),
  });
  assert.deepEqual(out.flip, [POST]); // one flip despite three errors
  assert.equal(out.alertOnly.length, 0);
});

test('empty / all-valid -> nothing to do', () => {
  assert.deepEqual(planRemediation({ errors: [], publishedFiles: [POST] }), { flip: [], alertOnly: [] });
});
