// SOW-118: the pure changelog normalizer (src/lib/changelog.mjs). Covers the release/build split, newest-first
// ordering by build, field defaults, strict rejection of a malformed entry, and currentBuild/currentVersion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChangelog, currentBuildOf, currentVersionOf } from '../src/lib/changelog.mjs';

const doc = () => ({
  entries: [
    { version: '0.1.0', build: 2, date: '2026-07-12', type: 'build', title: 'Second build', notes: ['a', 'b'] },
    { version: '0.1.0', build: 4, date: '2026-07-13', type: 'release', title: 'Release', notes: ['ship'] },
    { version: '0.1.0', build: 1, date: '2026-07-11', type: 'build', title: 'First build', notes: [] },
    { version: '0.1.0', build: 3, date: '2026-07-12', type: 'build', title: 'Third build', notes: ['c'] },
  ],
});

test('normalizeChangelog orders newest-first by build descending', () => {
  const out = normalizeChangelog(doc());
  assert.deepEqual(out.map((e) => e.build), [4, 3, 2, 1]);
});

test('release/build entries are both kept and typed', () => {
  const out = normalizeChangelog(doc());
  const releases = out.filter((e) => e.type === 'release');
  const builds = out.filter((e) => e.type === 'build');
  assert.equal(releases.length, 1);
  assert.equal(builds.length, 3);
  assert.equal(releases[0].title, 'Release');
});

test('notes default to an empty array and trim/drop blanks', () => {
  const out = normalizeChangelog({ entries: [
    { version: '0.1.0', build: 1, date: '2026-07-11', type: 'build', title: 'x' },
    { version: '0.1.0', build: 2, date: '2026-07-11', type: 'build', title: 'y', notes: [' keep ', '', '  '] },
  ] });
  assert.deepEqual(out.find((e) => e.build === 1).notes, []);
  assert.deepEqual(out.find((e) => e.build === 2).notes, ['keep']);
});

test('currentBuildOf = the highest build, currentVersionOf = the newest entry version', () => {
  const out = normalizeChangelog(doc());
  assert.equal(currentBuildOf(out), 4);
  assert.equal(currentVersionOf(out), '0.1.0');
  assert.equal(currentBuildOf([]), 0);
  assert.equal(currentVersionOf([]), '');
});

test('an empty or entry-less document yields an empty list', () => {
  assert.deepEqual(normalizeChangelog(null), []);
  assert.deepEqual(normalizeChangelog({}), []);
  assert.deepEqual(normalizeChangelog({ entries: [] }), []);
});

test('rejects a missing version', () => {
  assert.throws(() => normalizeChangelog({ entries: [{ build: 1, date: '2026-07-11', type: 'build', title: 't' }] }), /missing a version/);
});

test('rejects a non-positive or non-integer build', () => {
  assert.throws(() => normalizeChangelog({ entries: [{ version: '0.1.0', build: 0, date: '2026-07-11', type: 'build', title: 't' }] }), /positive integer build/);
  assert.throws(() => normalizeChangelog({ entries: [{ version: '0.1.0', build: 'x', date: '2026-07-11', type: 'build', title: 't' }] }), /positive integer build/);
});

test('rejects a duplicate build number', () => {
  assert.throws(() => normalizeChangelog({ entries: [
    { version: '0.1.0', build: 1, date: '2026-07-11', type: 'build', title: 'a' },
    { version: '0.1.0', build: 1, date: '2026-07-12', type: 'build', title: 'b' },
  ] }), /duplicate build number 1/);
});

test('accepts a Date object for date (js-yaml parses an unquoted YYYY-MM-DD as a timestamp)', () => {
  const out = normalizeChangelog({ entries: [
    { version: '0.1.0', build: 1, date: new Date('2026-07-13T00:00:00Z'), type: 'release', title: 't', notes: [] },
  ] });
  assert.equal(out[0].date, '2026-07-13');
});

test('rejects a bad date and a bad type', () => {
  assert.throws(() => normalizeChangelog({ entries: [{ version: '0.1.0', build: 1, date: '07-11-2026', type: 'build', title: 't' }] }), /YYYY-MM-DD/);
  assert.throws(() => normalizeChangelog({ entries: [{ version: '0.1.0', build: 1, date: '2026-07-11', type: 'patch', title: 't' }] }), /release or build/);
});
