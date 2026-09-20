// sow-305: the licence a project declares, and the row it renders.
//
// Measured against GitHub on 2026-09-19, which reproduced the owner's own table: of 12 projects, 4 report a
// usable licence (one MIT, three GPL-3.0), 2 have a file GitHub cannot identify, 4 have no file, 1 repository
// is private and 1 project has no repository. **So detection fills 4 rows and the author's pick fills the
// rest**, which is why most of what follows is about the field rather than the detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import { licenseEntries, licenseIds, licenseUrlFor, licenseProblems, licenseRow, PROPRIETARY, CUSTOM } from '../membership/licenses.mjs';

const ROOT = new URL('../', import.meta.url);
const DOC = yaml.load(fs.readFileSync(new URL('house/licenses.yml', ROOT), 'utf8'));

test('sow-305: the list the owner approved is the list in force', () => {
  assert.deepEqual(licenseIds(DOC), [
    'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC',
    'GPL-2.0', 'GPL-3.0', 'LGPL-3.0', 'AGPL-3.0', 'MPL-2.0',
    'Unlicense', 'CC0-1.0', 'Proprietary', 'Custom',
  ]);
});

test('sow-305: every identifier links somewhere, except the two that deliberately do not', () => {
  for (const { id, url } of licenseEntries(DOC)) {
    if (id === PROPRIETARY || id === CUSTOM) {
      assert.equal(url, null, `${id} has no public page by design`);
    } else {
      assert.match(url ?? '', /^https:\/\/spdx\.org\/licenses\//, id);
    }
  }
  assert.equal(licenseUrlFor('MIT', DOC), 'https://spdx.org/licenses/MIT.html');
  assert.equal(licenseUrlFor('Proprietary', DOC), null);
  assert.equal(licenseUrlFor('NotReal', DOC), null);
});

test('sow-305: the exact identifier passes and a near miss is refused with the right spelling', () => {
  assert.deepEqual(licenseProblems({ license: 'MIT' }, DOC), []);
  const near = licenseProblems({ license: 'mit' }, DOC);
  assert.equal(near.length, 1);
  assert.match(near[0], /spelled differently/);
  assert.match(near[0], /write "MIT"/);
  const unknown = licenseProblems({ license: 'WTFPL' }, DOC);
  assert.match(unknown[0], /not in house\/licenses\.yml/);
  assert.ok(unknown[0].includes('MIT'), 'the message lists what is allowed');
});

test('sow-305: Custom REQUIRES a link, because that is the whole point of choosing it', () => {
  assert.equal(licenseProblems({ license: 'Custom' }, DOC).length, 1);
  assert.match(licenseProblems({ license: 'Custom' }, DOC)[0], /needs licenseUrl/);
  assert.deepEqual(licenseProblems({ license: 'Custom', licenseUrl: 'https://example.com/LICENSE' }, DOC), []);
  // A standard licence needs no link: the row finds the page in the list.
  assert.deepEqual(licenseProblems({ license: 'MIT' }, DOC), []);
});

test('sow-305: a link without a licence is a half-filled form, and an http one is refused', () => {
  // The field is ALWAYS visible rather than revealed by picking Custom, because a conditionally hidden field is
  // skipped when the form is gathered and its value is dropped on save. This is the rule that replaces it.
  assert.match(licenseProblems({ licenseUrl: 'https://example.com/L' }, DOC)[0], /nothing links to it/);
  assert.match(licenseProblems({ license: 'MIT', licenseUrl: 'http://example.com/L' }, DOC)[0], /must be an https link/);
  assert.deepEqual(licenseProblems({}, DOC), [], 'declaring nothing is fine');
});

test('sow-305: with no vocabulary the core reports NOTHING, because the caller reports the missing file', () => {
  for (const empty of [null, undefined, {}, { licenses: {} }, { licenses: 'nonsense' }]) {
    assert.deepEqual(licenseProblems({ license: 'Anything' }, empty), [], JSON.stringify(empty));
    assert.equal(licenseRow({ license: 'MIT' }, empty), null, 'and no row is built from a list we cannot read');
  }
});

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

test('sow-305: the author pick ALWAYS beats detection', () => {
  const r = licenseRow({ license: 'Apache-2.0', detected: 'MIT' }, DOC);
  assert.equal(r.id, 'Apache-2.0', 'detection exists to fill an empty row, never to overrule a filled one');
});

test('sow-305: NOASSERTION is treated as NO detection, per the owner', () => {
  // "There is a licence file and we cannot tell what it is" is not something to print at a reader. Two of the
  // twelve live projects are in exactly this state.
  for (const v of ['NOASSERTION', 'noassertion', ' NOASSERTION ']) {
    assert.equal(licenseRow({ detected: v }, DOC), null, v);
  }
  // And it does not suppress an author's own pick.
  assert.equal(licenseRow({ license: 'GPL-3.0', detected: 'NOASSERTION' }, DOC).id, 'GPL-3.0');
});

test('sow-305: nothing detected and nothing picked shows NO row', () => {
  assert.equal(licenseRow({}, DOC), null);
  assert.equal(licenseRow({ detected: '' }, DOC), null);
  assert.equal(licenseRow({ license: '   ' }, DOC), null);
  // An identifier nobody recognises is refused rather than printed, whichever side it came from.
  assert.equal(licenseRow({ license: 'Bogus' }, DOC), null);
  assert.equal(licenseRow({ detected: 'Bogus' }, DOC), null);
});

test('sow-305: the row links in the order the owner asked for', () => {
  const repo = 'https://github.com/o/r/blob/HEAD/LICENSE';
  // 1. the repository's own file, whenever GitHub has one
  assert.equal(licenseRow({ detected: 'MIT', repoLicenseHref: repo }, DOC).href, repo);
  assert.equal(licenseRow({ license: 'MIT', repoLicenseHref: repo }, DOC).href, repo, 'picked or detected, the file wins');
  // 2. otherwise the standard page for that licence
  assert.equal(licenseRow({ license: 'MIT' }, DOC).href, 'https://spdx.org/licenses/MIT.html');
  // 3. Proprietary with no file is plain text, no link
  assert.equal(licenseRow({ license: PROPRIETARY }, DOC).href, null);
  assert.equal(licenseRow({ license: PROPRIETARY, repoLicenseHref: repo }, DOC).href, repo, 'unless there IS a file');
  // 4. Custom uses the author's link, ahead of anything else
  assert.equal(licenseRow({ license: CUSTOM, licenseUrl: 'https://x.test/L', repoLicenseHref: repo }, DOC).href, 'https://x.test/L');
  assert.equal(licenseRow({ license: CUSTOM }, DOC).href, null, 'and has nowhere to go without one');
});

test('sow-305: an http link is never used as a href', () => {
  assert.equal(licenseRow({ license: CUSTOM, licenseUrl: 'http://x.test/L' }, DOC).href, null);
  assert.equal(licenseRow({ license: 'MIT', repoLicenseHref: 'http://x.test/L' }, DOC).href, 'https://spdx.org/licenses/MIT.html');
});

// ---------------------------------------------------------------------------
// The surfaces
// ---------------------------------------------------------------------------

test('sow-305: the schema, its mirror and the editor all carry the field, or a save drops it', () => {
  const pairs = [
    ['src/content.config.ts', /license: z\.string\(\)\.optional\(\)/],
    ['client/src/schemas.mjs', /license: z\.string\(\)\.optional\(\)/],
    ['client/src/form-fields.mjs', /f\('license', 'License'/],
    ['client/src/mcp-tools.mjs', /house\/licenses\.yml/],
  ];
  for (const [rel, re] of pairs) {
    assert.match(fs.readFileSync(new URL(rel, ROOT), 'utf8'), re, rel);
  }
});

test('sow-305: the project page and the draft preview both render a License row', () => {
  // The preview is a documented no-drift surface: it draws the same spec rows and had no License one.
  const page = fs.readFileSync(new URL('src/pages/projects/[slug].astro', ROOT), 'utf8');
  const preview = fs.readFileSync(new URL('src/pages/workbench/preview.astro', ROOT), 'utf8');
  assert.match(page, /<dt>License<\/dt>/);
  assert.match(page, /licenseRow\(/, 'the page resolves the row through the shared helper');
  assert.match(preview, /'License', fm\.license\.trim\(\)/);
});

test('sow-332: every build-time GitHub call is time limited and authenticated when it can be', () => {
  // The defect this closes: the release lookup had no time limit, and a stalled response never rejects, so the
  // catch never ran and the build hung until the deploy job's 20 minute cap killed it. Detection would have
  // doubled the exposure rather than fixing it.
  const page = fs.readFileSync(new URL('src/pages/projects/[slug].astro', ROOT), 'utf8');
  assert.match(page, /AbortSignal\.timeout\(GH_TIMEOUT_MS\)/);
  assert.doesNotMatch(page, /await fetch\(`https:\/\/api\.github\.com[^`]*`\)\s*;/, 'no bare unbounded fetch remains');
  assert.match(page, /process\.env\.GITHUB_TOKEN/, 'authenticated when a token is present');
  // sow-305: the licence file's URL comes from GitHub, never from a path we assemble. The first version built
  // `/blob/HEAD/LICENSE` by convention; it resolved for all four of today's repositories by luck and would have
  // 404'd on the first LICENSE.md or COPYING. The /license endpoint answers both questions in the same call.
  assert.match(page, /\$\{slug\}\/license/, 'the licence comes from the /license endpoint');
  assert.match(page, /lic\?\.html_url/, 'and the file URL is read from it');
  assert.doesNotMatch(page, /blob\/HEAD\/LICENSE/, 'no path is assembled by convention');
  const wf = fs.readFileSync(new URL('.github/workflows/deploy.yml', ROOT), 'utf8');
  assert.match(wf, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/, 'and the deploy passes one');
});

test('sow-305: no project declares a licence that would fail the build', () => {
  // The migration test. Today every project declares none, so this proves the field is optional rather than
  // proving the values are good; it starts earning its keep the moment one is filled in.
  const dirs = [];
  const members = new URL('members/', ROOT);
  for (const m of fs.readdirSync(members)) {
    const d = new URL(`members/${m}/projects/`, ROOT);
    if (fs.existsSync(d)) for (const slug of fs.readdirSync(d)) dirs.push(`members/${m}/projects/${slug}/index.md`);
  }
  assert.ok(dirs.length >= 10, `expected the real project set, got ${dirs.length}`);
  for (const rel of dirs) {
    const txt = fs.readFileSync(new URL(rel, ROOT), 'utf8');
    const fm = yaml.load(txt.split('---')[1] ?? '') ?? {};
    assert.deepEqual(licenseProblems({ license: fm.license, licenseUrl: fm.licenseUrl }, DOC), [], rel);
  }
});
