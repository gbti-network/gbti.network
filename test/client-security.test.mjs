// SOW-006 always-on server hardening: unit tests for the security gate primitives.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateToken,
  safeEqual,
  bearerFrom,
  isAuthorized,
  isHostAllowed,
  hostnameOf,
  isOriginAllowed,
  requestAllowed,
} from '../client/src/security.mjs';

test('generateToken: hex string of the requested byte length', () => {
  const t = generateToken(32);
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.notEqual(generateToken(), generateToken());
});

test('safeEqual: true only on identical strings', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
});

test('bearerFrom: parses a Bearer header, else null', () => {
  assert.equal(bearerFrom('Bearer xyz'), 'xyz');
  assert.equal(bearerFrom('bearer  spaced '), 'spaced');
  assert.equal(bearerFrom('Basic xyz'), null);
  assert.equal(bearerFrom(undefined), null);
});

test('isAuthorized: requires the exact token; fails closed without a configured token', () => {
  assert.equal(isAuthorized({ authorization: 'Bearer good' }, 'good'), true);
  assert.equal(isAuthorized({ Authorization: 'Bearer good' }, 'good'), true);
  assert.equal(isAuthorized({ authorization: 'Bearer bad' }, 'good'), false);
  assert.equal(isAuthorized({}, 'good'), false);
  assert.equal(isAuthorized({ authorization: 'Bearer good' }, null), false);
});

test('hostnameOf + isHostAllowed: loopback only (anti DNS-rebinding)', () => {
  assert.equal(hostnameOf('127.0.0.1:4500'), '127.0.0.1');
  assert.equal(hostnameOf('localhost'), 'localhost');
  assert.equal(hostnameOf('[::1]:4500'), '[::1]');
  assert.equal(isHostAllowed('127.0.0.1:4500'), true);
  assert.equal(isHostAllowed('localhost:9999'), true);
  assert.equal(isHostAllowed('[::1]:4500'), true);
  assert.equal(isHostAllowed('evil.com'), false);
  assert.equal(isHostAllowed('evil.com:4500'), false);
  assert.equal(isHostAllowed(undefined), false);
});

test('isOriginAllowed: absent Origin ok (non-browser); present must be loopback', () => {
  assert.equal(isOriginAllowed(undefined), true);
  assert.equal(isOriginAllowed('http://localhost:4500'), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:7000'), true);
  assert.equal(isOriginAllowed('https://evil.com'), false);
  assert.equal(isOriginAllowed('not-a-url'), false);
});

test('requestAllowed: full gate, ordered host -> origin -> token', () => {
  const token = 'secret';
  const ok = requestAllowed({ headers: { host: '127.0.0.1:4500', authorization: 'Bearer secret' }, token });
  assert.deepEqual(ok, { ok: true });

  assert.equal(requestAllowed({ headers: { host: 'evil.com', authorization: 'Bearer secret' }, token }).reason, 'bad-host');
  assert.equal(requestAllowed({ headers: { host: '127.0.0.1', origin: 'https://evil.com', authorization: 'Bearer secret' }, token }).reason, 'bad-origin');
  assert.equal(requestAllowed({ headers: { host: '127.0.0.1' }, token }).reason, 'unauthorized');
});
