// SOW-006 GitHub device-flow auth: unit tests with an injected fetch + sleep (no network).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deviceFlowLogin } from '../client/src/auth-device.mjs';

function fakeFetch(pollResponses) {
  let poll = 0;
  return async (url) => {
    if (String(url).endsWith('/login/device/code')) {
      return {
        ok: true,
        json: async () => ({
          device_code: 'dc-123',
          user_code: 'WXYZ-1234',
          verification_uri: 'https://github.com/login/device',
          interval: 0,
          expires_in: 900,
        }),
      };
    }
    const r = pollResponses[Math.min(poll, pollResponses.length - 1)];
    poll++;
    return { ok: true, json: async () => r };
  };
}

const noSleep = async () => {};

test('deviceFlowLogin: prompts, polls past pending, returns the token', async () => {
  let prompted = null;
  const out = await deviceFlowLogin({
    clientId: 'Iv1.abc',
    fetch: fakeFetch([{ error: 'authorization_pending' }, { access_token: 'gho_x', scope: 'repo' }]),
    sleep: noSleep,
    now: () => 1000,
    onPrompt: (p) => { prompted = p; },
  });
  assert.equal(out.accessToken, 'gho_x');
  assert.equal(out.scope, 'repo');
  assert.equal(prompted.userCode, 'WXYZ-1234');
  assert.equal(prompted.verificationUri, 'https://github.com/login/device');
});

test('deviceFlowLogin: slow_down is tolerated and still completes', async () => {
  const out = await deviceFlowLogin({
    clientId: 'Iv1.abc',
    fetch: fakeFetch([{ error: 'slow_down' }, { access_token: 'gho_y' }]),
    sleep: noSleep,
    now: () => 1000,
  });
  assert.equal(out.accessToken, 'gho_y');
});

test('deviceFlowLogin: user denial throws', async () => {
  await assert.rejects(
    deviceFlowLogin({ clientId: 'Iv1.abc', fetch: fakeFetch([{ error: 'access_denied' }]), sleep: noSleep, now: () => 1000 }),
    /denied/,
  );
});

test('deviceFlowLogin: expiry throws once the deadline passes', async () => {
  let t = 0;
  await assert.rejects(
    deviceFlowLogin({
      clientId: 'Iv1.abc',
      fetch: fakeFetch([{ error: 'authorization_pending' }]),
      sleep: noSleep,
      now: () => (t += 1_000_000), // jumps past the 900s deadline on the first loop check
    }),
    /expired/,
  );
});
