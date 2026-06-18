import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized } from '../src/auth.mjs';

const env = { NEWS_API_KEY: 'super-secret-token' };
const req = (auth) => new Request('https://x/feed', auth ? { headers: { Authorization: auth } } : undefined);

test('accepts the correct bearer token', async () => {
  assert.equal(await isAuthorized(req('Bearer super-secret-token'), env), true);
  assert.equal(await isAuthorized(req('bearer super-secret-token'), env), true); // scheme case-insensitive
});

test('rejects wrong, missing, and malformed tokens', async () => {
  assert.equal(await isAuthorized(req('Bearer wrong'), env), false);
  assert.equal(await isAuthorized(req('Bearer '), env), false);
  assert.equal(await isAuthorized(req('super-secret-token'), env), false); // no scheme
  assert.equal(await isAuthorized(req(), env), false); // no header
});

test('fails closed when no key is configured', async () => {
  assert.equal(await isAuthorized(req('Bearer anything'), {}), false);
  assert.equal(await isAuthorized(req('Bearer anything'), { NEWS_API_KEY: '' }), false);
});
