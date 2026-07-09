// SOW-046 (B/E): the pure member-prefs core (membership/member-prefs.mjs) — categories + followed news channels,
// normalize/apply with dedupe + caps + validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrefs, applyPrefs, PrefsError } from '../membership/member-prefs.mjs';

test('normalizePrefs: always returns arrays, deduped (case-insensitive), tolerant of junk', () => {
  assert.deepEqual(normalizePrefs(null), { categories: [], followedChannels: [], publicFavorites: false });
  const p = normalizePrefs({ categories: ['AI', 'ai', 'devops', ''], followedChannels: ['bleeping-computer', 'Bleeping-Computer', 123] });
  assert.deepEqual(p.categories, ['AI', 'devops']); // 'ai' deduped against 'AI'
  assert.deepEqual(p.followedChannels, ['bleeping-computer']); // dup folded, non-string dropped
});

test('applyPrefs: replace categories', () => {
  const p = applyPrefs({ categories: ['old'] }, { categories: ['ai', 'security'] });
  assert.deepEqual(p.categories, ['ai', 'security']);
  assert.throws(() => applyPrefs({}, { categories: 'nope' }), PrefsError);
});

test('applyPrefs: follow + unfollow a channel (idempotent)', () => {
  let p = applyPrefs({}, { followChannel: { id: 'bleeping-computer', on: true } });
  assert.deepEqual(p.followedChannels, ['bleeping-computer']);
  // re-follow -> no dup
  p = applyPrefs(p, { followChannel: { id: 'Bleeping-Computer', on: true } });
  assert.deepEqual(p.followedChannels, ['bleeping-computer']);
  // unfollow (case-insensitive)
  p = applyPrefs(p, { followChannel: { id: 'BLEEPING-COMPUTER', on: false } });
  assert.deepEqual(p.followedChannels, []);
  // unfollow a non-followed -> no-op
  assert.deepEqual(applyPrefs(p, { followChannel: { id: 'x', on: false } }).followedChannels, []);
});

test('applyPrefs: an invalid channel id throws; categories + channels coexist', () => {
  assert.throws(() => applyPrefs({}, { followChannel: { id: '', on: true } }), PrefsError);
  assert.throws(() => applyPrefs({}, { followChannel: { id: '../evil', on: true } }), PrefsError);
  const p = applyPrefs({ categories: ['ai'] }, { followChannel: { id: 'sdtimes', on: true } });
  assert.deepEqual(p.categories, ['ai']);
  assert.deepEqual(p.followedChannels, ['sdtimes']);
});

// SOW-114: the publicFavorites opt-in (default OFF; strictly boolean; erasure-friendly like the rest).
test('publicFavorites: defaults false, normalizes strictly, applies as a boolean patch only', () => {
  assert.equal(normalizePrefs({}).publicFavorites, false);
  assert.equal(normalizePrefs({ publicFavorites: 'yes' }).publicFavorites, false); // truthy junk never opts in
  assert.equal(normalizePrefs({ publicFavorites: true }).publicFavorites, true);
  const on = applyPrefs(null, { publicFavorites: true });
  assert.equal(on.publicFavorites, true);
  assert.deepEqual(on.categories, []); // untouched fields keep their shape
  const off = applyPrefs(on, { publicFavorites: false });
  assert.equal(off.publicFavorites, false);
  // A patch without the field leaves the stored value alone.
  assert.equal(applyPrefs(on, { categories: ['ai'] }).publicFavorites, true);
  assert.throws(() => applyPrefs(null, { publicFavorites: 'on' }), PrefsError);
});
