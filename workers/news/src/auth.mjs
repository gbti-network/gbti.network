// Bearer API-key authentication. Every endpoint except /healthz requires
//   Authorization: Bearer <NEWS_API_KEY>
//
// We never compare the raw token with `===` (that leaks length/prefix via timing). Instead we compare
// SHA-256 digests of the presented and expected keys with a constant-time check: equal-length 32-byte
// digests, so neither length nor content timing reveals anything. crypto.subtle is available in the
// Workers runtime and in Node (used by the tests).

async function sha256Bytes(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return new Uint8Array(digest);
}

/** Constant-time byte-array equality (both inputs are fixed 32-byte SHA-256 digests). */
function constantTimeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * True iff the request carries a valid bearer token matching env.NEWS_API_KEY.
 * Fail closed: a missing header, malformed header, or unset NEWS_API_KEY all return false.
 */
export async function isAuthorized(request, env) {
  if (!env || !env.NEWS_API_KEY) return false; // no key configured -> deny everything
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const presented = match[1].trim();
  if (!presented) return false;
  const [a, b] = await Promise.all([sha256Bytes(presented), sha256Bytes(env.NEWS_API_KEY)]);
  return constantTimeEqual(a, b);
}
