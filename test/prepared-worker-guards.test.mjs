// sow-427 B1-B4 and B8: the source-level guards on the Worker half of prepared listings. Each one is a rule that a
// functional test cannot see break: a file that grows past the cap, a log line that prints the invitation code
// (a bearer secret) or a person's name, and copy that breaks the writing rules on a page a stranger reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
import { workerSource } from './lib/worker-source.mjs';

const NEW_MODULES = [
  'workers/signup/github-user-lookup.mjs',
  'workers/signup/prepared-store.mjs',
  'workers/signup/membership-prepared-admin.mjs',
  'workers/signup/prepared-claim-read.mjs',
];
const NEW_TESTS = [
  'test/github-user-lookup.test.mjs',
  'test/prepared-store.test.mjs',
  'test/prepared-admin.test.mjs',
  'test/prepared-admin-ops.test.mjs',
  'test/prepared-public-read.test.mjs',
  'test/prepared-worker-guards.test.mjs',
];
// Touched, under the cap, and carrying new copy an admin reads (the prepared_invite refusal).
const TOUCHED = ['workers/signup/membership-invites-admin.mjs'];

test('each new module and test file, and the touched invite module, stays at or under 900 lines', () => {
  for (const f of [...NEW_MODULES, ...NEW_TESTS, ...TOUCHED]) {
    const n = read(f).split('\n').length;
    assert.ok(n > 20, `${f} was read as nearly empty: this check is broken, not the subject`);
    assert.ok(n <= 900, `${f} is over the 900-line cap (${n})`);
  }
});

test('no new module logs anything: the code is a bearer secret, and the title, greeting and message are about a person', () => {
  for (const f of NEW_MODULES) {
    assert.doesNotMatch(read(f), /\bconsole\.|\bwlog\(/, `${f} must not log`);
  }
});

test('the route lines added to the Worker log nothing either', () => {
  const idx = workerSource();
  for (const route of ["pathname === '/membership/admin/prepared'", "pathname === '/invite/listing'"]) {
    const at = idx.indexOf(route);
    assert.ok(at > 0, `${route} is routed`);
    // The route groups hold their blocks at two spaces, so the next block starts a line there.
    const end = idx.indexOf('\n  if (pathname ===', at + route.length);
    const blockSrc = idx.slice(at, end > at ? end : at + 1200);
    assert.doesNotMatch(blockSrc, /\bconsole\.|\bwlog\(/, `${route}: no logging on this route`);
  }
});

test('the copy in the new modules follows the writing rules', () => {
  const contraction = /\b(?:can't|won't|don't|doesn't|isn't|aren't|wasn't|weren't|didn't|hasn't|haven't|hadn't|couldn't|wouldn't|shouldn't|it's|that's|there's|you're|we're|they're|you've|we've|let's)\b/i;
  for (const f of [...NEW_MODULES, ...TOUCHED]) {
    const src = read(f);
    assert.doesNotMatch(src, /—|–/, `${f}: no em or en dash`);
    assert.doesNotMatch(src, /[A-Za-z0-9,.)] - [A-Za-z0-9(]/, `${f}: no spaced hyphen standing in for a dash`);
    assert.doesNotMatch(src, /\btrial\b/i, `${f}: "free year", never "trial"`);
    assert.doesNotMatch(src, contraction, `${f}: no contractions`);
  }
});

// A control for the scans above: each pattern must fire on a line that breaks it, or a green run proves nothing.
test('control: the scans fire on a line that breaks each rule', () => {
  assert.match('console.log(code)', /\bconsole\.|\bwlog\(/);
  assert.match('a — b', /—|–/);
  assert.match('word - word', /[A-Za-z0-9,.)] - [A-Za-z0-9(]/);
  assert.match('your trial year', /\btrial\b/i);
});
