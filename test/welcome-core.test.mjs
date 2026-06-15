// SOW-029: the pure helpers behind the post-setup welcome view (<gbti-welcome>). No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseLabel, shuffle, excludeSelf, paginate } from '../client-ui/src/welcome-core.mjs';

test('phaseLabel maps paid/trialing and never throws (unknown + lapsed -> neutral)', () => {
  assert.equal(phaseLabel('paid').phase, 'paid');
  assert.equal(phaseLabel('paid').upgrade, false);
  assert.equal(phaseLabel('trialing').phase, 'trial');
  assert.equal(phaseLabel('trialing').upgrade, true);
  for (const s of ['unknown', 'expired', 'cancelled', 'none', 'banned', undefined, null, 'weird']) {
    const r = phaseLabel(s);
    assert.equal(r.phase, 'neutral', `${s} -> neutral`);
    assert.equal(r.upgrade, false);
    assert.ok(r.title && r.body, 'always has copy');
  }
});

test('shuffle is a permutation (no drops/dupes), deterministic for a fixed rng, and pure', () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.05];
  const mk = () => { let k = 0; return () => seq[(k++) % seq.length]; };
  const out = shuffle(list, mk());
  assert.deepEqual([...out].sort((a, b) => a - b), list, 'same multiset, nothing dropped or duplicated');
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'input is not mutated');
  assert.deepEqual(shuffle(list, mk()), shuffle(list, mk()), 'deterministic for the same rng');
});

test('excludeSelf drops the own username case-insensitively', () => {
  const m = [{ username: 'Alice' }, { username: 'bob' }, { username: 'CAROL' }];
  assert.deepEqual(excludeSelf(m, 'alice').map((x) => x.username), ['bob', 'CAROL']);
  assert.equal(excludeSelf(m, '').length, 3, 'no own username -> keep all');
});

test('paginate slices PAGE_SIZE per page and clamps out-of-range pages', () => {
  const list = Array.from({ length: 23 }, (_, i) => i);
  const p1 = paginate(list, 1, 10);
  assert.equal(p1.items.length, 10);
  assert.equal(p1.pages, 3);
  assert.equal(p1.page, 1);
  assert.equal(paginate(list, 3, 10).items.length, 3);
  assert.equal(paginate(list, 99, 10).page, 3, 'clamps high');
  assert.equal(paginate(list, 0, 10).page, 1, 'clamps low');
});
