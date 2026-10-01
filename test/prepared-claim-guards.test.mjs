// sow-427 C1-C3: source-level guards on the claim half of prepared listings. Each is a rule a functional test cannot
// see break: a file past the cap, a log line that prints the invitation code or a person's name, copy that breaks the
// writing rules, a route that caches or drops its credentials, a POST that starts reading more of its body, and the
// C1 move that must not change what membership-author.mjs exports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
import { workerSource } from './lib/worker-source.mjs';

const NEW_MODULES = [
  'workers/signup/hosted-commit.mjs',
  'workers/signup/membership-claim.mjs',
  'workers/signup/prepared-claim-finalize.mjs',
  'workers/signup/prepared-claim-sweep.mjs',
  'workers/signup/listing-claimed-alert.mjs',
];
const NEW_TESTS = [
  'test/prepared-claim.test.mjs',
  'test/prepared-claim-status.test.mjs',
  'test/prepared-claim-finalize.test.mjs',
  'test/listing-claimed-alert.test.mjs',
  'test/prepared-claim-guards.test.mjs',
  'test/prepared-claim-fixtures.mjs',
];
const TOUCHED = ['workers/signup/membership-author.mjs'];
const LOG = /\bconsole\.|\bwlog\(/;

/**
 * The PROSE of a source file: its comments and its string literals. The spaced-hyphen, contraction and "trial" rules
 * are about words a person reads, and `b.number - a.number` is arithmetic, not a dash. Over-inclusive on purpose (a
 * `//` inside a URL string pulls in the rest of that line), which can only add false alarms, never hide one.
 */
function prose(src) {
  const out = [];
  for (const line of src.split('\n')) {
    const c = line.indexOf('//');
    if (c >= 0) out.push(line.slice(c + 2));
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('/**')) out.push(t.replace(/^\/?\*+/, ''));
    for (const m of line.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`]*)`|"([^"\\]*(?:\\.[^"\\]*)*)"/g)) out.push((m[1] ?? m[2] ?? m[3]).replace(/\\(['"`])/g, '$1'));
  }
  return out.join('\n');
}

test('each new module and test file, and the slimmed author module, stays at or under 900 lines', () => {
  for (const f of [...NEW_MODULES, ...NEW_TESTS, ...TOUCHED]) {
    const n = read(f).split('\n').length;
    assert.ok(n > 40, `${f} was read as nearly empty: this check is broken, not the subject`);
    assert.ok(n <= 900, `${f} is over the 900-line cap (${n})`);
  }
});

test('no new module logs, except ONE fixed sentence in the alert with nothing interpolated into it', () => {
  for (const f of NEW_MODULES.filter((m) => !m.endsWith('listing-claimed-alert.mjs'))) {
    assert.doesNotMatch(read(f), LOG, `${f} must not log: the code is a bearer secret, the title and names are about a person`);
  }
  const alert = read('workers/signup/listing-claimed-alert.mjs');
  const calls = alert.match(/console\.[a-z]+\([^\n]*\);/g) || [];
  assert.equal(calls.length, 1, 'exactly one log line in the alert');
  assert.match(calls[0], /^console\.warn\('[^'`$+]*'\);$/, 'a single plain string literal: no template, no variable, no concatenation');
  assert.doesNotMatch(alert, /\bwlog\(/);
});

test('the claim route line: credentialed CORS, the cookie session, never cached, the notice through waitUntil', () => {
  const idx = workerSource();
  const at = idx.indexOf("pathname === '/membership/claim'");
  assert.ok(at > 0, 'the claim route is wired');
  // The route groups hold their blocks at two spaces (member-routes.mjs), so the next block starts a line there.
  const b = idx.slice(at, idx.indexOf('\n  if (pathname ===', at + 10));
  assert.match(b, /corsHeaders\(request, env, \{ credentials: true \}\)/);
  assert.match(b, /membershipClaimStatus\(request, env, \{ allowCookie: true \}\)/);
  assert.match(b, /membershipClaimPost\(request, env, \{ allowCookie: true \}\)/);
  assert.match(b, /'Cache-Control': 'no-store'/);
  assert.match(b, /ctx\.waitUntil\(sendListingClaimedAlert\(env, r\.notify\)\)/);
  assert.doesNotMatch(b, LOG);
  // The manager finalizes publishing rows as it loads, through the claim module's hook.
  assert.match(idx, /membershipPreparedGet\(request, env, \{ allowCookie: true, finalize: preparedFinalizeHook\(env, ctx\) \}\)/);
});

test('the finalize sweep rides the existing five-minute tick (no new cron), and returns into its logged result', () => {
  const idx = workerSource();
  const fn = idx.slice(idx.indexOf('async function drainFiveMinute('), idx.indexOf('const WEEKLY_DIGEST_JOB'));
  assert.match(fn, /await sweepPreparedClaims\(env\)/);
  assert.match(fn, /return \{[^}]*\bprepared\b[^}]*\}/);
  assert.match(fn, /catch \{ prepared = \{ error: true \}; \}/, 'a failure is a flag, never its message (which could quote a record)');
});

test('the claim POST reads `code` and `note` from its body and NOTHING else, and never widens the folder', () => {
  const src = read('workers/signup/membership-claim.mjs');
  assert.match(src, /const \{ code, note: rawNote \} = payload;/);
  assert.doesNotMatch(src, /payload\??\.|payload\[/, 'no other field of the request body is read');
  assert.match(src, /allowAnyFolder: false/);
  assert.doesNotMatch(src, /allowAnyFolder: true/);
  assert.doesNotMatch(src, /membership-audience|editorial-records|recordEditorialItems/, 'the stored record IS the approval (skipped on purpose)');
  assert.doesNotMatch(src, /toLowerCase\(\)/, 'the folder never falls back to a lowercased login (amendment 19)');
});

test('C1: the move left membership-author.mjs exporting exactly what it did, with one copy of the commit path', async () => {
  const m = await import('../workers/signup/membership-author.mjs');
  assert.deepEqual(Object.keys(m).sort(), ['approvedOnMain', 'audienceRefusal', 'isCommentOnly', 'membershipAuthor', 'membershipAuthorTargets']);
  const src = read('workers/signup/membership-author.mjs');
  assert.match(src, /import \{ readMembersIndex, commitHostedFiles \} from '\.\/hosted-commit\.mjs';/);
  assert.doesNotMatch(src, /function applyFile|function ghJson|function b64utf8|\/git\/refs/, 'no second copy left behind');
});

test('the copy in the new modules follows the writing rules', () => {
  const contraction = /\b(?:can't|won't|don't|doesn't|isn't|aren't|wasn't|weren't|didn't|hasn't|haven't|hadn't|couldn't|wouldn't|shouldn't|it's|that's|there's|you're|we're|they're|you've|we've|let's)\b/i;
  for (const f of NEW_MODULES) {
    const src = read(f);
    const words = prose(src);
    assert.ok(words.length > 500, `${f}: the prose extractor found almost nothing, so this check is broken`);
    assert.doesNotMatch(src, /—|–/, `${f}: no em or en dash anywhere`);
    assert.doesNotMatch(words, /[A-Za-z0-9,.)] - [A-Za-z0-9(]/, `${f}: no spaced hyphen standing in for a dash`);
    assert.doesNotMatch(words, /\btrial\b/i, `${f}: "free year", never "trial"`);
    assert.doesNotMatch(words, contraction, `${f}: no contractions`);
  }
});

// A control for the scans above: each pattern must fire on a line that breaks it, or a green run proves nothing.
test('control: the scans fire on a line that breaks each rule', () => {
  assert.match('console.log(code)', LOG);
  assert.doesNotMatch("console.warn(`claim ${code}`);", /^console\.warn\('[^'`$+]*'\);$/);
  assert.doesNotMatch("console.warn('claim ' + code);", /^console\.warn\('[^'`$+]*'\);$/);
  assert.match('a — b', /—|–/);
  assert.match('word - word', /[A-Za-z0-9,.)] - [A-Za-z0-9(]/);
  assert.match('your trial year', /\btrial\b/i);
  assert.match('x = payload.slug', /payload\??\.|payload\[/);
  // The prose extractor: arithmetic is not prose, but a comment, a quoted string and a template all are.
  assert.doesNotMatch(prose('const age = now - then;'), /[A-Za-z0-9,.)] - [A-Za-z0-9(]/);
  assert.match(prose('x(); // the lock - held'), /[A-Za-z0-9,.)] - [A-Za-z0-9(]/);
  assert.match(prose(" * a free trial year"), /\btrial\b/i);
  assert.match(prose("bad(400, 'x', 'It isn\\'t ready')"), /isn't/, 'an escaped apostrophe still reads as a contraction');
  assert.match(prose('bad(400, "It isn\'t ready")'), /isn't/);
  assert.match(prose('bad(400, `the year - used`)'), /[A-Za-z0-9,.)] - [A-Za-z0-9(]/);
});
