// SOW-046 (B/E): the pure member-prefs core (membership/member-prefs.mjs) — categories + followed news channels,
// normalize/apply with dedupe + caps + validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrefs, applyPrefs, PrefsError } from '../membership/member-prefs.mjs';

test('normalizePrefs: always returns arrays, deduped (case-insensitive), tolerant of junk', () => {
  assert.deepEqual(normalizePrefs(null), { categories: [], followedChannels: [] });
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
