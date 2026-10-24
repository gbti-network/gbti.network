// sow-472: the digest sign-up runs every day. No network, no KV, no secrets.
//
// The one-time August backfill becomes a daily run, so four promises are made here that a one-off never had
// to keep: it plans no follows, it writes nothing past its ceiling, it names every accepted project claim, and
// its log (public, since the repository is) carries no names. Each test mixes people who should be added with
// people who should not, as the backfill suite does, so a rule that silently stopped working cannot pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  planRun, ceilingVerdict, claimsReport, emptyFollowPlan, CLAIM_OUTCOME, IDENTITY_REASON, DIGEST_ENROLL_REPORT_KEY,
  excludedIdsFrom,
} from '../scripts/lib/mail-enroll.mjs';
import { parseArgs, enactRun, renderReport } from '../scripts/mail-enroll.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const NOW = () => 1_761_000_000_000;

const member = (githubId, status, over = {}) => ({
  githubId,
  githubLogin: `login${githubId}`,
  username: `user${githubId}`,
  email: `${githubId}@example.test`,
  effective: { status, source: 'stripe' },
  ...over,
});

// Two to add, one banned, one with no address, one who unsubscribed, one already on the list.
const POPULATION = [
  member('1', 'paid'),
  member('2', 'none'),
  member('5', 'banned'),
  member('6', 'paid', { email: null, _gather: 'override-only' }),
  member('7', 'paid'),
  member('8', 'paid'),
];
const IDENTITIES = new Map(POPULATION.map((m) => [
  m.githubId, m.email ? { hash: `h${m.githubId}`, reason: IDENTITY_REASON.OK } : { hash: null, reason: IDENTITY_REASON.NO_EMAIL },
]));
const BASE = { members: POPULATION, identities: IDENTITIES, suppressed: new Set(['h7']), enrolled: new Set(['h8']), now: NOW };

const claim = (by, login, day, over = {}) => ({ claimedAt: `2026-10-${day}T12:00:00.000Z`, claimedBy: by, claimedLogin: login, ...over });

test('the daily flags parse, and a dry run stays the default', () => {
  const daily = parseArgs(['--apply', '--digest-only', '--counts-only', '--report-to-kv', '--max-additions=25']);
  assert.deepEqual(daily, { apply: true, json: false, digestOnly: true, countsOnly: true, reportToKv: true, maxAdditions: '25' });
  const bare = parseArgs([]);
  assert.equal(bare.apply, false);
  assert.equal(bare.digestOnly, false);
  assert.equal(bare.maxAdditions, null, 'no flag means no ceiling, which only a by-hand run may use');
});

test('the ceiling admits up to its number, refuses past it, and refuses a ceiling it cannot read', () => {
  assert.equal(ceilingVerdict(25, '25').ok, true, 'exactly at the ceiling is allowed');
  assert.equal(ceilingVerdict(26, '25').ok, false, 'one past it is not');
  assert.equal(ceilingVerdict(0, '0').ok, true);
  assert.equal(ceilingVerdict(1, 0).ok, false);
  assert.equal(ceilingVerdict(500, null).ok, true, 'no ceiling given');
  // A typo in the workflow must stop the run, never lift the limit.
  for (const bad of ['abc', '-1', '2.5', '', 'Infinity']) {
    const v = ceilingVerdict(1, bad);
    assert.equal(v.ok, false, `ceiling ${JSON.stringify(bad)} refuses`);
    assert.match(v.reason, /not a whole number/);
  }
});

test('a digest-only run plans no follow write, and the same run without it does (the control)', () => {
  const daily = planRun({ ...BASE, digestOnly: true });
  assert.equal(daily.followPlan.writes.length, 0, 'nobody is made to follow the house accounts');
  assert.deepEqual(daily.followPlan, emptyFollowPlan());

  const backfill = planRun({ ...BASE, digestOnly: false });
  assert.ok(backfill.followPlan.writes.length > 0, 'without the switch the follow half still plans writes');

  // The switch changes the follows and nothing else: the digest half is identical either way.
  assert.deepEqual(daily.mailPlan, backfill.mailPlan);
  assert.deepEqual(daily.mailPlan.enroll.map((r) => r.githubId).sort(), ['1', '2']);
});

test('past the ceiling NOTHING is written, not the first few; under it only subscriber records are', async () => {
  const puts = [];
  const put = async (key) => { puts.push(key); };

  const over = planRun({ ...BASE, digestOnly: true, maxAdditions: '1' });
  const refused = await enactRun({ run: over, apply: true, put });
  assert.equal(refused.refused, true);
  assert.equal(puts.length, 0, 'a refused run writes nothing at all');

  const dry = await enactRun({ run: planRun({ ...BASE, digestOnly: true, maxAdditions: '1' }), apply: false, put });
  assert.equal(dry.refused, false, 'a dry run is never refused, so it can show the number to set');
  assert.equal(puts.length, 0, 'and writes nothing');

  const ok = await enactRun({ run: planRun({ ...BASE, digestOnly: true, maxAdditions: '25' }), apply: true, put });
  assert.equal(ok.subscribers, 2);
  assert.equal(ok.follows, 0);
  assert.deepEqual(puts.sort(), ['mail:subscriber:h1', 'mail:subscriber:h2'], 'subscriber records only, for the two to add');
});

