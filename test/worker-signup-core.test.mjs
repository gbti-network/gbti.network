// Tests the pure, testable logic factored out of the signup Worker (SOW-002): the units that decide what a signup
// writes and how its state is carried, before any Stripe or Discord call is made. No network, no secrets: a
// recording fake fetch stands in for Turnstile. Split out of test/worker.test.mjs at the 900-line limit (owner,
// 2026-09-30); the shared fixtures live in test/lib/worker-fixtures.mjs.
//
// Coverage:
//   - referral: self-reject, first-touch, empty handling
//   - decideCustomer: reuse on a search hit, create on a miss
//   - new-customer metadata: the referral, via and touch session it binds, none of them rewritten on a refresh
//   - session: sign + verify round trip, tamper rejection, expiry
//   - Turnstile: request shaping + fail-closed
//   - packState / unpackState: round trip + tamper rejection

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveReferral, normalizeRefCode } from '../workers/signup/referral.mjs';
import { decideCustomer, buildNewCustomerMetadata, buildRefreshMetadata, normalizeVia } from '../workers/signup/signup.mjs';
import { signSession, verifySession } from '../workers/signup/session.mjs';
import { verifyTurnstile } from '../workers/signup/abuse.mjs';
import { packState, unpackState } from '../workers/signup/index.mjs';
import { SECRET, recorder } from './lib/worker-fixtures.mjs';

// ---------------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------------

test('referral rejects self-referral (ref === new member github_id)', () => {
  const out = resolveReferral({ refCode: '777', newMemberGithubId: '777' });
  assert.equal(out, null);
});

test('referral first-touch resolves a different referrer id', () => {
  const out = resolveReferral({ refCode: ' 42 ', newMemberGithubId: '777' });
  assert.equal(out, '42');
});

test('referral with no code or empty code returns null', () => {
  assert.equal(resolveReferral({ refCode: undefined, newMemberGithubId: '1' }), null);
  assert.equal(resolveReferral({ refCode: '   ', newMemberGithubId: '1' }), null);
  assert.equal(normalizeRefCode(''), null);
  assert.equal(normalizeRefCode('x'), 'x');
});

test('referral resolver mapping a code to a different id is honored, self still rejected', () => {
  const resolve = (c) => (c === 'alice' ? '999' : null);
  assert.equal(resolveReferral({ refCode: 'alice', newMemberGithubId: '1', resolve }), '999');
  // resolver maps to the new member itself -> reject
  const resolveSelf = () => '1';
  assert.equal(resolveReferral({ refCode: 'alice', newMemberGithubId: '1', resolve: resolveSelf }), null);
});

// ---------------------------------------------------------------------------
// Idempotent customer decision
// ---------------------------------------------------------------------------

test('decideCustomer reuses on a search hit', () => {
  const plan = decideCustomer({ id: 'cus_existing', metadata: { github_id: '5' } });
  assert.deepEqual(plan, { action: 'reuse', customerId: 'cus_existing' });
});

test('decideCustomer creates on a miss (null)', () => {
  assert.deepEqual(decideCustomer(null), { action: 'create' });
  assert.deepEqual(decideCustomer(undefined), { action: 'create' });
});

test('buildNewCustomerMetadata includes trial_started_at and optional referred_by; refresh omits trial', () => {
  const meta = buildNewCustomerMetadata({
    githubId: '5',
    githubLogin: 'octocat',
    discordUserId: 'd9',
    trialStartedAt: '2026-06-02T00:00:00.000Z',
    signupSource: 'signup-worker',
    referredBy: '42',
  });
  assert.equal(meta.github_id, '5');
  assert.equal(meta.trial_started_at, '2026-06-02T00:00:00.000Z');
  assert.equal(meta.referred_by, '42');
  assert.equal(meta.signup_source, 'signup-worker');

  const refresh = buildRefreshMetadata({ githubLogin: 'octocat-renamed', discordUserId: 'd9' });
  assert.equal(refresh.github_login, 'octocat-renamed');
  assert.ok(!('trial_started_at' in refresh), 'refresh metadata must never carry trial_started_at');
  assert.ok(!('referred_by' in refresh), 'refresh metadata must never carry referred_by');
  assert.ok(!('via' in refresh), 'refresh metadata must never rewrite the first-touch via');
  assert.ok(!('touch_session' in refresh), 'refresh metadata must never rewrite the touch-session binding (SOW-059 P1c)');
});

test('SOW-059 P1c: buildNewCustomerMetadata binds a valid touch_session new-customer-only; drops an invalid one', () => {
  const sid = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 chars, matches the session shape
  const ok = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', touchSession: sid });
  assert.equal(ok.touch_session, sid);
  // an invalid / short / spoofed session id is dropped (never written to Stripe metadata)
  for (const bad of ['short', 'has spaces!!', 'x'.repeat(200), '', undefined]) {
    const m = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', touchSession: bad });
    assert.ok(!('touch_session' in m), `invalid sid (${bad}) must be dropped`);
  }
});

test('SOW-059 P1c: the OAuth state blob round-trips the touch sid through both hops', async () => {
  const env = { SESSION_SECRET: 'test-secret-至少-32-bytes-long-padding-xx' };
  const sid = 'abcdefghijklmnopqrstuvwxyz012345';
  const packed = await packState({ ref: '42', via: 'post:a', sid }, env);
  const back = await unpackState(packed, env);
  assert.equal(back.sid, sid);
  // re-pack at the github hop (carrying identity) preserves it
  const next = await unpackState(await packState({ ref: back.ref, via: back.via, sid: back.sid, githubId: '5', githubLogin: 'octocat' }, env), env);
  assert.equal(next.sid, sid);
  assert.equal(next.githubId, '5');
});

