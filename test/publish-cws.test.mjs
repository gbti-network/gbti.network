// SOW-133: the Chrome Web Store publish flow (token exchange -> upload -> publish) with an injected fetch, and the
// clean skip when credentials are unset (so CI never hard-fails). Reads the real committed package from disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../scripts/publish-cws.mjs';

const CREDS = { CWS_CLIENT_ID: 'id', CWS_CLIENT_SECRET: 'sec', CWS_REFRESH_TOKEN: 'ref' };
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

function fakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts?.method });
    for (const [re, resp] of handlers) if (re.test(url)) return resp;
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, calls };
}

test('publish-cws skips cleanly (no network) when credentials are unset', async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  const r = await main({ env: {}, fetchImpl });
  assert.equal(r.skipped, true);
  assert.equal(calls.length, 0);
});

test('publish-cws --check exchanges the token and stops (no upload or publish)', async () => {
  const { fetchImpl, calls } = fakeFetch([[/oauth2\.googleapis/, json(200, { access_token: 'tok' })]]);
  const r = await main({ env: CREDS, fetchImpl, checkOnly: true });
  assert.equal(r.checked, true);
  assert.equal(calls.length, 1);
});

test('publish-cws uploads then publishes with a valid token', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    [/upload\/chromewebstore/, json(200, { uploadState: 'SUCCESS' })],
    [/items\/[^/]+\/publish/, json(200, { status: ['OK'] })],
  ]);
  const r = await main({ env: CREDS, fetchImpl });
  assert.equal(r.published, true);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'PUT', 'POST']); // token, upload, publish
});

test('publish-cws --upload-only uploads but does not publish', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    [/upload\/chromewebstore/, json(200, { uploadState: 'SUCCESS' })],
  ]);
  const r = await main({ env: CREDS, fetchImpl, uploadOnly: true });
  assert.equal(r.uploaded, true);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'PUT']);
});

test('publish-cws throws a clear error on an upload failure', async () => {
  const { fetchImpl } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    [/upload\/chromewebstore/, json(200, { uploadState: 'FAILURE', itemError: [{ error_detail: 'bad zip' }] })],
  ]);
  await assert.rejects(() => main({ env: CREDS, fetchImpl }), /upload failed: bad zip/);
});

test('publish-cws throws when the OAuth token exchange fails', async () => {
  const { fetchImpl } = fakeFetch([[/oauth2\.googleapis/, json(400, { error: 'invalid_grant', error_description: 'expired' })]]);
  await assert.rejects(() => main({ env: CREDS, fetchImpl }), /token exchange failed/);
});
