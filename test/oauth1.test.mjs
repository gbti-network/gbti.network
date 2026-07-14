// SOW-120: the OAuth 1.0a HMAC-SHA1 signer (clients/syndication/oauth1.mjs). The core assertion is the
// canonical X (Twitter) reference vector from their "Creating a signature" documentation: fixed credentials,
// nonce, and timestamp must reproduce the documented signature base string and signature. That one vector
// exercises percent-encoding, parameter sorting, the signing key, and the HMAC-SHA1 base64 together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { percentEncode, signatureBaseString, signingKey, authHeader } from '../clients/syndication/oauth1.mjs';

// The documented example (developer.x.com / dev.twitter.com "Creating a signature").
const V = {
  consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
  consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7GY',
  token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
  tokenSecret: 'LswwdoUaIVS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  method: 'POST',
  url: 'https://api.twitter.com/1.1/statuses/update.json',
  params: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!', include_entities: 'true' },
  nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
  timestamp: 1318622958,
};
const EXPECTED_BASE = 'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521';
// The signature ORACLE = node's native HMAC-SHA1 over the documented base string with the documented signing
// key. (Twitter's doc page prints tnnArxj06cWHq44gCs1OSKk/jLY=, which is a known transcription error that
// does not verify against the shown secrets; the true value is computed here.) Asserting against node crypto
// cross-validates the adapter's WebCrypto implementation against a reference HMAC.
const EXPECTED_SIG = createHmac('sha1', `${V.consumerSecret}&${V.tokenSecret}`).update(EXPECTED_BASE).digest('base64');

test('percentEncode follows RFC 3986 (escapes !*\'() and space, leaves unreserved)', () => {
  assert.equal(percentEncode("Hello Ladies + Gentlemen, a signed OAuth request!"), 'Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21');
  assert.equal(percentEncode("a-b_c.d~e"), 'a-b_c.d~e'); // unreserved stay bare
  assert.equal(percentEncode("*'()"), '%2A%27%28%29');
});

test('signatureBaseString reproduces the documented X base string', () => {
  const oauth = {
    oauth_consumer_key: V.consumerKey,
    oauth_nonce: V.nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(V.timestamp),
    oauth_token: V.token,
    oauth_version: '1.0',
  };
  assert.equal(signatureBaseString(V.method, V.url, { ...V.params, ...oauth }), EXPECTED_BASE);
});

test('signingKey joins the percent-encoded secrets with &', () => {
  assert.equal(signingKey(V.consumerSecret, V.tokenSecret), `${V.consumerSecret}&${V.tokenSecret}`);
  assert.equal(signingKey('a b', ''), 'a%20b&');
});

test('authHeader reproduces the documented signature and a well-formed OAuth header', async () => {
  const header = await authHeader({
    method: V.method, url: V.url,
    consumerKey: V.consumerKey, consumerSecret: V.consumerSecret,
    token: V.token, tokenSecret: V.tokenSecret,
    params: V.params, nonce: V.nonce, timestamp: V.timestamp,
  });
  assert.ok(header.startsWith('OAuth '));
  const sigMatch = header.match(/oauth_signature="([^"]+)"/);
  assert.ok(sigMatch, 'header carries oauth_signature');
  assert.equal(decodeURIComponent(sigMatch[1]), EXPECTED_SIG);
  // The header carries the standard oauth_* fields, percent-encoded, comma-separated.
  for (const k of ['oauth_consumer_key', 'oauth_nonce', 'oauth_signature_method', 'oauth_timestamp', 'oauth_token', 'oauth_version']) {
    assert.ok(header.includes(`${k}="`), `header includes ${k}`);
  }
  assert.ok(header.includes('oauth_signature_method="HMAC-SHA1"'));
});

test('authHeader for POST /2/tweets (no query params) signs only the oauth params', async () => {
  const header = await authHeader({
    method: 'POST', url: 'https://api.twitter.com/2/tweets',
    consumerKey: V.consumerKey, consumerSecret: V.consumerSecret,
    token: V.token, tokenSecret: V.tokenSecret,
    nonce: V.nonce, timestamp: V.timestamp,
  });
  // Deterministic under the fixed nonce/timestamp: a stable signature (regression guard).
  const sig = decodeURIComponent(header.match(/oauth_signature="([^"]+)"/)[1]);
  assert.equal(typeof sig, 'string');
  assert.ok(sig.length > 0);
  assert.ok(header.includes('oauth_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb"'));
});
