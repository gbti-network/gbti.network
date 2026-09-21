// The weekly send moved from Monday to Tuesday on 2026-09-21 (owner). The Monday issue had already gone out, so
// without a hold the first Tuesday cron would have mailed a second issue the very next morning. The scheduled
// compile now holds any issue within six days of the last one; the admin's manual compile is not held.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysSinceLastIssue } from '../membership/mail-compile-core.mjs';
import { compileWeeklyIssue } from '../workers/signup/mail-compile.mjs';
import { getIssue, putIssue } from '../workers/signup/mail-store.mjs';
import { subscriberKey } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';

test('days since the last issue are read from the issue ids, newest earlier issue only', () => {
  assert.equal(daysSinceLastIssue(['weekly-2026-09-14', 'weekly-2026-09-21'], 'weekly-2026-09-22'), 1);
  assert.equal(daysSinceLastIssue(['weekly-2026-09-21'], 'weekly-2026-09-29'), 8);
  assert.equal(daysSinceLastIssue(['weekly-2026-09-21', 'weekly-2026-09-30'], 'weekly-2026-09-29'), 8, 'a later id is not "earlier"');
  assert.equal(daysSinceLastIssue([], 'weekly-2026-09-22'), null, 'no earlier issue');
  assert.equal(daysSinceLastIssue(['weekly-2026-09-21'], 'not-an-id'), null);
});

function makeKV() {
  const m = new Map();
  return {
    m,
    async get(key, type) { const e = m.get(key); if (e == null) return null; return type === 'json' ? JSON.parse(e) : e; },
    async put(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const TUESDAY = Date.UTC(2026, 8, 22, 12, 0, 0); // the morning after the last Monday issue
const NEXT_TUESDAY = Date.UTC(2026, 8, 29, 12, 0, 0);
function seeded() {
  const kv = makeKV();
  kv.m.set('mail:issue:weekly-2026-09-21', JSON.stringify({ issueId: 'weekly-2026-09-21', generatedAt: Date.UTC(2026, 8, 21, 12), pool: [], sections: {}, layout: [] }));
  const rec = { ...buildSubscriber({ hash: 'r1', source: 'anon', emailEnc: 'enc:r1' }, { now: () => 0 }), welcomedAt: 1 };
  kv.m.set(subscriberKey('r1'), JSON.stringify(rec));
  return kv;
}
let fetched = 0;
const deps = (kv, now, extra = {}) => ({
  kv, now: () => now, siteUrl: 'https://gbti.network',
  fetchImpl: async () => { fetched += 1; return { ok: true, json: async () => ({ entries: [] }) }; },
  queryItems: async () => ({ items: [] }),
  readEntitlement: async () => [],
  ...extra,
});

test('the scheduled compile holds an issue the morning after the last one, and gathers nothing', async () => {
  const kv = seeded();
  fetched = 0;
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv, TUESDAY, { minGapDays: 6 }));
  assert.equal(r.skipped, true);
  assert.match(r.reason, /last issue went out 1 day/);
  assert.equal(await getIssue(kv, 'weekly-2026-09-22'), null, 'nothing is frozen');
  assert.equal(fetched, 0, 'and nothing is fetched');
  assert.ok(![...kv.m.keys()].some((k) => k.startsWith('mail:send:')), 'and nobody is enqueued');
});

test('a week later the scheduled compile goes out as normal', async () => {
  const kv = seeded();
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv, NEXT_TUESDAY, { minGapDays: 6 }));
  assert.equal(r.composed, true, JSON.stringify(r));
  assert.ok(await getIssue(kv, 'weekly-2026-09-29'));
  assert.equal(r.enqueued, 1);
});

test('the admin manual compile (no minGapDays) is not held', async () => {
  const kv = seeded();
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv, TUESDAY));
  assert.equal(r.composed, true, JSON.stringify(r));
});

test('a re-run on the day an issue already exists is still the idempotent reuse, not a hold', async () => {
  const kv = seeded();
  await putIssue(kv, { issueId: 'weekly-2026-09-29', generatedAt: NEXT_TUESDAY, pool: [], sections: {}, layout: [] });
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv, NEXT_TUESDAY, { minGapDays: 6 }));
  assert.notEqual(r.skipped, true);
  assert.equal(r.composed, false);
});

test('WIRING: the scheduled weekly job passes the hold, or none of the above reaches the cron', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../workers/signup/index.mjs', import.meta.url), 'utf8');
  const job = src.slice(src.indexOf('const WEEKLY_DIGEST_JOB'), src.indexOf("label: 'weekly digest compile'"));
  assert.ok(job.length > 0, 'the job definition must be found, or this checks nothing');
  assert.match(job, /compileWeeklyIssue\(env, \{ minGapDays: 6 \}\)/);
});
