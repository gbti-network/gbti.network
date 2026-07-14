// SOW-120: a pure OAuth 1.0a (RFC 5849) HMAC-SHA1 request signer for the X (Twitter) adapter. X's
// POST /2/tweets is authorized with an `Authorization: OAuth ...` header, NOT a bearer, when using the
// user-context OAuth 1.0a credential set (consumer key/secret + access token/secret). The tokens are
// long-lived, so this is the whole auth story: no refresh, no expiry, no stored rotating token.
//
// HMAC-SHA1 runs on WebCrypto (crypto.subtle), so this works unchanged in the Cloudflare Worker and in the
// node test suite. The nonce and timestamp are INJECTABLE so the signer is deterministic under test against
// the canonical X reference vector. No IO, no SDK.

const encoder = new TextEncoder();

/** Percent-encode per RFC 3986 (encodeURIComponent leaves !*'() unescaped; OAuth requires them escaped). */
export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** The signature base string: METHOD&percent(url)&percent(sorted, encoded param string). Pure. */
export function signatureBaseString(method, url, params) {
  // Encode every key + value, then sort the pairs by encoded key (ties by encoded value), per the spec.
  const pairs = Object.entries(params).map(([k, v]) => [percentEncode(k), percentEncode(v)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  return `${String(method).toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
}

/** The HMAC signing key: percent(consumerSecret)&percent(tokenSecret). Pure. */
export function signingKey(consumerSecret, tokenSecret) {
  return `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || '')}`;
}

async function hmacSha1Base64(keyStr, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(keyStr), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  let bin = '';
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin); // standard base64 (with padding), as OAuth 1.0a requires
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Build the `Authorization: OAuth ...` header value for a request. `params` are any additional request
 * parameters that participate in the signature (query params, or form fields); for POST /2/tweets the body
 * is JSON and contributes NO signature params, so `params` is empty. `nonce` and `timestamp` default to a
 * fresh random nonce and the current unix seconds, and are injectable for deterministic tests.
 */
export async function authHeader({ method, url, consumerKey, consumerSecret, token, tokenSecret, params = {}, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || randomNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const base = signatureBaseString(method, url, { ...params, ...oauth });
  const signature = await hmacSha1Base64(signingKey(consumerSecret, tokenSecret), base);
  const headerParams = { ...oauth, oauth_signature: signature };
  return 'OAuth ' + Object.keys(headerParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
    .join(', ');
}
