// Unit tests for the pure core of `npm run release` (scripts/release.mjs). The interactive prompt + the
// child-process rebuild are side effects run only from the CLI entry, so they are not exercised here; the
// semver math + the exactly-one version-token swap (the parts that could silently corrupt a release) are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion, readManifestVersion, swapVersion } from '../scripts/release.mjs';

const MANIFEST_RE = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/;
const MIRROR_RE = /(\bversion:\s*')(\d+\.\d+\.\d+)(')/;

test('nextVersion: patch, minor, major', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(nextVersion('0.1.0', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.1.0', 'major'), '1.0.0');
  assert.equal(nextVersion('1.4.9', 'minor'), '1.5.0'); // minor resets patch
  assert.equal(nextVersion('2.7.3', 'major'), '3.0.0'); // major resets minor + patch
});

test('nextVersion: rejects bad version or kind', () => {
  assert.throws(() => nextVersion('1.2', 'patch'), /not X\.Y\.Z/);
  assert.throws(() => nextVersion('v1.2.3', 'patch'), /not X\.Y\.Z/);
  assert.throws(() => nextVersion('1.2.3', 'bogus'), /unknown bump kind/);
});

test('readManifestVersion: reads version, ignores manifest_version', () => {
  assert.equal(readManifestVersion('{\n  "manifest_version": 3,\n  "version": "0.3.1"\n}'), '0.3.1');
  assert.throws(() => readManifestVersion('{ "manifest_version": 3 }'), /no "version"/);
});

test('swapVersion: replaces exactly the version token (manifest shape)', () => {
  const man = '{\n  "manifest_version": 3,\n  "name": "x",\n  "version": "0.1.0"\n}';
  const out = swapVersion(man, MANIFEST_RE, '0.2.0');
  assert.match(out, /"version": "0\.2\.0"/);
  assert.match(out, /"manifest_version": 3/); // the numeric manifest_version is untouched
});

test('swapVersion: replaces the mirror shape', () => {
  const mir = "export const EXTENSION = {\n  name: 'GBTI Network',\n  version: '0.1.0',\n  webStoreUrl: 'https://x',\n};";
  const out = swapVersion(mir, MIRROR_RE, '1.0.0');
  assert.match(out, /version: '1\.0\.0'/);
  assert.match(out, /webStoreUrl: 'https:\/\/x'/); // other fields untouched
});

test('swapVersion: throws if the token is missing or ambiguous', () => {
  assert.throws(() => swapVersion('no version token here', MANIFEST_RE, '0.2.0'), /found 0/);
  const two = '"version": "0.1.0"\n"version": "0.1.0"';
  assert.throws(() => swapVersion(two, /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/g, '0.2.0'), /found 2/);
});
