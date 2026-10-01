// sow-427 B1: a GitHub login to the immutable account number, as the prepared-listing binding stores it. No
// network: fetch and the App token are fakes, and every test says which URL it expected to be asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { githubUserByLogin, githubUserById } from '../workers/signup/github-user-lookup.mjs';

const user = (over = {}) => ({ id: 5551234, login: 'Sam-Dev', type: 'User', name: 'Sam Rivera', ...over });

/** A fetch that answers one URL and records every call, so a test can assert what was (or was not) asked. */
function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    return typeof answer === 'function' ? answer(String(url)) : answer;
  };
  fn.calls = calls;
  return fn;
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (n) => ({ ok: false, status: n, json: async () => ({ message: 'nope' }) });
const token = async () => 'inst-token';

test('a known login resolves to the account number, GitHub casing and display name, with the App token', async () => {
  const fetchImpl = fakeFetch(ok(user()));
  const r = await githubUserByLogin({}, ' @sam-dev ', { fetchImpl, getToken: token });
  assert.deepEqual(r, { ok: true, githubId: '5551234', login: 'Sam-Dev', name: 'Sam Rivera' });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, 'https://api.github.com/users/sam-dev', 'the @ and the spaces are stripped before asking');
  assert.equal(fetchImpl.calls[0].headers.Authorization, 'Bearer inst-token', 'an unauthenticated call is 60 an hour for the whole Worker');
});

test('a 404 maps to unknown_github_login', async () => {
  const r = await githubUserByLogin({}, 'nobody-here', { fetchImpl: fakeFetch(status(404)), getToken: token });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(r.error, 'unknown_github_login');
  assert.match(r.message, /No personal GitHub account/);
});

test('an organization or a bot is reported as unknown: only a personal account can sign in to claim', async () => {
  for (const type of ['Organization', 'Bot', undefined]) {
    const r = await githubUserByLogin({}, 'acme', { fetchImpl: fakeFetch(ok(user({ type }))), getToken: token });
    assert.equal(r.error, 'unknown_github_login', `type ${type}`);
  }
});

test('a malformed login is refused WITHOUT a request', async () => {
  const fetchImpl = fakeFetch(ok(user()));
  for (const bad of ['', '   ', '-sam', 'sam-', 'sa--m', 'sam dev', 'a'.repeat(40), 'sam/../x', null, 42]) {
    const r = await githubUserByLogin({}, bad, { fetchImpl, getToken: token });
    assert.equal(r.error, 'bad_github_login', JSON.stringify(bad));
    assert.equal(r.status, 400);
  }
  assert.equal(fetchImpl.calls.length, 0, 'nothing is sent for a value that cannot be a login');
});

test('rate limits, server errors, a thrown fetch and a body without an id all fail as lookup_failed', async () => {
  const cases = [status(403), status(429), status(500), null, ok({ login: 'Sam-Dev', type: 'User' }), ok(user({ id: -3 })), ok(user({ login: '' }))];
  for (const c of cases) {
    const fetchImpl = fakeFetch(() => { if (c === null) throw new Error('network down'); return c; });
    const r = await githubUserByLogin({}, 'sam-dev', { fetchImpl, getToken: token });
    assert.equal(r.ok, false);
    assert.equal(r.status, 502, JSON.stringify(c));
    assert.equal(r.error, 'lookup_failed');
  }
});

test('an App that is not configured still answers, anonymously, rather than failing the binding', async () => {
  const fetchImpl = fakeFetch(ok(user()));
  const r = await githubUserByLogin({}, 'sam-dev', { fetchImpl, getToken: async () => { throw new Error('not configured'); } });
  assert.equal(r.ok, true);
  assert.equal(fetchImpl.calls[0].headers.Authorization, undefined);
});

test('githubUserById reads by account number, which never changes hands', async () => {
  const fetchImpl = fakeFetch(ok(user()));
  const r = await githubUserById({}, '5551234', { fetchImpl, getToken: token });
  assert.deepEqual(r, { ok: true, githubId: '5551234', login: 'Sam-Dev', name: 'Sam Rivera' });
  assert.equal(fetchImpl.calls[0].url, 'https://api.github.com/user/5551234');
  const none = await githubUserById({}, 'sam', { fetchImpl, getToken: token });
  assert.equal(none.error, 'bad_github_login');
  assert.equal(fetchImpl.calls.length, 1, 'a non-number is refused without a request');
});

test('an empty display name reads as null, so the claim falls back to the folder rather than a blank', async () => {
  const r = await githubUserByLogin({}, 'sam-dev', { fetchImpl: fakeFetch(ok(user({ name: '   ' }))), getToken: token });
  assert.equal(r.name, null);
});
