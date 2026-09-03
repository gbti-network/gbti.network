// sow-293: the creator-application ROUTES. These assert the things that are only true at the route: who is
// admitted, what a corrupt record may become, and the write ORDER on approval, which is the one property that
// decides whether an interrupted approval leaves a member with access or with a lie.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creatorApplicationSubmit,
  creatorApplicationList,
  creatorApplicationDecide,
  CREATOR_APPLICATION_REASON,
} from '../workers/signup/membership-creator-applications.mjs';
import { applicationKey, newApplication, MAX_APPLICATION_WHY } from '../membership/creator-applications.mjs';

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const req = (body) => new Request('https://example.test/', { method: 'POST', body: JSON.stringify(body) });
const ok = (githubId = '42', login = 'ada') => async () => ({ ok: true, githubId, login });
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const stored = (kv, id) => JSON.parse(kv.store.get(applicationKey(id)));

test('submit refuses an unauthorized caller and writes nothing', async () => {
  const kv = fakeKV();
  const r = await creatorApplicationSubmit(req({ why: 'let me in' }), { SIGNUP_KV: kv }, { authorize: denied });
  assert.equal(r.status, 403);
  assert.equal(kv.store.size, 0, 'a denied submission must not reach the store');
});

test('submit requires the why field and refuses over-long input instead of truncating it', async () => {
  const kv = fakeKV();
  const env = { SIGNUP_KV: kv };

  for (const body of [{}, { why: '' }, { why: '   ' }, { why: 42 }]) {
    const r = await creatorApplicationSubmit(req(body), env, { authorize: ok() });
    assert.equal(r.status, 400, `${JSON.stringify(body)} must be refused`);
  }

  // Silent truncation would judge an applicant on half an answer while telling them it succeeded.
  const long = await creatorApplicationSubmit(req({ why: 'x'.repeat(MAX_APPLICATION_WHY + 1) }), env, { authorize: ok() });
  assert.equal(long.status, 400);
  assert.equal(long.body.error, 'too_long');
  assert.equal(kv.store.size, 0);
});

test('submit stores the application under the caller identity, not one it was handed', async () => {
  const kv = fakeKV();
  // The body names a different github_id on purpose: the record must key on the AUTHORIZED identity, or one
  // member could file an application that later grants a tier to somebody else.
  const r = await creatorApplicationSubmit(
    req({ why: 'compilers', links: 'example.test/a', topics: 'rust', githubId: '999', login: 'mallory' }),
    { SIGNUP_KV: kv },
    { authorize: ok('42', 'ada'), now: new Date('2026-09-03T10:00:00Z') },
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.application.githubId, '42');
  assert.equal(r.body.application.login, 'ada');
  assert.ok(kv.store.has(applicationKey('42')));
  assert.ok(!kv.store.has(applicationKey('999')), 'the body must not choose the key');
  assert.equal(stored(kv, '42').topics, 'rust');
  assert.equal(r.record.githubId, '42', 'the stored record is returned so the notice fires on what was stored');
});

test('an approved applicant cannot resubmit; a declined one can', async () => {
  const env = (rec) => ({ SIGNUP_KV: fakeKV({ [applicationKey('42')]: JSON.stringify(rec) }) });
  const base = newApplication({ githubId: '42', why: 'first' });

  const approved = env({ ...base, decision: 'approved' });
  const r1 = await creatorApplicationSubmit(req({ why: 'again' }), approved, { authorize: ok() });
  assert.equal(r1.status, 409, 'resubmitting would overwrite the record of the approval itself');
  assert.equal(JSON.parse(approved.SIGNUP_KV.store.get(applicationKey('42'))).why, 'first', 'the stored record must be untouched');

  const declinedEnv = env({ ...base, decision: 'declined' });
  const r2 = await creatorApplicationSubmit(req({ why: 'better answer' }), declinedEnv, { authorize: ok() });
  assert.equal(r2.status, 200, 'a declined applicant must be able to improve their answer and try again');
  assert.equal(JSON.parse(declinedEnv.SIGNUP_KV.store.get(applicationKey('42'))).why, 'better answer');
});

test('the review lane is superadmin-gated and keeps corrupt records VISIBLE but marked', async () => {
  const good = newApplication({ githubId: '1', why: 'a' });
  const kv = fakeKV({
    [applicationKey('1')]: JSON.stringify(good),
    [applicationKey('2')]: JSON.stringify({ githubId: '', why: 'no identity' }), // structurally bad
  });
  const env = { SIGNUP_KV: kv };

  assert.equal((await creatorApplicationList(req({}), env, { authorize: denied })).status, 403);

  const r = await creatorApplicationList(req({}), env, { authorize: ok() });
  assert.equal(r.status, 200);
  assert.equal(r.body.applications.length, 2, 'a corrupt record must stay visible; dropping it hides it from the only surface that could notice');
  const corrupt = r.body.applications.find((a) => a.corrupt);
  assert.ok(corrupt, 'the corrupt record must be MARKED, not silently normalised into a pending one');
  assert.equal(corrupt.state, 'unknown');
  assert.equal(corrupt.key, applicationKey('2'), 'the KV key travels so it can be found when the record disagrees with where it is stored');
});

