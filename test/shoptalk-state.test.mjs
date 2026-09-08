// sow-314: the sweep's shared state, and specifically that "I could not look" never answers "nothing there".
//
// Both underlying KV helpers collapse a missing credential into an empty answer, and an empty answer here
// causes real harm: an unreadable opt-out list re-invites people who declined, and an unreadable placed
// record, once written back, permanently forgets every address the sweep owns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlaced, writePlaced, readOptedOut, PLACED_KEY, OPTOUT_PREFIX } from '../scripts/lib/shoptalk-state.mjs';

const CREDS = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };
const okRes = (body) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });

test('NO CREDENTIALS is a refusal, not an empty placed record', async () => {
  const r = await readPlaced({ env: {}, fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.equal(r.ok, false);
  assert.equal(r.placed, undefined, 'there must be no Map to accidentally write back');
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

test('NO CREDENTIALS is a refusal, not an empty opt-out set', async () => {
  // The dangerous one: an empty set means "nobody opted out", so the sweep re-invites everyone who declined.
  const r = await readOptedOut({ env: {}, fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.equal(r.ok, false);
  assert.equal(r.optedOut, undefined);
});

test('an ABSENT placed document is a valid cold start, distinct from a failure', async () => {
  const r = await readPlaced({ env: CREDS, fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(r.ok, true);
  assert.equal(r.placed.size, 0);
});

test('a CORRUPT placed document refuses rather than silently resetting to empty', async () => {
  for (const body of ['not json', '[1,2,3]', '"a string"']) {
    const r = await readPlaced({ env: CREDS, fetchImpl: async () => okRes(body) });
    assert.equal(r.ok, false, `${body} must refuse`);
    assert.match(r.reason, /refusing to overwrite/);
  }
});

test('a good placed document parses, lowercased and stringified', async () => {
  const r = await readPlaced({ env: CREDS, fetchImpl: async () => okRes(JSON.stringify({ 'A@X.com': 7, 'b@x.com': '8' })) });
  assert.equal(r.ok, true);
  assert.deepEqual([...r.placed.entries()], [['a@x.com', '7'], ['b@x.com', '8']]);
});

test('opt-out keys become github ids, and unrelated keys are ignored', async () => {
  const fetchImpl = async () => okRes(JSON.stringify({
    result: [{ name: `${OPTOUT_PREFIX}11` }, { name: `${OPTOUT_PREFIX}22` }, { name: 'prefs:99' }, { name: OPTOUT_PREFIX }],
    result_info: {},
  }));
  const r = await readOptedOut({ env: CREDS, fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual([...r.optedOut].sort(), ['11', '22'], 'a bare prefix with no id must not become an entry');
});

test('a FAILED listing page throws rather than returning a short list', async () => {
  // A short list reads as a short keyspace, which is the whole reason listKvByPrefix is fail-closed. This
  // pins that the wrapper does not soften it.
  await assert.rejects(
    () => readOptedOut({ env: CREDS, fetchImpl: async () => ({ ok: false, status: 500 }) }),
    /KV key list failed/,
  );
});

test('writePlaced serializes sorted, so an unchanged run is byte identical', async () => {
  let sent = null;
  const fetchImpl = async (_u, init) => { sent = init.body; return { ok: true, status: 200 }; };
  const m = new Map([['z@x.com', '2'], ['a@x.com', '1']]);
  await writePlaced(m, { env: CREDS, fetchImpl });
  assert.equal(sent, '{"a@x.com":"1","z@x.com":"2"}');
  let sent2 = null;
  await writePlaced(new Map([['a@x.com', '1'], ['z@x.com', '2']]), { env: CREDS, fetchImpl: async (_u, i) => { sent2 = i.body; return { ok: true, status: 200 }; } });
  assert.equal(sent, sent2, 'insertion order must not change the document');
});

test('writePlaced targets the one stable key', async () => {
  let url = null;
  await writePlaced(new Map(), { env: CREDS, fetchImpl: async (u) => { url = String(u); return { ok: true, status: 200 }; } });
  assert.ok(url.includes(encodeURIComponent(PLACED_KEY)), 'the document key must be shoptalk:placed');
});
