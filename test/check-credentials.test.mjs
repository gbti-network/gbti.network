// Credential health check: the pure decision logic + the probe wiring (fake fetch, no network, no email).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, evaluate, buildEmail, runProbes } from '../scripts/check-credentials.mjs';

const NOW = new Date('2026-06-20T00:00:00Z');

test('daysUntil: whole days, null for undated/unparseable', () => {
  assert.equal(daysUntil('2026-06-30T00:00:00Z', NOW), 10);
  assert.equal(daysUntil('2026-06-10T00:00:00Z', NOW), -10);
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil('not a date', NOW), null);
});

test('evaluate: a failed probe is a problem regardless of expiry', () => {
  const { problems, healthy } = evaluate([{ name: 'X', ok: false, status: 401 }], { warnDays: 30, now: NOW });
  assert.equal(healthy, false);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'failed');
  assert.match(problems[0].message, /FAILED its live check \(status 401/);
});

test('evaluate: an ok probe expiring within the window is flagged; far-future is healthy', () => {
  const within = evaluate([{ name: 'GH', ok: true, status: 200, expiresAt: '2026-07-10T00:00:00Z' }], { warnDays: 30, now: NOW });
  assert.equal(within.problems.length, 1);
  assert.equal(within.problems[0].kind, 'expiring');
  assert.match(within.problems[0].message, /expires in 20 day/);

  const far = evaluate([{ name: 'GH', ok: true, status: 200, expiresAt: '2027-06-09T00:00:00Z' }], { warnDays: 30, now: NOW });
  assert.deepEqual(far.problems, []);
  assert.equal(far.healthy, true);
});

test('evaluate: an already-expired ok probe is flagged as expired', () => {
  const { problems } = evaluate([{ name: 'GH', ok: true, status: 200, expiresAt: '2026-06-10T00:00:00Z' }], { warnDays: 30, now: NOW });
  assert.equal(problems[0].kind, 'expired');
  assert.match(problems[0].message, /EXPIRED 10 day\(s\) ago/);
});

test('evaluate: a no-expiry credential that is ok is healthy', () => {
  const { healthy } = evaluate([{ name: 'STRIPE', ok: true, status: 200 }], { warnDays: 30, now: NOW });
  assert.equal(healthy, true);
});

test('buildEmail: subject counts issues, body lists each', () => {
  const { subject, text } = buildEmail([
    { name: 'GH', kind: 'expiring', message: 'GH expires in 5 day(s).' },
    { name: 'CF', kind: 'failed', message: 'CF FAILED.' },
  ], { now: NOW });
  assert.match(subject, /2 issues/);
  assert.match(text, /\[EXPIRING\] GH expires in 5/);
  assert.match(text, /\[FAILED\] CF FAILED/);
  assert.match(text, /secrets-ops\/README\.md/);
});

test('runProbes: reads the GitHub expiry header, skips absent credentials', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push(url);
    if (url.includes('api.github.com')) {
      assert.match(init.headers.Authorization, /^Bearer /);
      return { ok: true, status: 200, headers: { get: (h) => (h === 'github-authentication-token-expiration' ? '2027-06-09 14:33:55 +0000' : null) } };
    }
    if (url.includes('api.stripe.com')) return { ok: true, status: 200, headers: { get: () => null } };
    throw new Error('unexpected url ' + url);
  };
  // Only GitHub + Stripe present -> Discord + Cloudflare are skipped.
  const results = await runProbes({ env: { GITHUB_BOT_TOKEN: 'ghp_x', STRIPE_SECRET_KEY: 'rk_live_x' }, fetch: fakeFetch });
  assert.equal(results.length, 2);
  const gh = results.find((r) => r.name.startsWith('GH_BOT_TOKEN'));
  assert.equal(gh.ok, true);
  assert.equal(gh.expiresAt, '2027-06-09 14:33:55 +0000');
  assert.ok(calls.some((u) => u.includes('api.github.com')));
  assert.ok(!calls.some((u) => u.includes('discord.com')));
});

test('runProbes: a thrown fetch becomes a failed (not a crash)', async () => {
  const results = await runProbes({ env: { DISCORD_BOT_TOKEN: 'x' }, fetch: async () => { throw new Error('network down'); } });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].detail, /network down/);
});