test('every accepted claim is named with what happened to it, including one the gather never saw', () => {
  const { mailPlan } = planRun({ ...BASE, digestOnly: true });
  const rows = claimsReport([
    claim('2', 'free-claimant', '21'),
    claim('8', 'already-on', '03'),
    claim('7', 'unsubscribed', '10'),
    claim('6', 'no-address', '13'),
    claim('5', 'banned-one', '15'),
    claim('99', 'missing-from-gather', '23'),
    { claimedAt: null, claimedBy: '1', claimedLogin: 'not-claimed-yet' }, // an open invitation is not a claim
    null,
    'junk',
  ], mailPlan);

  assert.deepEqual(rows.map((r) => [r.claimedAt, r.login, r.outcome]), [
    ['2026-10-03', 'already-on', CLAIM_OUTCOME.ALREADY],
    ['2026-10-10', 'unsubscribed', CLAIM_OUTCOME.SUPPRESSED],
    ['2026-10-13', 'no-address', CLAIM_OUTCOME.UNREACHABLE],
    ['2026-10-15', 'banned-one', CLAIM_OUTCOME.BANNED],
    ['2026-10-21', 'free-claimant', CLAIM_OUTCOME.ENROL],
    ['2026-10-23', 'missing-from-gather', CLAIM_OUTCOME.NOT_GATHERED],
  ]);
});

function report(opts) {
  const run = planRun({ ...BASE, digestOnly: true, maxAdditions: '25' });
  const claims = claimsReport([claim('6', 'no-address', '13'), claim('2', 'free-claimant', '21')], run.mailPlan);
  return renderReport({
    mailPlan: run.mailPlan, followPlan: run.followPlan, counts: run.counts, apply: true, haveKey: true, unsubProven: true,
    population: { total: POPULATION.length, byStatus: {}, overrideOnlyGathered: 1 }, digestOnly: true, ceiling: run.ceiling, claims, ...opts,
  });
}

test('the public log carries counts and no names; the same report without the switch names them (the control)', () => {
  const pub = report({ countsOnly: true });
  for (const name of ['login6', 'login2', 'no-address', 'free-claimant', 'github_id 6', 'mail:subscriber:h']) {
    assert.ok(!pub.includes(name), `the public log must not carry ${JSON.stringify(name)}`);
  }
  assert.match(pub, /UNREACHABLE, by name in KV, not in this public log\s*$/m);
  assert.ok(pub.includes(DIGEST_ENROLL_REPORT_KEY), 'and it says where the names are');
  assert.match(pub, /ACCEPTED PROJECT CLAIMS/);

  const named = report({ countsOnly: false });
  assert.ok(named.includes('login6'), 'without --counts-only the unreachable member is named');
  assert.ok(named.includes('free-claimant'), 'and so is the claimant');
});

test('a digest-only report says the follows are off instead of counting them', () => {
  const text = report({ countsOnly: true });
  assert.match(text, /FOLLOW BACKFILL: off for this run/);
  assert.ok(!/members needing at least one follow/.test(text));
});

test('the daily workflow runs with every one of the four daily switches', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/digest-enroll.yml'), 'utf8');
  // The COMMAND line, not the file: the header comment names every flag too, and a check of the whole file
  // passed with --counts-only deleted from the command (found by breaking it on purpose).
  const commands = wf.split('\n').filter((l) => /^\s*node scripts\/mail-enroll\.mjs\b/.test(l));
  assert.equal(commands.length, 1, 'exactly one command runs the sign-up');
  for (const flag of ['--digest-only', '--counts-only', '--report-to-kv', '--max-additions=']) {
    assert.ok(commands[0].includes(flag), `digest-enroll.yml passes ${flag}`);
  }
  assert.match(wf, /schedule:/, 'it is scheduled, which is the whole point of sow-472');
});

// ---- the owner, 2026-10-23: "make sure that people who we are adding [have not] previously unsubscribed" ----

test('a member already on the list under an EARLIER address is not added again, so a digest switched off stays off', () => {
  // Member 3 changed their GitHub email: their record (digest switched off) sits under the old address's hash,
  // and their current address hashes to h3, which no record carries.
  const members = [...POPULATION, member('3', 'paid')];
  const identities = new Map([...IDENTITIES, ['3', { hash: 'h3', reason: IDENTITY_REASON.OK }]]);
  const withIds = planRun({ ...BASE, members, identities, digestOnly: true, enrolledGithubIds: new Set(['3', '8']) });
  assert.ok(!withIds.mailPlan.enroll.some((r) => r.githubId === '3'), 'not added a second time');
  assert.ok(withIds.mailPlan.alreadyEnrolled.some((r) => r.githubId === '3' && r.underEarlierAddress));

  // The control: matching on the hash alone, as the August backfill did, adds them.
  const hashOnly = planRun({ ...BASE, members, identities, digestOnly: true });
  assert.ok(hashOnly.mailPlan.enroll.some((r) => r.githubId === '3'), 'without the account match they would be added');
});