test('decide is superadmin-gated, validates the decision, and refuses anything not pending', async () => {
  const rec = newApplication({ githubId: '7', why: 'w' });
  const env = () => ({ SIGNUP_KV: fakeKV({ [applicationKey('7')]: JSON.stringify(rec) }) });

  assert.equal((await creatorApplicationDecide(req({ githubId: '7', decision: 'approved' }), env(), { authorize: denied })).status, 403);
  assert.equal((await creatorApplicationDecide(req({ decision: 'approved' }), env(), { authorize: ok() })).status, 400);
  for (const d of ['maybe', '', 'APPROVED', 'pending', 'unknown']) {
    const r = await creatorApplicationDecide(req({ githubId: '7', decision: d }), env(), { authorize: ok(), writeGrant: async () => ({ written: true }) });
    assert.equal(r.status, 400, `decision ${JSON.stringify(d)} must be refused`);
  }
  assert.equal((await creatorApplicationDecide(req({ githubId: 'nope', decision: 'approved' }), env(), { authorize: ok() })).status, 404);

  const decided = { SIGNUP_KV: fakeKV({ [applicationKey('7')]: JSON.stringify({ ...rec, decision: 'declined' }) }) };
  assert.equal((await creatorApplicationDecide(req({ githubId: '7', decision: 'approved' }), decided, { authorize: ok() })).status, 409);
});

test('a CORRUPT application can never be approved into a real tier grant', async () => {
  // The security assertion of this file. A record that reads as `unknown` is visible in the lane, and a
  // superadmin might click approve on it; approving would grant Content Creator against whatever identity the
  // broken record happens to carry.
  const kv = fakeKV({ [applicationKey('8')]: JSON.stringify({ githubId: '8', decision: 'garbage', why: 'x' }) });
  let granted = false;
  const r = await creatorApplicationDecide(
    req({ githubId: '8', decision: 'approved' }),
    { SIGNUP_KV: kv },
    { authorize: ok(), writeGrant: async () => { granted = true; return { written: true }; } },
  );
  assert.equal(r.status, 409);
  assert.equal(granted, false, 'no tier may be granted from a record that does not parse as pending');
});

test('approving writes a PERMANENT creator grant, then records the decision', async () => {
  const kv = fakeKV({ [applicationKey('5')]: JSON.stringify(newApplication({ githubId: '5', login: 'ada', why: 'w' })) });
  const order = [];
  const origPut = kv.put.bind(kv);
  kv.put = async (k, v) => { order.push('record'); return origPut(k, v); };

  let entry = null;
  const r = await creatorApplicationDecide(
    req({ githubId: '5', decision: 'approved', note: 'strong samples' }),
    { SIGNUP_KV: kv },
    {
      authorize: ok('1', 'root'),
      now: new Date('2026-09-03T12:00:00Z'),
      writeGrant: async (args) => { order.push('grant'); entry = args; return { written: true }; },
    },
  );

  assert.equal(r.status, 200);
  assert.deepEqual(order, ['grant', 'record'],
    'the grant must be written BEFORE the record: the reverse leaves an application marked approved with no tier behind it, and nothing shows it again');
  assert.equal(entry.section, 'grandfathered');
  assert.equal(entry.githubId, '5');
  assert.equal(entry.entry.tier, 'creator');
  assert.equal(entry.entry.reason, CREATOR_APPLICATION_REASON);
  assert.equal(entry.entry.login, 'ada');
  assert.ok(!('until' in entry.entry), 'a creator grant is permanent; an expiry would silently demote them');

  const rec = stored(kv, '5');
  assert.equal(rec.decision, 'approved');
  assert.equal(rec.decidedBy, '1');
  assert.equal(rec.decidedByLogin, 'root');
  assert.equal(rec.decisionNote, 'strong samples');
});

test('a FAILED grant leaves the application pending, so it comes back to the lane', async () => {
  // The other half of the ordering guarantee. If the grant cannot be written, the applicant must NOT be
  // recorded as approved: an approved record with no tier is invisible to the lane forever.
  for (const failure of [
    async () => { throw new Error('kv exploded'); },
    async () => ({ written: false, reason: 'the overrides mirror is absent' }),
  ]) {
    const kv = fakeKV({ [applicationKey('6')]: JSON.stringify(newApplication({ githubId: '6', why: 'w' })) });
    const r = await creatorApplicationDecide(req({ githubId: '6', decision: 'approved' }), { SIGNUP_KV: kv }, { authorize: ok(), writeGrant: failure });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'grant_failed');
    assert.equal(stored(kv, '6').decision, null, 'the application must stay pending when the grant did not land');
  }

  // An "already in that state" refusal is NOT a failure: the grant exists, so the decision may be recorded.
  const kv = fakeKV({ [applicationKey('6')]: JSON.stringify(newApplication({ githubId: '6', why: 'w' })) });
  const r = await creatorApplicationDecide(
    req({ githubId: '6', decision: 'approved' }), { SIGNUP_KV: kv },
    { authorize: ok(), writeGrant: async () => ({ written: false, reason: 'already in that state' }) },
  );
  assert.equal(r.status, 200);
  assert.equal(stored(kv, '6').decision, 'approved');
});

test('declining grants nothing', async () => {
  const kv = fakeKV({ [applicationKey('9')]: JSON.stringify(newApplication({ githubId: '9', why: 'w' })) });
  let granted = false;
  const r = await creatorApplicationDecide(
    req({ githubId: '9', decision: 'declined', note: 'not yet' }),
    { SIGNUP_KV: kv },
    { authorize: ok(), writeGrant: async () => { granted = true; return { written: true }; } },
  );
  assert.equal(r.status, 200);
  assert.equal(granted, false, 'a decline must never touch the grant store');
  assert.equal(stored(kv, '9').decision, 'declined');
});
