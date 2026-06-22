// SOW-057: the OG-preview Worker handler. Auth, SSRF deny-list (rejects BEFORE fetching), bounded fetch,
// never-500 behavior. Fake fetch + fake token verifier; no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleOgPreview, safeFetchTarget } from '../workers/signup/membership-og.mjs';

function req(body, { token = 'tok', method = 'POST' } = {}) {
  return {
    method,
    headers: { get: (h) => (h === 'Authorization' && token ? `Bearer ${token}` : null) },
    async json() { return body; },
  };
}
const fetchUser = async () => ({ githubId: '42', githubLogin: 'me' });

test('safeFetchTarget blocks loopback, private, link-local, metadata, credentials, and non-http', () => {
  assert.equal(safeFetchTarget('http://localhost/x').ok, false);
  assert.equal(safeFetchTarget('http://127.0.0.1/x').ok, false);
  assert.equal(safeFetchTarget('http://10.0.0.5/x').ok, false);
  assert.equal(safeFetchTarget('http://192.168.1.1/x').ok, false);
  assert.equal(safeFetchTarget('http://169.254.169.254/latest/meta-data/').ok, false); // cloud metadata
  assert.equal(safeFetchTarget('http://metadata.google.internal/').ok, false);
  assert.equal(safeFetchTarget('http://[::1]/x').ok, false);
  assert.equal(safeFetchTarget('ftp://ex.com/x').ok, false);
  assert.equal(safeFetchTarget('https://user:pass@ex.com/x').ok, false);
  assert.equal(safeFetchTarget('not a url').ok, false);
  // a normal public URL passes
  const ok = safeFetchTarget('https://example.com/article');
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://example.com/article');
});

test('handler: 401 without a token, 401 when the token has no user id', async () => {
  const noTok = await handleOgPreview(req({ url: 'https://ex.com' }, { token: '' }), {}, { fetchImpl: async () => { throw new Error('nope'); }, fetchUser });
  assert.equal(noTok.status, 401);
  const badUser = await handleOgPreview(req({ url: 'https://ex.com' }), {}, { fetchImpl: async () => ({}), fetchUser: async () => ({}) });
  assert.equal(badUser.status, 401);
});

test('handler: an SSRF target is rejected with 400 and the page is NEVER fetched', async () => {
  let fetched = false;
  const r = await handleOgPreview(req({ url: 'http://169.254.169.254/' }), {}, {
    fetchImpl: async () => { fetched = true; return { ok: true }; },
    fetchUser,
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid_url');
  assert.equal(fetched, false);
});

test('handler: a 200 HTML page returns the scraped preview', async () => {
  const html = '<head><meta property="og:image" content="https://cdn.ex.com/og.jpg"><meta property="og:title" content="Hi"></head>';
  const fetchImpl = async () => ({ ok: true, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => html });
  const r = await handleOgPreview(req({ url: 'https://ex.com/a' }), {}, { fetchImpl, fetchUser });
  assert.equal(r.status, 200);
  assert.equal(r.body.image, 'https://cdn.ex.com/og.jpg');
  assert.equal(r.body.title, 'Hi');
});

test('handler: a non-HTML content type returns a clean empty preview (no scrape, no 500)', async () => {
  const fetchImpl = async () => ({ ok: true, headers: { get: () => 'application/pdf' }, text: async () => '%PDF' });
  const r = await handleOgPreview(req({ url: 'https://ex.com/file.pdf' }), {}, { fetchImpl, fetchUser });
  assert.equal(r.status, 200);
  assert.equal(r.body.image, null);
});

test('handler: a fetch error returns ok:true image:null (never throws a 500)', async () => {
  const fetchImpl = async () => { throw new Error('network'); };
  const r = await handleOgPreview(req({ url: 'https://ex.com/a' }), {}, { fetchImpl, fetchUser });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.image, null);
});

test('handler: a missing url is a 400', async () => {
  const r = await handleOgPreview(req({}), {}, { fetchImpl: async () => ({}), fetchUser });
  assert.equal(r.status, 400);
});
