// SOW-119: admin-gated coupon USAGE. The coupon CONFIG is git-native (house/coupons.yml via the admin
// house-PR flow); this module serves the KV-side runtime state the git file cannot: per-code redemption
// counts + records. authorizeAdmin runs FIRST (token -> github_id -> role from the fresh KV overrides
// mirror, fail closed). The 2026-07-18 QA feedback RETIRED the shareable token-link system (it acted as
// a bearer secret); sharing is now the plain visible /codeable-invite/?coupon=<CODE> URL, so no link
// state lives here anymore.
//
// KV keys:
//   redemption:<CODE>:<githubId>   a redemption record (written at signup)
//   redemptions:<CODE>             the per-code counter

import { authorizeAdmin } from './membership-admin.mjs';
import { readCouponsConfig } from './coupons.mjs';
import { redemptionCountKey } from '../../membership/coupons.mjs';

/** GET /membership/admin/coupon-usage -> { ok, usage: { CODE: { count, max, redemptions: [...] } } } */
export async function membershipCouponUsage(request, env, { authorize = authorizeAdmin, now = new Date(), ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env.SIGNUP_KV;

  const config = await readCouponsConfig(kv, now);
  const codes = (config?.coupons ?? []).map((c) => c.code);
  const usage = {};

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
  }

  return { status: 200, body: { ok: true, usage, configFresh: Boolean(config) } };
}
