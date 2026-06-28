// SOW-083 P2: the member earnings endpoint (GET /membership/earnings). Fake KV + injected authorize -> no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleEarnings, EARNINGS_KEY } from '../workers/signup/membership-earnings.mjs';

function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { m, async get(k, t) { const v = m.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); }, async put(k, v) { m.set(k, v); } };
}
const req = { method: 'GET', headers: { get: () => 'Bearer tok' } };
const asMember = (githubId) => async () => ({ ok: true, githubId });

test('returns the member\'s own earnings ledger from KV (its own payoutSetup wins over the default)', async () => {
  const ledger = { v: 1, recipient: '42', entries: [{ from: 'm1', role: 'first', amount: 4500, currency: 'usd', invoice: 'in_1', state: 'payable' }], totals: { held: 0, payable: 4500, paid: 0, lifetime: 4500 }, payoutSetup: { connected: true, ready: true } };
  const kv = fakeKv({ [EARNINGS_KEY('42')]: JSON.stringify(ledger) });
  const r = await handleEarnings(req, {}, { kv, authorize: asMember('42') });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, ledger);
  assert.deepEqual(r.body.payoutSetup, { connected: true, ready: true });
});

test('a member with no ledger yet gets an empty (zeroed) ledger with payoutSetup defaulted, not a 404', async () => {
  const r = await handleEarnings(req, {}, { kv: fakeKv(), authorize: asMember('99') });
  assert.equal(r.status, 200);
  assert.equal(r.body.recipient, '99');
  assert.deepEqual(r.body.entries, []);
  assert.deepEqual(r.body.totals, { held: 0, payable: 0, paid: 0, lifetime: 0 });
  assert.deepEqual(r.body.payoutSetup, { connected: false, ready: false }); // SOW-083 P3: prompt setup
});

test('a legacy ledger without payoutSetup gets the default injected', async () => {
  const kv = fakeKv({ [EARNINGS_KEY('7')]: JSON.stringify({ v: 1, recipient: '7', entries: [], totals: { held: 0, payable: 0, paid: 0, lifetime: 0 } }) });
  const r = await handleEarnings(req, {}, { kv, authorize: asMember('7') });
  assert.deepEqual(r.body.payoutSetup, { connected: false, ready: false });
});

test('a member only ever reads their OWN key (the authed github_id keys the read)', async () => {
  const kv = fakeKv({ [EARNINGS_KEY('42')]: JSON.stringify({ recipient: '42', secret: true }) });
  // authed as 99 -> reads earnings:99 (absent) -> empty, never 42's ledger
  const r = await handleEarnings(req, {}, { kv, authorize: asMember('99') });
  assert.equal(r.body.recipient, '99');
  assert.ok(!('secret' in r.body));
});

test('a denied caller (banned / unauthorized) is passed through, no KV read', async () => {
  const deny = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
  const r = await handleEarnings(req, {}, { kv: fakeKv(), authorize: deny });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: 'forbidden' });
});

test('no KV configured -> 500 misconfigured', async () => {
  const r = await handleEarnings(req, {}, { kv: null, authorize: asMember('42') });
  assert.equal(r.status, 500);
});
