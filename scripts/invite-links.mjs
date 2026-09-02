#!/usr/bin/env node
// sow-230: print every coupon invite link, ready to send.
//
// WHY THIS EXISTS AS A SCRIPT RATHER THAN A NOTE SOMEWHERE. An invite link is a coupon code paired with the
// lander that describes the tier that coupon grants, and getting that pairing wrong is not cosmetic: it is
// the defect that retired /linkedin-invite/, where a member-tier code sat under prose selling the creator
// tier. Assembling the URL by hand is how that recurs. Here the code, the tier and the lander are resolved
// from the registry together, and a mismatch is REPORTED rather than silently rendered.
//
// READS THE REGISTRY FROM KV (sow-291 Phase 2). house/coupons.yml has left the public repository, because a
// coupon code is a bearer credential, so the live registry is now `coupons:config` in the members KV store.
// This CLI reads it via the Cloudflare REST API and NEEDS CF credentials: set CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID
// / CF_API_TOKEN. The old `--local` / origin-main file reads are retired: there is no git copy to be stale
// against any more, and a fail-loud missing-creds error replaces the silent-stale hazard the file read carried.
//
// Usage (CF_* in the environment):
//   node scripts/invite-links.mjs              every ACTIVE coupon, from KV coupons:config
//   node scripts/invite-links.mjs --all        include inactive / expired / exhausted, with the reason
//   node scripts/invite-links.mjs --json       machine-readable
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { couponsFromParsed } from '../membership/coupons.mjs';
import { landerFor, LANDER_BY_TIER, LANDER_BY_CAMPAIGN } from '../membership/invites.mjs'; // sow-231 P3: ONE mapping
import { readCouponsConfigRest } from './lib/kv-mirror.mjs'; // sow-291 Phase 2: the registry is KV-native now

const SITE = process.env.SITE_BASE_URL || 'https://gbti.network';

const args = new Set(process.argv.slice(2));
const showAll = args.has('--all');
const asJson = args.has('--json');

// The tier -> lander mapping now lives in membership/invites.mjs (`landerFor`), shared with the browser
// coupon manager. It was duplicated here first; that duplication is removed rather than kept in sync,
// because a second copy of this particular mapping drifts silently and the symptom is somebody being sent
// a page describing a tier they were not given.

async function readRegistry() {
  // sow-291 Phase 2: read coupons:config from KV. Fail LOUDLY on missing creds or an unreadable/absent registry,
  // never fall back to a stale or empty source: a quiet fallback is exactly how the /linkedin-invite tier
  // mismatch this script exists to prevent would recur.
  const r = await readCouponsConfigRest({ env: process.env });
  if (!r.available) {
    throw new Error(`could not read the coupon registry from KV (${r.reason}). Set CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN.`);
  }
  if (!r.config || !Array.isArray(r.config.coupons)) {
    throw new Error('the coupon registry (coupons:config) is absent or malformed in KV.');
  }
  return { source: 'KV coupons:config', raw: r.config };
}

/** The lander that describes what `coupon` grants, or null when nothing does. Pure. */
export function resolveLander(coupon) {
  if (!coupon || !coupon.code) return null;
  return landerFor({ code: coupon.code, tier: coupon.tier });
}

/** Why a coupon is not sendable right now, or null when it is. Mirrors couponIsRedeemable plus the cap. */
export function blockedReason(c, now = new Date()) {
  if (c.active !== true) return 'inactive';
  if (c.expiresAt) {
    const t = new Date(c.expiresAt);
    if (Number.isNaN(t.getTime())) return 'unreadable expiresAt (treated as expired)';
    if (now.getTime() >= t.getTime()) return `expired ${c.expiresAt}`;
  }
  return null;
}

/** Build the row for one coupon: the link, whether it is sendable, and anything wrong with the pairing. */
export function inviteRow(c, now = new Date()) {
  const blocked = blockedReason(c, now);
  const lander = resolveLander(c);
  const warnings = [];
  // The pairing check. A coupon with no tier cannot be matched to a lander at all, and validateCoupons
  // already rejects that for an ACTIVE coupon, so reaching it here means an inactive one or a registry
  // edited around the validator.
  if (!c.tier) warnings.push('no tier: cannot resolve a lander, and an active coupon naming no tier is rejected by validateCoupons');
  else if (!lander) warnings.push(`tier "${c.tier}" has no lander in membership/invites.mjs LANDER_BY_TIER: nothing describes what this grants`);
  return {
    code: c.code,
    tier: c.tier ?? null,
    freeDays: c.freeDays ?? null,
    maxRedemptions: c.maxRedemptions ?? null,
    note: c.note ?? '',
    sendable: !blocked && Boolean(lander),
    blocked,
    url: lander ? `${SITE}${lander}?coupon=${c.code}` : null,
    warnings,
  };
}

// ---- CLI below. Importing this module runs nothing. ----------------------------------------------------
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main().catch((e) => { console.error(`invite-links: ${e?.message ?? e}`); process.exit(1); });

async function main() {
const now = new Date();
const { source, raw } = await readRegistry();
const coupons = [...couponsFromParsed(raw).values()];

const rows = coupons.map((c) => inviteRow(c, now));

const visible = showAll ? rows : rows.filter((r) => r.sendable);

if (asJson) {
  console.log(JSON.stringify({ source, generatedAt: now.toISOString(), coupons: visible }, null, 2));
} else {
  console.log(`Invite links, read from ${source}\n`);
  if (!visible.length) {
    console.log(showAll ? '  (no coupons in the registry)' : '  (no sendable coupons; re-run with --all to see why)');
  }
  for (const r of visible) {
    const years = r.freeDays ? `${r.freeDays} days` : 'no free period';
    console.log(`  ${r.code}  [tier: ${r.tier ?? 'NONE'} · ${years}${r.maxRedemptions === null ? ' · uncapped' : ` · max ${r.maxRedemptions}`}]`);
    if (r.note) console.log(`    ${r.note}`);
    console.log(`    ${r.url ?? '(no lander: not sendable)'}`);
    if (r.blocked) console.log(`    NOT SENDABLE: ${r.blocked}`);
    for (const w of r.warnings) console.log(`    WARNING: ${w}`);
    console.log('');
  }
  const uncapped = visible.filter((r) => r.sendable && r.maxRedemptions === null);
  if (uncapped.length) {
    console.log(`Note: ${uncapped.length} sendable code${uncapped.length === 1 ? ' is' : 's are'} UNCAPPED and there is no redemption`);
    console.log('notification, so nothing reports a redemption as it happens. These are bearer codes: whoever holds');
    console.log('the link can redeem it, and a forwarded link is a transferred free year.');
  }
}
}
