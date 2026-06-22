// SOW: the background's proactive token-refresh decision + store patch (pure helpers). GitHub App user tokens
// expire ~8h; the background refreshes the access token from the rotating refresh token BEFORE it dies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsRefresh, refreshPatch } from '../extension/src/token-refresh.mjs';

const T = 1_000_000_000_000; // a fixed "now"

test('needsRefresh: true at/within skew of expiry, false while comfortably valid', () => {
  const base = { githubToken: 'a', githubRefreshToken: 'r' };
  assert.equal(needsRefresh({ ...base, githubTokenExpiresAt: T + 5 * 60_000 }, T), false, 'valid 5 min out');
  assert.equal(needsRefresh({ ...base, githubTokenExpiresAt: T + 30_000 }, T), true, 'within the 60s skew');
  assert.equal(needsRefresh({ ...base, githubTokenExpiresAt: T - 1 }, T), true, 'already expired');
});

test('needsRefresh: false without the pieces to refresh (no token / no refresh token / no expiry)', () => {
  assert.equal(needsRefresh({ githubRefreshToken: 'r', githubTokenExpiresAt: T - 1 }, T), false, 'no access token');
  assert.equal(needsRefresh({ githubToken: 'a', githubTokenExpiresAt: T - 1 }, T), false, 'no refresh token (pre-refresh / classic session)');
  assert.equal(needsRefresh({ githubToken: 'a', githubRefreshToken: 'r' }, T), false, 'no known expiry');
  assert.equal(needsRefresh({}, T), false);
});

test('refreshPatch: maps a Worker response to the store patch, rotating the refresh token', () => {
  const p = refreshPatch({ access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800 }, 'ghr_old', T);
  assert.deepEqual(p, { githubToken: 'gho_new', githubRefreshToken: 'ghr_new', githubTokenExpiresAt: T + 28800 * 1000 });
});

test('refreshPatch: keeps the old refresh token when GitHub omits a new one; null on an unusable response', () => {
  const p = refreshPatch({ access_token: 'gho_new', expires_in: 100 }, 'ghr_old', T);
  assert.equal(p.githubRefreshToken, 'ghr_old');
  assert.equal(refreshPatch({ error: 'bad' }, 'ghr_old', T), null);
  assert.equal(refreshPatch(null, 'ghr_old', T), null);
});
