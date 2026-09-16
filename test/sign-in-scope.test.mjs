// sow-274 Part 4: SIGN-IN ASKS ONLY WHO YOU ARE.
//
// The command line tool and the agent server used to ask GitHub for `public_repo read:user`: write access to
// every public repository the member owns. They needed it only to publish from the member's own copy of the
// repository, and that path is gone. The literal is pinned here so any future widening shows up as a failing
// test and a visible diff, not as a quietly broader consent screen.
//
// Existing grants are deliberately left alone (owner, 2026-09-15: stop asking, do not force anyone out). This
// tests what a NEW sign-in requests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { activeScope, activeClientId, GITHUB_CLIENT_ID, AUTH_MODE } from '../client/src/signup-base.mjs';
import { requestDeviceCode } from '../client/src/auth-device.mjs';
import { cmdLogin } from '../client/src/cli-commands.mjs';

test('the command line tool and the agent server ask for identity only, exactly', () => {
  assert.equal(AUTH_MODE, 'classic', 'the node hosts sign in with the OAuth app by default');
  assert.equal(activeClientId(), GITHUB_CLIENT_ID);
  assert.equal(activeScope(), 'read:user');
});

test('no sign-in mode asks for any repository access', async () => {
  const prev = { mode: process.env.GBTI_AUTH_MODE, app: process.env.GBTI_GITHUB_APP_CLIENT_ID };
  try {
    for (const mode of ['classic', 'app', 'hosted']) {
      process.env.GBTI_AUTH_MODE = mode;
      process.env.GBTI_GITHUB_APP_CLIENT_ID = 'Iv1.testapp';
      const m = await import(`../client/src/signup-base.mjs?mode=${mode}`); // a fresh copy per mode
      assert.doesNotMatch(m.activeScope(), /repo/, `${mode} asks for repository access`);
      if (mode !== 'classic') {
        // The App client: scope is ignored by GitHub, so none is sent, and no install is requested anywhere.
        assert.equal(m.activeScope(), '');
        assert.equal(m.activeClientId(), 'Iv1.testapp');
      }
    }
  } finally {
    if (prev.mode === undefined) delete process.env.GBTI_AUTH_MODE; else process.env.GBTI_AUTH_MODE = prev.mode;
    if (prev.app === undefined) delete process.env.GBTI_GITHUB_APP_CLIENT_ID; else process.env.GBTI_GITHUB_APP_CLIENT_ID = prev.app;
  }
});

test('the device code request itself carries the identity scope, even when a caller passes none', async () => {
  const bodies = [];
  const fetch = async (url, init) => { bodies.push(new URLSearchParams(init.body)); return { ok: true, json: async () => ({ device_code: 'd' }) }; };
  await requestDeviceCode({ clientId: 'cid', fetch });
  assert.equal(bodies[0].get('scope'), 'read:user');
});

test('the command line login sends that scope to GitHub', async () => {
  let asked = null;
  const store = { data: {}, get(k) { return this.data[k]; }, set(p) { Object.assign(this.data, p); } };
  await cmdLogin({
    store,
    clientId: 'cid',
    deviceFlowLogin: async ({ scope }) => { asked = scope; return { accessToken: 'tok' }; },
    makeRepoClient: () => ({ getAuthUser: async () => ({ login: 'alice', id: '7' }) }),
    onPrompt: () => {},
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(asked, 'read:user');
});

test('every setup screen is sign-in only and promises no more than the sign-in asks for', () => {
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const card = read('client-ui/src/elements/gbti-onboarding.mjs');
  const page = read('extension/onboarding.html');
  // The card has one step. No copy of the repository to make, no app to install, no GitHub settings page to open.
  assert.doesNotMatch(card, /['"](fork|install)['"]/, 'the setup card lists a fork or install step again');
  assert.doesNotMatch(card, /data-open/, 'the setup card sends the member to a GitHub page other than sign-in');
  // What it tells the member matches the scope pinned above. It must not say the network writes to their copy.
  assert.match(card, /does not ask for access to your repositories/);
  assert.doesNotMatch(card, /to the copy you choose/);
  // The extension page lists exactly one step.
  assert.equal((page.match(/<span class="n">\d<\/span>/g) || []).length, 1, 'the setup page lists more than one step');
  assert.doesNotMatch(page, /Make your copy|Give access|Install the GBTI app/);
});