test('a subscriber record that cannot be read refuses the apply, because who is already on the list is unknown', async () => {
  const puts = [];
  const run = planRun({ ...BASE, digestOnly: true, maxAdditions: '25', subscribersUnreadable: 1 });
  assert.match(run.refusal, /could not be read/);
  const res = await enactRun({ run, apply: true, put: async (k) => { puts.push(k); } });
  assert.equal(res.refused, true);
  assert.equal(puts.length, 0, 'nothing written');
  // The control: the same run with every record readable writes.
  const fine = await enactRun({ run: planRun({ ...BASE, digestOnly: true, maxAdditions: '25' }), apply: true, put: async (k) => { puts.push(k); } });
  assert.equal(fine.refused, false);
  assert.ok(puts.length > 0);
});

test('every unsubscribe on record is counted, and the ones this run cannot place are counted separately', () => {
  // h7 is a current member who unsubscribed; hx and hy match nobody in the run (a public-form subscriber, or a
  // member whose address has changed since, which a pseudonymous marker cannot tell apart).
  const run = planRun({ ...BASE, suppressed: new Set(['h7', 'hx', 'hy']), digestOnly: true });
  assert.deepEqual(run.unsubscribes, { onRecord: 3, matched: 1, unmatched: 2 });
  assert.ok(!run.mailPlan.enroll.some((r) => r.githubId === '7'), 'the member who unsubscribed is left off');
  const text = renderReport({
    mailPlan: run.mailPlan, followPlan: run.followPlan, counts: run.counts, apply: false, haveKey: true, unsubProven: true,
    digestOnly: true, countsOnly: true, ceiling: run.ceiling, unsubscribes: run.unsubscribes, refusal: run.refusal,
  });
  assert.match(text, /unsubscribes on record\s*$/m);
  assert.match(text, /\s2\s+not matched to anyone in this run/);
});

// ---- the owner, 2026-10-23: leave the test accounts out ----

test('an account on the owner\'s exclusion list is never added, and is named as left off by the owner', async () => {
  const puts = [];
  const run = planRun({ ...BASE, digestOnly: true, maxAdditions: '25', excluded: new Set(['2']) });
  assert.ok(!run.mailPlan.enroll.some((r) => r.githubId === '2'), 'the excluded account is not added');
  assert.deepEqual(run.mailPlan.excludedByOwner.map((r) => r.githubId), ['2']);
  assert.equal(run.counts.excludedByOwner, 1);
  await enactRun({ run, apply: true, put: async (k) => { puts.push(k); } });
  assert.deepEqual(puts, ['mail:subscriber:h1'], 'only the one who is not excluded is written');
  // A claimant on the list says so in the claims report rather than "not found".
  assert.equal(claimsReport([claim('2', 'demo', '17')], run.mailPlan)[0].outcome, CLAIM_OUTCOME.OWNER);
  // The control: without the list they are added.
  assert.ok(planRun({ ...BASE, digestOnly: true }).mailPlan.enroll.some((r) => r.githubId === '2'));
});

test('the exclusion list: absent means nobody, unreadable or malformed refuses the run', async () => {
  assert.deepEqual([...excludedIdsFrom({ ok: true, value: null, status: 404 }).ids], []);
  assert.deepEqual([...excludedIdsFrom({ ok: true, value: '{"ids":["7"," 8 ",""],"note":"test accounts"}' }).ids], ['7', '8']);
  assert.deepEqual([...excludedIdsFrom({ ok: true, value: { ids: [9] } }).ids], ['9']);
  for (const bad of [{ ok: false, status: 500 }, { ok: true, value: 'not json' }, { ok: true, value: '{"id":["7"]}' }, { ok: true, value: '["7"]' }, null]) {
    assert.equal(excludedIdsFrom(bad).ok, false, `refuses ${JSON.stringify(bad)}`);
  }
  // A refusal from the list stops the write, as the ceiling does.
  const puts = [];
  const run = planRun({ ...BASE, digestOnly: true, maxAdditions: '25', exclusionProblem: 'the exclusion list could not be read' });
  assert.equal(run.refusal, 'the exclusion list could not be read');
  const res = await enactRun({ run, apply: true, put: async (k) => { puts.push(k); } });
  assert.equal(res.refused, true);
  assert.equal(puts.length, 0);
});

test('"under an earlier address" counts only members whose current address has no record of its own', () => {
  // Member 8's record is under h8, which is also their current address: an ordinary repeat. Member 3's record
  // is under an old address, and their current one (h3) has none: an address change.
  const members = [...POPULATION, member('3', 'paid')];
  const identities = new Map([...IDENTITIES, ['3', { hash: 'h3', reason: IDENTITY_REASON.OK }]]);
  const run = planRun({ ...BASE, members, identities, digestOnly: true, enrolledGithubIds: new Set(['3', '8']) });
  const flags = Object.fromEntries(run.mailPlan.alreadyEnrolled.map((r) => [r.githubId, r.underEarlierAddress]));
  assert.deepEqual(flags, { 3: true, 8: false });
});
