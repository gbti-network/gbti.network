// Three places name the extension's current version, and each is read by a different audience:
//   extension/manifest.json        the version Chrome installs and the Web Store requires to rise on every upload;
//   src/lib/extension.ts           the website's mirror (the /extension/ page and its download);
//   house/changelog.yml            the public changelog, whose newest entry the new-tab footer shows as "build N".
// scripts/release.mjs bumps the first two and printed nothing about the third, so the changelog sat at 0.4.0 through
// 0.5.0, 0.5.2 and 0.5.3 while the footer linked members to it (found in the 0.6.0 release audit, 2026-10-07).
// A version bump without a changelog entry now fails CI instead of shipping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allEntries, currentVersionOf } from '../src/lib/changelog.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the manifest, the website mirror and the changelog all name the same current version', () => {
  const manifest = JSON.parse(read('extension/manifest.json')).version;
  const mirror = /\bversion:\s*'(\d+\.\d+\.\d+)'/.exec(read('src/lib/extension.ts'))?.[1];
  const changelog = currentVersionOf(allEntries());
  assert.match(manifest, /^\d+\.\d+\.\d+$/, 'could not read the manifest version, so the comparison below would prove nothing');
  assert.ok(mirror, 'could not read EXTENSION.version from src/lib/extension.ts, so the comparison below would prove nothing');
  assert.equal(mirror, manifest, 'src/lib/extension.ts and extension/manifest.json disagree; run scripts/release.mjs rather than editing one by hand');
  assert.equal(changelog, manifest, `the newest house/changelog.yml entry is ${changelog} but the extension is ${manifest}; add a release entry for ${manifest}`);
});
