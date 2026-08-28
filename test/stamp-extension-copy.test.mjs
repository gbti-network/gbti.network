// The unpacked-extension staleness stamp. Pure string logic plus one filesystem round trip; no git required,
// no network, no secrets.
//
// The incident this guards: on 2026-08-27 a 147-commit-stale unpacked extension was loaded and behaved as if a
// day-old feature did not exist. Both the stale tree and origin reported version "0.3.0", so nothing on screen
// distinguished them. These tests assert the stamp SAYS SO rather than merely differing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stampFor, stampCopy } from '../scripts/stamp-extension-copy.mjs';

test('stampFor: a clean build at origin gets the bare sha', () => {
  assert.equal(stampFor({ version: '0.3.0', sha: '49a487cc' }), '0.3.0+49a487cc');
});

test('stampFor: behind origin says so, and says BY HOW MUCH', () => {
  const s = stampFor({ version: '0.3.0', sha: 'deadbee', behind: 147 });
  assert.ok(s.includes('BEHIND-ORIGIN'), 'a stale build must announce itself');
  // The count matters: "behind by 3" and "behind by 147" are different problems, and only the second one
  // explains a feature that appears to be missing entirely.
  assert.ok(s.includes('147'), 'the distance is the diagnostic, not just the fact of being behind');
});

test('stampFor: uncommitted extension sources are flagged separately from being behind', () => {
  assert.ok(stampFor({ version: '0.3.0', sha: 'abc1234', dirty: true }).includes('DIRTY'));
  const both = stampFor({ version: '0.3.0', sha: 'abc1234', behind: 5, dirty: true });
  assert.ok(both.includes('BEHIND-ORIGIN') && both.includes('DIRTY'), 'the two conditions are independent');
});

test('stampFor: no git yields a plain version, never a fabricated provenance', () => {
  // A tarball build has no sha. Inventing one, or implying cleanliness, would be worse than saying nothing:
  // the whole value of this field is that it can be trusted when it does make a claim.
  assert.equal(stampFor({ version: '0.3.0', sha: null }), '0.3.0');
  assert.equal(stampFor({ version: '0.3.0', sha: null, behind: 99, dirty: true }), '0.3.0');
});

test('stampCopy: writes version_name next to version and leaves the rest of the manifest alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  const original = { manifest_version: 3, name: 'GBTI', version: '0.3.0', permissions: ['storage'] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(original, null, 2));
  const r = stampCopy(dir, { cwd: dir, now: new Date(0) }); // a temp dir is not a git repo -> sha null
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(after.version_name, r.version_name);
  assert.equal(after.version, '0.3.0', 'version itself is never rewritten');
  assert.deepEqual(after.permissions, ['storage'], 'unrelated keys survive untouched');
  assert.equal(after.name, 'GBTI');
  // Ordering is not cosmetic here: someone opening the file should see the pair together.
  const keys = Object.keys(after);
  assert.equal(keys[keys.indexOf('version') + 1], 'version_name');
  assert.ok(fs.readFileSync(path.join(dir, 'BUILT-FROM-COMMIT.txt'), 'utf8').includes('behind origin/main by'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stampCopy: refuses a directory that is not an unpacked extension', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-empty-'));
  assert.throws(() => stampCopy(dir, { cwd: dir }), /no manifest\.json/);
  fs.rmSync(dir, { recursive: true, force: true });
});