test('normalizeVia accepts a strict <type>:<kebab-slug> and drops anything else (fail safe)', () => {
  assert.equal(normalizeVia('post:my-slug'), 'post:my-slug');
  assert.equal(normalizeVia('project:cool-thing'), 'project:cool-thing');
  assert.equal(normalizeVia('prompt:do-x'), 'prompt:do-x');
  // dropped: wrong type, path traversal, spaces, uppercase, empty, overlong
  assert.equal(normalizeVia('page:home'), null);
  assert.equal(normalizeVia('post:../../etc/passwd'), null);
  assert.equal(normalizeVia('post: with space'), null);
  assert.equal(normalizeVia('post:UPPER'), null);
  assert.equal(normalizeVia(''), null);
  assert.equal(normalizeVia(undefined), null);
  assert.equal(normalizeVia('post:' + 'a'.repeat(500)), 'post:' + 'a'.repeat(195)); // trimmed to 200 chars total
});

test('buildNewCustomerMetadata captures a valid via and omits an invalid one', () => {
  const ok = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', via: 'project:thing' });
  assert.equal(ok.via, 'project:thing');
  const bad = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', via: 'evil payload' });
  assert.ok(!('via' in bad), 'an invalid via is dropped, never written to Stripe metadata');
});

// ---------------------------------------------------------------------------
// Session sign + verify
// ---------------------------------------------------------------------------

test('session sign + verify round trip preserves github_id and login', async () => {
  const token = await signSession({ githubId: '12345', githubLogin: 'octocat' }, SECRET);
  const payload = await verifySession(token, SECRET);
  assert.ok(payload);
  assert.equal(payload.github_id, '12345');
  assert.equal(payload.github_login, 'octocat');
});

test('session verify rejects a tampered payload', async () => {
  const token = await signSession({ githubId: '12345', githubLogin: 'octocat' }, SECRET);
  const [body, sig] = token.split('.');
  // Flip the payload (different github_id) but keep the old signature -> must fail.
  const forgedBody = Buffer.from(JSON.stringify({ github_id: '999', iat: 1, exp: 9999999999 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const tampered = `${forgedBody}.${sig}`;
  assert.equal(await verifySession(tampered, SECRET), null);
  // Wrong secret also fails.
  assert.equal(await verifySession(token, 'a-different-secret'), null);
  // Malformed token fails.
  assert.equal(await verifySession('garbage', SECRET), null);
  assert.equal(await verifySession(`${body}.`, SECRET), null);
});

test('session verify rejects an expired token', async () => {
  const past = Date.now() - 10_000;
  const token = await signSession({ githubId: '7' }, SECRET, { ttlSeconds: 1, now: past });
  assert.equal(await verifySession(token, SECRET, { now: Date.now() }), null);
});

// ---------------------------------------------------------------------------
// Turnstile verify request shaping + fail closed
// ---------------------------------------------------------------------------

test('verifyTurnstile posts secret + response (+ remoteip) to siteverify and returns success', async () => {
  const { fetch, calls } = recorder([{ body: { success: true } }]);
  const ok = await verifyTurnstile({ token: 'tok', secret: 'sek', remoteIp: '1.2.3.4' }, fetch);
  assert.equal(ok, true);
  assert.match(calls[0].url, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify$/);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].headers['Content-Type'], /application\/x-www-form-urlencoded/);
  const params = new URLSearchParams(calls[0].body);
  assert.equal(params.get('secret'), 'sek');
  assert.equal(params.get('response'), 'tok');
  assert.equal(params.get('remoteip'), '1.2.3.4');
});

test('verifyTurnstile fails closed on success:false, non-2xx, and missing inputs', async () => {
  const r1 = recorder([{ body: { success: false } }]);
  assert.equal(await verifyTurnstile({ token: 't', secret: 's' }, r1.fetch), false);
  const r2 = recorder([{ status: 500, body: 'err' }]);
  assert.equal(await verifyTurnstile({ token: 't', secret: 's' }, r2.fetch), false);
  // No token or no secret short-circuits to false without a fetch.
  const r3 = recorder([{ body: { success: true } }]);
  assert.equal(await verifyTurnstile({ token: '', secret: 's' }, r3.fetch), false);
  assert.equal(r3.calls.length, 0);
});

// ---------------------------------------------------------------------------
// packState / unpackState round-trip + tamper rejection (FIX 5 + FIX 4 CSRF control)
// ---------------------------------------------------------------------------

test('packState/unpackState round-trips the payload and rejects tampering', async () => {
  const env = { SESSION_SECRET: SECRET };
  const token = await packState({ ref: 'carol', githubId: '999', githubLogin: 'carol-dev' }, env);
  const unpacked = await unpackState(token, env);
  assert.ok(unpacked);
  assert.equal(unpacked.ref, 'carol');
  assert.equal(unpacked.githubId, '999');
  assert.equal(unpacked.githubLogin, 'carol-dev');

  // Tamper with the signed body: flip a character in the first segment, keep the signature.
  const [body, sig] = token.split('.');
  const flipped = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
  assert.equal(await unpackState(`${flipped}.${sig}`, env), null, 'tampered body must be rejected');

  // A wrong secret must also reject (the HMAC signature is the CSRF control).
  assert.equal(await unpackState(token, { SESSION_SECRET: 'a-different-secret' }), null);

  // Garbage and empty tokens fail closed.
  assert.equal(await unpackState('garbage', env), null);
  assert.equal(await unpackState('', env), null);
});
