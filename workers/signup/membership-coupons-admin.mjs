// SOW-119: admin-gated coupon USAGE + invite-link management. The coupon CONFIG is git-native
// (house/coupons.yml via the admin house-PR flow); this module serves the KV-side runtime state the git
// file cannot: per-code redemption counts + records, and the shareable invite-link token (minted and
// rotated here; the public /membership/coupon-link resolver reads what this writes). authorizeAdmin runs
// FIRST on every handler (token -> github_id -> role from the fresh KV overrides mirror, fail closed).
//
// KV keys:
//   redemption:<CODE>:<githubId>   a redemption record (written at signup)
//   redemptions:<CODE>             the per-code counter
//   coupon-link:<token>            token -> code (the public resolver's key)
//   coupon-link-for:<CODE>         code -> its CURRENT token (so rotate can kill the old link)

import { authorizeAdmin } from './membership-admin.mjs';
import { readCouponsConfig } from './coupons.mjs';
import { redemptionCountKey, couponLinkKey, normalizeCouponCode, COUPON_CODE_RE } from '../../membership/coupons.mjs';

const linkForKey = (code) => `coupon-link-for:${normalizeCouponCode(code)}`;

/** GET /membership/admin/coupon-usage -> { ok, usage: { CODE: { count, max, redemptions: [...] } }, links: { CODE: token } } */
export async function membershipCouponUsage(request, env, { authorize = authorizeAdmin, now = new Date(), ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env.SIGNUP_KV;

  const config = await readCouponsConfig(kv, now);
  const codes = (config?.coupons ?? []).map((c) => c.code);
  const usage = {};
  const links = {};

  // Redemption records: one list sweep over the redemption: prefix (complete + cheap at this scale).
  const byCode = new Map();
  let cursor;
  do {
    const page = await kv.list({ prefix: 'redemption:', cursor });
    for (const k of page.keys ?? []) {
      const m = /^redemption:([A-Z0-9]{3,32}):(\d+)$/.exec(k.name);
      if (!m) continue;
      if (!byCode.has(m[1])) byCode.set(m[1], []);
      byCode.get(m[1]).push(k.name);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const allCodes = [...new Set([...codes, ...byCode.keys()])];
  for (const code of allCodes) {
    const coupon = (config?.coupons ?? []).find((c) => c.code === code) || null;
    const redemptions = [];
    for (const name of byCode.get(code) ?? []) {
      try {
        const rec = await kv.get(name, 'json');
        if (rec) redemptions.push({ githubId: name.split(':')[2], login: rec.login ?? null, redeemedAt: rec.redeemedAt ?? null, until: rec.until ?? null });
      } catch { /* one bad record never hides the rest */ }
    }
    redemptions.sort((a, b) => String(b.redeemedAt).localeCompare(String(a.redeemedAt)));
    const count = Number(await kv.get(redemptionCountKey(code))) || redemptions.length;
    usage[code] = { count, max: coupon?.maxRedemptions ?? null, active: coupon?.active ?? null, freeDays: coupon?.freeDays ?? null, redemptions };
    const token = await kv.get(linkForKey(code));
    if (token) links[code] = token;
  }

  return { status: 200, body: { ok: true, usage, links, configFresh: Boolean(config) } };
}

/** POST /membership/admin/coupon-link-rotate { code } -> { ok, code, token }. Mints a new token; the old link dies. */
export async function membershipCouponLinkRotate(request, env, { authorize = authorizeAdmin, now = new Date(), randomUUID = () => crypto.randomUUID(), ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env.SIGNUP_KV;

  let body;
  try { body = await request.json(); } catch { body = null; }
  const code = normalizeCouponCode(body?.code);
  if (!COUPON_CODE_RE.test(code)) return { status: 400, body: { error: 'bad_request', message: 'a coupon code is required' } };

  // Only a coupon that exists in the (fresh) config gets a link; a stale mirror fails closed like signup does.
  const config = await readCouponsConfig(kv, now);
  const exists = (config?.coupons ?? []).some((c) => c.code === code);
  if (!exists) return { status: 404, body: { error: 'not_found', message: `no such coupon in the live config: ${code}` } };

  const old = await kv.get(linkForKey(code));
  const token = randomUUID().replaceAll('-', '');
  await kv.put(couponLinkKey(token), code);
  await kv.put(linkForKey(code), token);
  if (old && old !== token) {
    try { await kv.delete(couponLinkKey(old)); } catch { /* the reverse key already points away; the old link is dead either way */ }
  }
  return { status: 200, body: { ok: true, code, token, rotated: Boolean(old) } };
}
