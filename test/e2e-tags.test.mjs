// SOW-035 Phase 5: the E2E tag-selection logic (read-only smoke subset vs the full write-bearing suite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runnable, wanted, SMOKE, FULL, MANUAL_CLEANUP } from '../tests/e2e/lib/tags.mjs';

const env = (v) => ({ E2E_TAGS: v });

test('default (no E2E_TAGS): run everything except manual-cleanup', () => {
  assert.equal(runnable([SMOKE], env(undefined)), true);
  assert.equal(runnable([FULL], env('')), true);
  assert.equal(runnable([FULL, MANUAL_CLEANUP], env('')), false); // self-clean-incapable excluded by default
  assert.equal(runnable([], env('')), true);
});

test('E2E_TAGS=smoke: only smoke-tagged cycles run', () => {
  assert.equal(runnable([SMOKE], env('smoke')), true);
  assert.equal(runnable([FULL], env('smoke')), false);
  assert.equal(runnable([SMOKE, FULL], env('smoke')), true); // tagged both -> matches
});

test('E2E_TAGS=full: only full-tagged cycles run', () => {
  assert.equal(runnable([FULL], env('full')), true);
  assert.equal(runnable([SMOKE], env('full')), false);
});

test('E2E_TAGS can opt manual-cleanup back in, and is case/space tolerant', () => {
  assert.equal(runnable([FULL, MANUAL_CLEANUP], env('full,manual-cleanup')), true);
  assert.equal(runnable([SMOKE], env(' SMOKE , full ')), true);
  assert.deepEqual(wanted(env(' Smoke , Full ')), ['smoke', 'full']);
  assert.deepEqual(wanted(env('')), []);
});
