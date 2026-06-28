// SOW-083 P2: the client earnings transport (GET /membership/earnings). Fake fetch -> no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEarnings, EarningsClientError } from '../client/src/member-earnings-client.mjs';

test('getEarnings GETs /membership/earnings with the bearer token and returns the ledger', async () => {
  let captured = null;
  const fetch = async (url, opts) => { captured = { url, opts }; return { ok: true, async json() { return { v: 1, recipient: '42', entries: [], totals: { held: 0, payable: 0, paid: 0, lifetime: 0 } }; } }; };
  const r = await getEarnings({ token: 'tok', signupBase: 'https://signup.gbti.network/', fetch });
  assert.equal(captured.url, 'https://signup.gbti.network/membership/earnings'); // trailing slash trimmed
  assert.equal(captured.opts.headers.Authorization, 'Bearer tok');
  assert.equal(r.recipient, '42');
});

test('getEarnings throws when not signed in (no token / no base)', async () => {
  await assert.rejects(() => getEarnings({ token: '', signupBase: 'x', fetch: async () => ({}) }), EarningsClientError);
  await assert.rejects(() => getEarnings({ token: 't', signupBase: '', fetch: async () => ({}) }), EarningsClientError);
});

test('getEarnings surfaces a friendly error on a non-ok response', async () => {
  const fetch = async () => ({ ok: false, status: 403, async json() { return { error: 'forbidden' }; } });
  await assert.rejects(() => getEarnings({ token: 't', signupBase: 'x', fetch }), /forbidden/);
});
