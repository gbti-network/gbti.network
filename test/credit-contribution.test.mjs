// SOW-008/SOW-059 contribution credit: the surgical frontmatter contributor insert (credit-only, no
// points). No I/O. Run with `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { insertContributor, contributorItemYaml } from '../scripts/credit-contribution.mjs';

// ---- insertContributor (surgical frontmatter edit) ----
const C = { login: 'helper', commit: 'deadbeef', url: 'https://github.com/o/r/commit/deadbeef', class: 'correction' };

test('insertContributor adds a contributors block after author when none exists, preserving the rest', () => {
  const file = '---\ntype: post\nauthor: octocat\nstatus: published\nvisibility: public\n---\nBody here.\n';
  const out = insertContributor(file, C);
  assert.match(out, /author: octocat\ncontributors:\n {2}- login: helper/);
  assert.match(out, /commit: "deadbeef"/);
  assert.match(out, /class: correction/);
  assert.match(out, /status: published/); // untouched
  assert.match(out, /Body here\./); // body untouched
});

test('insertContributor expands an inline empty contributors: []', () => {
  const file = '---\nauthor: octocat\ncontributors: []\nstatus: published\n---\nBody.\n';
  const out = insertContributor(file, C);
  assert.match(out, /contributors:\n {2}- login: helper/);
  assert.doesNotMatch(out, /contributors:\s*\[\]/);
});

test('insertContributor appends under an existing block and is idempotent by commit', () => {
  const file = '---\nauthor: octocat\ncontributors:\n  - login: first\n    commit: "aaa"\nstatus: published\n---\nBody.\n';
  const out = insertContributor(file, C);
  assert.match(out, /- login: first/);
  assert.match(out, /- login: helper/);
  // running again with the same commit changes nothing
  assert.equal(insertContributor(out, C), out);
});

test('contributorItemYaml omits absent optional fields', () => {
  const y = contributorItemYaml({ login: 'x' });
  assert.equal(y, '  - login: x');
});
