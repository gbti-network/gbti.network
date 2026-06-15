// Abuse controls for the signup Worker: Cloudflare Turnstile verification and a simple per-IP
// rate limit backed by a KV namespace. Signup MUST call both before touching OAuth, Stripe, or
// Discord, so bots and floods are stopped at the door. Both helpers fail closed: a Turnstile error
// is treated as a failed challenge, and a rate-limit store error is treated as over-limit.

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Cloudflare Turnstile token against siteverify. Returns true only when Cloudflare reports
 * success. Any network error, non-2xx response, or success:false returns false (fail closed).
 *
 * @param {object} a
 * @param {string} a.token      the cf-turnstile-response token from the client.
 * @param {string} a.secret     TURNSTILE_SECRET_KEY.
 * @param {string} [a.remoteIp] the connecting IP (CF-Connecting-IP), optional but recommended.
 * @param {typeof fetch} [fetchImpl]
 */
export async function verifyTurnstile({ token, secret, remoteIp }, fetchImpl = globalThis.fetch) {
  if (!token || !secret) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  let data;
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) return false;
    data = JSON.parse(await res.text());
  } catch {
    return false; // fail closed
  }
  return data?.success === true;
}

/**
 * Per-IP fixed-window rate limit backed by a KV namespace (injectable). Returns
 * { allowed:boolean, count:number, limit:number }. On any KV error it returns allowed:false so a
 * broken store cannot become an open door.
 *
 * The KV value is a small JSON record { count, windowStart }. We reset the window when it has aged
 * past windowSeconds. KV is eventually consistent across edge locations, so this is a coarse limiter
 * (good enough to blunt floods); strong limits belong to Cloudflare's own WAF rate-limiting rules.
 *
 * @param {object} a
 * @param {object} a.kv               KV namespace: get(key,{type}) and put(key,value,{expirationTtl}).
 * @param {string} a.ip               the connecting IP (CF-Connecting-IP).
 * @param {number} [a.limit]          max requests per window (default 5).
 * @param {number} [a.windowSeconds]  window length in seconds (default 600 = 10 minutes).
 * @param {string} [a.prefix]         KV key prefix (default 'rl:signup:').
 * @param {number} [a.now]            epoch ms, for tests.
 */
export async function rateLimit({ kv, ip, limit = 5, windowSeconds = 600, prefix = 'rl:signup:', now = Date.now() }) {
  if (!kv || !ip) return { allowed: false, count: 0, limit };
  const key = `${prefix}${ip}`;
  const nowSec = Math.floor(now / 1000);
  let record;
  try {
    record = await kv.get(key, { type: 'json' });
  } catch {
    return { allowed: false, count: 0, limit }; // fail closed
  }
  let count = 1;
  let windowStart = nowSec;
  if (record && typeof record.windowStart === 'number' && nowSec - record.windowStart < windowSeconds) {
    count = (record.count ?? 0) + 1;
    windowStart = record.windowStart;
  }
  try {
    await kv.put(key, JSON.stringify({ count, windowStart }), { expirationTtl: windowSeconds });
  } catch {
    return { allowed: false, count, limit }; // fail closed
  }
  return { allowed: count <= limit, count, limit };
}
