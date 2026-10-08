// Owner, 2026-09-29: a system-only change to published content is not an author's edit, so it must not re-check that
// content against the rules that only apply to changed files. sow-109 Phase 1 added `kind: prompt` to every prompt
// file; one member's older prompt failed the author-note and tag rules as a result and the after-publish check
// unpublished it (e5f00460). Replayed against the real file before shipping: with the base revision it passes, without
// it the same errors return. The owner also restored that prompt and excused it from the author-note rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import { isSystemOnlyChange, withoutSystemOnlyChanges, SYSTEM_FIELDS } from '../scripts/lib/system-only-change.mjs';

const ROOT = new URL('../', import.meta.url);
const src = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const doc = (fm, body = 'The body.\n') => `---\n${fm}\n---\n\n${body}`;
const BEFORE = doc('type: prompt\ntitle: "T"\nstatus: published\ntags: ["PDF", "pikepdf"]');

test('a change to a system field alone is system-only', () => {
  assert.deepEqual(SYSTEM_FIELDS, ['kind', 'sourceName']);
  assert.equal(isSystemOnlyChange(BEFORE, doc('type: prompt\nkind: prompt\ntitle: "T"\nstatus: published\ntags: ["PDF", "pikepdf"]')), true);
  // sow-445: the publication's name backfilled onto a share is the system's write, not the member's edit.
  const SHARE = doc('type: share\nstatus: published\nurl: https://www.quantamagazine.org/a/?utm_source=x');
  assert.equal(isSystemOnlyChange(SHARE, doc('type: share\nstatus: published\nurl: https://www.quantamagazine.org/a/?utm_source=x\nsourceName: Quanta Magazine')), true);
  assert.equal(isSystemOnlyChange(BEFORE, doc('type: prompt\ntitle: T\nstatus: published\ntags:\n  - PDF\n  - pikepdf')), true, 'the same values written another way are the same');
});

test('anything an author could have changed is an edit, and is checked', () => {
  assert.equal(isSystemOnlyChange(BEFORE, doc('type: prompt\nkind: prompt\ntitle: "T"\nstatus: published\ntags: ["pdf", "pikepdf"]')), false, 'tags');
  assert.equal(isSystemOnlyChange(BEFORE, doc('type: prompt\ntitle: "T"\nstatus: draft\ntags: ["PDF", "pikepdf"]')), false, 'status');
  assert.equal(isSystemOnlyChange(BEFORE, doc('type: prompt\nkind: prompt\ntitle: "T"\nstatus: published\ntags: ["PDF", "pikepdf"]', 'A new body.\n')), false, 'body');
  assert.equal(isSystemOnlyChange(BEFORE, doc('type: prompt\ntitle: "T"\nstatus: published\ntags: ["PDF", "pikepdf"]\nimage: ./x.png')), false, 'an added field');
});

test('when it cannot compare, it checks (fail closed)', () => {
  assert.equal(isSystemOnlyChange(null, BEFORE), false, 'a new file');
  assert.equal(isSystemOnlyChange(BEFORE, null), false, 'a deleted file');
  assert.equal(isSystemOnlyChange('no frontmatter', 'no frontmatter'), false);
  assert.equal(isSystemOnlyChange(doc('title: [unclosed'), doc('title: [unclosed')), false, 'frontmatter that does not parse');
});

test('the filter drops only system-only changes, and keeps everything without a base', () => {
  const before = { a: BEFORE, b: BEFORE, c: null };
  const after = { a: doc('type: prompt\nkind: skill\ntitle: "T"\nstatus: published\ntags: ["PDF", "pikepdf"]'), b: doc('type: prompt\ntitle: "U"\nstatus: published\ntags: ["PDF", "pikepdf"]'), c: BEFORE };
  const opts = { base: 'abc', readBefore: (f) => before[f], readAfter: (f) => after[f] };
  assert.deepEqual(withoutSystemOnlyChanges(['a', 'b', 'c'], opts), ['b', 'c']);
  assert.deepEqual(withoutSystemOnlyChanges(['a', 'b', 'c'], { ...opts, base: '' }), ['a', 'b', 'c']);
  assert.deepEqual(withoutSystemOnlyChanges(['gone'], { base: 'abc', readBefore: () => BEFORE, readAfter: () => { throw new Error('ENOENT'); } }), ['gone'], 'a deleted file is kept');
});

test('the three changed-file rules read the filtered list, and both workflows pass the base', () => {
  const v = src('scripts/validate-content.mjs');
  assert.match(v, /const CHANGED = withoutSystemOnlyChanges\(\(process\.env\.CHANGED_FILES \|\| ''\)/);
  assert.match(v, /base: \(process\.env\.CHANGED_BASE \|\| ''\)\.trim\(\),/);
  for (const fn of ['validateAuthorIntro', 'validateTagShape', 'validateBodyTracking']) {
    const body = v.slice(v.indexOf(`function ${fn}()`), v.indexOf(`\n${fn}();`));
    assert.ok(body.length > 100, `${fn} found`);
    assert.match(body, /if \(!CHANGED\.length\) return;/, `${fn} reads the filtered list`);
    assert.ok(!body.includes('process.env.CHANGED_FILES'), `${fn} must not read the raw list`);
  }
  assert.match(src('.github/workflows/post-publish-remediate.yml'), /CHANGED_FILES: \$\{\{ steps\.changed\.outputs\.files \}\}\n(?:\s*#.*\n)*\s*CHANGED_BASE: HEAD~1\n/);
  assert.match(src('.github/workflows/content-check.yml'), /echo "CHANGED_BASE=\$\{\{ github\.event\.pull_request\.base\.sha \}\}" >> "\$GITHUB_ENV"/);
  assert.match(src('scripts/remediate-published.mjs'), /env: \{ \.\.\.env, CHANGED_FILES: changed\.join\(' '\) \}/, 'the remediation forwards CHANGED_BASE to the validator');
});

test('the author-note exemption names real items, and the rule honours it', () => {
  const ex = yaml.load(src('house/author-note-exempt.yml'));
  assert.deepEqual(ex.items, ['prompt:pdf-ua-1-remediation-assistant']);
  assert.ok(fs.existsSync(new URL('members/nareshdevineni/prompts/pdf-ua-1-remediation-assistant/index.md', ROOT)));
  const v = src('scripts/validate-content.mjs');
  assert.match(v, /if \(AUTHOR_NOTE_EXEMPT\.has\(`\$\{type\}:\$\{slug\}`\)\) continue;/);
  const h = src('scripts/lib/validate-house-config.mjs');
  assert.match(h, /^  validateAuthorNoteExempt\(\);$/m, 'the exemption file is itself checked');
  assert.match(h, /names no content file/);
});
