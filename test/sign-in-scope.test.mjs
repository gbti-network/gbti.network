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
import { readFileSync, existsSync } from 'node:fs';

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

test('the sign-in screen is sign-in only and promises no more than the sign-in asks for', () => {
  // sow-387 retired the toolbar setup page (onboarding.html and its card). The new-tab sign-in screen is now the only
  // place a member signs in to the extension, and it carries the reassurance the retired card did.
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const splash = read('client-ui/src/elements/gbti-signin-splash.mjs');
  // One action. No copy of the repository to make, no app to install, no GitHub settings page to open.
  assert.doesNotMatch(splash, /['"](fork|install)['"]/, 'the sign-in screen lists a fork or install step again');
  assert.doesNotMatch(splash, /data-open/, 'the sign-in screen sends the member to a GitHub page other than sign-in');
  assert.doesNotMatch(splash, /Make your copy|Give access|Install the GBTI app/);
  // What it tells the member matches the scope pinned above. It must not say the network writes to their copy.
  // sow-410: the note explaining GitHub's "Act on your behalf" wording went with the code sign-in, whose GitHub App
  // page was the only one that showed it; the profile-only sign-in claims nothing about access, so none is promised.
  assert.doesNotMatch(splash, /access to your repositories|Act on your behalf/);
  assert.doesNotMatch(splash, /to the copy you choose/);
  // And the retired page stays retired.
  for (const gone of ['extension/onboarding.html', 'extension/src/onboarding.mjs', 'client-ui/src/elements/gbti-onboarding.mjs']) {
    assert.equal(existsSync(new URL(`../${gone}`, import.meta.url)), false, `${gone} is back`);
  }
});
