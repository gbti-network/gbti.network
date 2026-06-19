// SOW-048: the extension's forced-sign-in gate decision. The shell renders the <gbti-welcome> login splash unless
// the caller is signed in (has a GitHub token AND a github login). This is an AUTHENTICATION gate, not a paid one
// (membership gating stays inside the app). shouldGate is the pure decision; the rest of the shell is DOM-coupled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldGate } from '../extension/src/shell.mjs';

test('shouldGate: a signed-in caller (token + github login) is NOT gated', () => {
  assert.equal(shouldGate({ authenticated: true, identity: { login: 'alice' } }), false);
});

test('shouldGate: signed-out / malformed status IS gated', () => {
  assert.equal(shouldGate(null), true);
  assert.equal(shouldGate(undefined), true);
  assert.equal(shouldGate({}), true);
  assert.equal(shouldGate({ authenticated: false }), true);
  assert.equal(shouldGate({ authenticated: true }), true); // token but no github login
  assert.equal(shouldGate({ authenticated: false, identity: { login: 'x' } }), true); // login but no token
});

test('shouldGate is AUTH, not membership — any membership tier passes once signed in', () => {
  for (const membership of ['none', 'trialing', 'paid', 'expired', 'banned']) {
    assert.equal(shouldGate({ authenticated: true, identity: { login: 'a' }, membership }), false, membership);
  }
});
