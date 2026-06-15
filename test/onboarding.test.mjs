// SOW-026: the pure onboarding readiness core + the auth-mode config indirection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextStep, isReady, deviceVerificationUrl, forkUrl, appInstallUrl, manageInstallsUrl, forkFullName, STEPS, STEP_ORDER,
} from '../client/src/onboarding.mjs';
import { activeClientId, activeScope, isAppMode, GITHUB_CLIENT_ID } from '../client/src/signup-base.mjs';

test('nextStep: first-false of [signin, fork, install]', () => {
  assert.equal(nextStep({}), 'signin');
  assert.equal(nextStep({ signedIn: true }), 'fork');
  assert.equal(nextStep({ signedIn: true, forkReady: true }), 'install');
  assert.equal(nextStep({ signedIn: true, forkReady: true, installReady: true }), 'ready');
  // a later fact false re-opens exactly that step, others stay (ordering enforced by first-false)
  assert.equal(nextStep({ signedIn: false, forkReady: true, installReady: true }), 'signin');
});

test('isReady only when all three durable facts hold', () => {
  assert.equal(isReady({ signedIn: true, forkReady: true, installReady: true }), true);
  assert.equal(isReady({ signedIn: true, forkReady: true, installReady: false }), false);
});

test('deep links target the GitHub-hosted pages', () => {
  assert.equal(deviceVerificationUrl(), 'https://github.com/login/device');
  assert.equal(forkUrl(), 'https://github.com/gbti-network/gbti.network/fork');
  assert.equal(manageInstallsUrl(), 'https://github.com/settings/installations');
  assert.match(appInstallUrl(), /\/apps\/gbti-network\/installations\/new$/);
  assert.match(appInstallUrl({ targetId: 4242 }), /installations\/new\/permissions\?suggested_target_id=4242$/);
});

test('forkFullName lowercases the login + uses the upstream repo name', () => {
  assert.equal(forkFullName('AtwellPub'), 'atwellpub/gbti.network');
});

test('STEPS cover the three ordered steps with jargon-free copy', () => {
  assert.deepEqual(STEP_ORDER, ['signin', 'fork', 'install']);
  for (const id of STEP_ORDER) {
    assert.equal(STEPS[id].id, id);
    for (const k of ['title', 'why', 'preview', 'button', 'doneLabel']) assert.ok(STEPS[id][k], `${id}.${k}`);
  }
  // jargon check: the member-facing fork step does not say "fork"
  assert.doesNotMatch(STEPS.fork.title, /fork/i);
});

test('auth mode: classic is the default (account-wide), and the helpers reflect it', () => {
  assert.equal(isAppMode(), false);
  assert.equal(activeClientId(), GITHUB_CLIENT_ID);
  assert.equal(activeScope(), 'public_repo read:user');
});

test('auth mode: app-mode flips the client id + drops the scope (cache-busted re-import)', async () => {
  const prev = process.env.GBTI_AUTH_MODE;
  process.env.GBTI_AUTH_MODE = 'app';
  process.env.GBTI_GITHUB_APP_CLIENT_ID = 'Iv1.testapp';
  try {
    const m = await import('../client/src/signup-base.mjs?appmode');
    assert.equal(m.isAppMode(), true);
    assert.equal(m.activeClientId(), 'Iv1.testapp');
    assert.equal(m.activeScope(), '', 'GitHub Apps ignore scope, so app-mode sends none');
  } finally {
    if (prev === undefined) delete process.env.GBTI_AUTH_MODE; else process.env.GBTI_AUTH_MODE = prev;
  }
});
