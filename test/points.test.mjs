// SOW-008 contributor points: pure award logic, the dispute state machine, totals, and the surgical
// frontmatter contributor insert. No I/O. Run with `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classToPoints,
  buildAward,
  rejectAward,
  adjudicate,
  effectivePoints,
  totalPoints,
  upsertLedger,
  AWARD_STATUS,
} from '../membership/points.mjs';
import { insertContributor, contributorItemYaml } from '../scripts/award-contribution.mjs';

// ---- classToPoints ----
test('classToPoints: grammar courtesy 0, correction 1, addition floor 1 (+bonus), unknown 0', () => {
  assert.equal(classToPoints('grammar'), 0);
  assert.equal(classToPoints('correction'), 1);
  assert.equal(classToPoints('addition'), 1);
  assert.equal(classToPoints('addition', { additionBonus: 2 }), 3);
  assert.equal(classToPoints('whatever'), 0);
});

// ---- buildAward ----
const base = {
  contributorGithubId: '500',
  contributorLogin: 'helper',
  ownerGithubId: '100',
  target: { username: 'octocat', type: 'post', slug: 'hello' },
  commit: 'deadbeef',
  url: 'https://github.com/o/r/commit/deadbeef',
  now: '2026-06-03',
};

test('buildAward: correction yields a 1-point awarded record keyed by commit', () => {
  const a = buildAward({ ...base, klass: 'correction' });
  assert.equal(a.points, 1);
  assert.equal(a.status, AWARD_STATUS.awarded);
  assert.equal(a.id, 'award-deadbeef');
  assert.equal(a.contributor_github_id, '500');
});

test('buildAward: grammar is courtesy -> null (no ledger entry)', () => {
  assert.equal(buildAward({ ...base, klass: 'grammar' }), null);
});

test('buildAward: a self-contribution earns nothing', () => {
  assert.equal(buildAward({ ...base, contributorGithubId: '100', klass: 'addition' }), null);
});

test('buildAward: a banned contributor earns nothing', () => {
  assert.equal(buildAward({ ...base, klass: 'addition', banned: true }), null);
});

// ---- dispute state machine ----
test('rejectAward then adjudicate upheld -> 0 points; overturned -> award stands', () => {
  const a = buildAward({ ...base, klass: 'addition', additionBonus: 1 }); // 2 points
  assert.equal(a.points, 2);
  const rejected = rejectAward(a, { reason: 'just a typo', now: '2026-06-04' });
  assert.equal(rejected.status, AWARD_STATUS.authorRejected);
  assert.equal(effectivePoints(rejected), 0); // pending dispute not counted

  const upheld = adjudicate(rejected, { upheld: true, now: '2026-06-05' });
  assert.equal(upheld.status, AWARD_STATUS.adminUpheld);
  assert.equal(upheld.points, 0);
  assert.equal(effectivePoints(upheld), 0);

  const overturned = adjudicate(rejected, { upheld: false, now: '2026-06-05' });
  assert.equal(overturned.status, AWARD_STATUS.adminOverturned);
  assert.equal(effectivePoints(overturned), 2);
});

// ---- totals + ledger upsert ----
test('totalPoints sums only effective (counted) points for a contributor', () => {
  const ledger = [
    buildAward({ ...base, commit: 'c1', klass: 'correction' }), // 1
    buildAward({ ...base, commit: 'c2', klass: 'addition', additionBonus: 2 }), // 3
    adjudicate(rejectAward(buildAward({ ...base, commit: 'c3', klass: 'correction' })), { upheld: true }), // 0
  ];
  assert.equal(totalPoints(ledger, '500'), 4);
  assert.equal(totalPoints(ledger, '999'), 0);
});

test('upsertLedger adds a new award and replaces by id', () => {
  const a = buildAward({ ...base, commit: 'c1', klass: 'correction' });
  let ledger = upsertLedger([], a);
  assert.equal(ledger.length, 1);
  const updated = adjudicate(rejectAward(a), { upheld: true });
  ledger = upsertLedger(ledger, updated);
  assert.equal(ledger.length, 1); // replaced, not appended
  assert.equal(ledger[0].status, AWARD_STATUS.adminUpheld);
});

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
