// SOW-119: the coupon registry core. Pure over the PARSED house/coupons.yml ({ coupons: [{ code, freeDays,
// active, tier, note?, maxRedemptions?, expiresAt? }] }), like the other membership cores: callers (the CI
// validator, the signup Worker via the coupons:config KV mirror, the admin edit core) parse or fetch the
// yaml/mirror and pass the object. Everything FAILS CLOSED: a malformed entry never grants time, an unknown
// or inactive or expired code resolves to null, and a bad freeDays yields no `until`.
// Node-free (no fs / no yaml).
//
// sow-185 / owner ruling 2026-08-11: TIER IS EXPLICIT, NOT INHERITED. A coupon NAMES the paid tier it
// confers, and the reconcile fold writes that name into the grandfather grant. `grantTier`'s creator
// default still exists, but it is there to preserve LEGACY flat grants, not to decide what a live campaign
// hands out. Leaning on it means the tier is silently re-decided on every future redemption, and a later
// change to that default would move everyone already folded. See house/coupons.yml for the ruling itself.

import { PAID_GRANT_TIERS } from './tier-gate.mjs'; // sow-185: the paid tiers a grant (and so a coupon) may name

/** Normalize a coupon code for lookup: trim + uppercase (codes are case-insensitive at entry). */
export function normalizeCouponCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

/** Coupon codes are 3-32 chars of A-Z 0-9 (post-normalization). Anything else is rejected everywhere. */
export const COUPON_CODE_RE = /^[A-Z0-9]{3,32}$/;

/**
 * One parsed entry -> a normalized coupon object, or null when structurally unusable (fail closed).
 *
 * sow-291: A CAMPAIGN HAS TWO NAMES, AND ONLY ONE OF THEM IS A SECRET.
 *   `id`   is the campaign's stable public identity. It appears in house/grandfathered.yml as
 *          `reason: coupon:<ID>`, in an invite record's `campaign` field, in LANDER_BY_CAMPAIGN, and in the
 *          code-free manifest the Astro build and the lander parity guard read. It is not a credential and
 *          it never changes.
 *   `code` is the redeemable string. Holding it IS the authorization, so it is a bearer credential, and
 *          sow-291 moves it off the public repository and makes it rotatable.
 *
 * They are the SAME today, and `id` defaults to `code` for exactly that reason: every record written before
 * this field existed keeps working, and no fixture, mirror blob or committed entry has to be rewritten to
 * introduce the split. They diverge at the rotation, and from then on changing a code costs nothing but the
 * code, because everything that refers to a campaign by name refers to the id.
 */
function normalizeEntry(e) {
  const code = normalizeCouponCode(e?.code);
  const freeDays = Number(e?.freeDays);
  if (!COUPON_CODE_RE.test(code)) return null;
  // An explicit id is held to the same shape as a code. An unusable one is REJECTED rather than silently
  // falling back to the code: a typo'd id would otherwise mint a second campaign identity that resolves no
  // lander and matches no existing grant reason, and it would do it quietly.
  const rawId = e?.id === undefined || e?.id === null || e?.id === '' ? null : normalizeCouponCode(e.id);
  if (rawId !== null && !COUPON_CODE_RE.test(rawId)) return null;
  const id = rawId ?? code;
  if (!Number.isInteger(freeDays) || freeDays < 1 || freeDays > 3650) return null;
  const maxRedemptions = e?.maxRedemptions === undefined || e?.maxRedemptions === null
    ? null
    : Number(e.maxRedemptions);
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) return null;
  return {
    id,
    code,
    freeDays,
    active: e?.active === true,
    // sow-185: only a real PAID tier survives. An absent, misspelled or `none` tier normalizes to null,
    // which the fold reads as "this coupon names no tier" and leaves the grant tierless, exactly as it
    // behaved before this field existed. A typo therefore costs the explicitness, never a wrong grant.
    tier: PAID_GRANT_TIERS.includes(e?.tier) ? e.tier : null,
    note: typeof e?.note === 'string' ? e.note : '',
    maxRedemptions,
    expiresAt: typeof e?.expiresAt === 'string' && e.expiresAt ? e.expiresAt : null,
  };
}

/** Parsed yaml/mirror -> Map(code -> coupon), skipping malformed entries (first write wins on a dup). */
export function couponsFromParsed(parsed) {
  const out = new Map();
  const list = Array.isArray(parsed?.coupons) ? parsed.coupons : [];
  for (const e of list) {
    const c = normalizeEntry(e);
    if (c && !out.has(c.code)) out.set(c.code, c);
  }
  return out;
}

/** True when the coupon itself is redeemable at `now` (active and not past its own expiresAt). */
export function couponIsRedeemable(coupon, now = new Date()) {
  if (!coupon || coupon.active !== true) return false;
  if (!coupon.expiresAt) return true;
  const exp = new Date(coupon.expiresAt);
  if (Number.isNaN(exp.getTime())) return false; // FAIL CLOSED: unparseable expiry disables the coupon
  return now.getTime() < exp.getTime();
}

/** Resolve a redeemable coupon by (case-insensitive) code, or null. */
export function couponByCode(parsed, code, now = new Date()) {
  const c = couponsFromParsed(parsed).get(normalizeCouponCode(code));
  return c && couponIsRedeemable(c, now) ? c : null;
}

/**
 * sow-185: the paid tier a coupon confers, or null when it names none. The ONE place the reconcile fold
 * and any other reader agree on how a code resolves to a tier. Deliberately does NOT fall back to creator:
 * that fallback lives in grantTier, downstream, and duplicating it here would reintroduce the implicitness
 * this field exists to remove.
 *
 * Reads the registry rather than the coupon's own redeemability, on purpose. A grant is folded from a
 * redemption that ALREADY happened, so a coupon since deactivated or expired must still resolve to the
 * tier it was redeemed under; gating this on couponIsRedeemable would silently downgrade a pending fold
 * the moment a campaign is switched off.
 */
export function couponTier(parsed, code) {
  return couponsFromParsed(parsed).get(normalizeCouponCode(code))?.tier ?? null;
}

/** The grant end date for a redemption at `now`: now + freeDays, as an ISO string (UTC). */
export function redemptionUntil(now, freeDays) {
  const days = Number(freeDays);
  if (!Number.isInteger(days) || days < 1) return null; // fail closed
  const t = new Date(now instanceof Date ? now.getTime() : new Date(now).getTime());
  if (Number.isNaN(t.getTime())) return null;
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString();
}

/** The KV key the coupons:config mirror lives under (written by reconcile + sync-overrides-mirror). */
export const COUPONS_MIRROR_KEY = 'coupons:config';

/** The KV keys for a redemption record and a per-code counter (one place, so every reader agrees). */
export function redemptionKey(code, githubId) {
  return `redemption:${normalizeCouponCode(code)}:${String(githubId)}`;
}
export function redemptionCountKey(code) {
  return `redemptions:${normalizeCouponCode(code)}`;
}
/** Structural validation for CI. An absent config (null) is valid. Returns an array of error strings. */
export function validateCoupons(parsed, { file = 'coupons.yml' } = {}) {
  const errors = [];
  if (parsed === null || parsed === undefined) return errors;
  const list = parsed?.coupons;
  if (!Array.isArray(list)) {
    errors.push(`${file}: \`coupons\` must be a list`);
    return errors;
  }
  const seen = new Set();
  const seenIds = new Set();
  list.forEach((e, i) => {
    const code = normalizeCouponCode(e?.code);
    if (!COUPON_CODE_RE.test(code)) errors.push(`${file}: coupons[${i}] code must be 3-32 chars A-Z 0-9 (got "${e?.code ?? ''}")`);
    else if (seen.has(code)) errors.push(`${file}: duplicate coupon code ${code}`);
    else seen.add(code);
    // sow-291: the id is the campaign's stable public identity, so a DUPLICATE id is worse than a duplicate
    // code. Two campaigns sharing an id make `reason: coupon:<ID>` in a grandfather grant ambiguous after the
    // fact, and no later read can tell which campaign a member actually came in on.
    if (e?.id !== undefined && e?.id !== null && e?.id !== '') {
      const id = normalizeCouponCode(e.id);
      if (!COUPON_CODE_RE.test(id)) errors.push(`${file}: coupons[${i}] id must be 3-32 chars A-Z 0-9 when set (got "${e.id}")`);
      else if (seenIds.has(id)) errors.push(`${file}: duplicate campaign id ${id}`);
      else seenIds.add(id);
    }
    const days = Number(e?.freeDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) errors.push(`${file}: coupons[${i}] freeDays must be an integer 1-3650`);
    if (typeof e?.active !== 'boolean') errors.push(`${file}: coupons[${i}] active must be true or false`);
    if (e?.maxRedemptions !== undefined && e?.maxRedemptions !== null && (!Number.isInteger(Number(e.maxRedemptions)) || Number(e.maxRedemptions) < 1)) {
      errors.push(`${file}: coupons[${i}] maxRedemptions must be a positive integer when set`);
    }
    if (e?.expiresAt !== undefined && e?.expiresAt !== null && Number.isNaN(new Date(e.expiresAt).getTime())) {
      errors.push(`${file}: coupons[${i}] expiresAt must be an ISO date when set`);
    }
    // sow-185, enforcing the owner's "TIER IS EXPLICIT, NOT INHERITED" ruling in CI rather than restating it
    // in a comment. A LIVE campaign must name what it hands out; an inactive or fully-expired coupon is not
    // handing anything out, so it is only held to naming a valid tier IF it names one at all.
    if (e?.tier !== undefined && e?.tier !== null && !PAID_GRANT_TIERS.includes(e.tier)) {
      errors.push(`${file}: coupons[${i}] tier must be one of ${PAID_GRANT_TIERS.join(', ')} when set (got "${e.tier}")`);
    } else if (e?.active === true && (e?.tier === undefined || e?.tier === null)) {
      errors.push(`${file}: coupons[${i}] (${code || 'unnamed'}) is active and must name the tier it confers (tier: ${PAID_GRANT_TIERS.join(' or ')}); a fold must never inherit it from grantTier's default`);
    }
  });
  return errors;
}

/** The coupons:config mirror blob shape ({ generatedAt, coupons }), from the raw parsed yaml. */
/**
 * sow-291 Phase 2: A KV-NATIVE COUPON SURVIVES THE GIT SYNC.
 *
 * The same hazard sow-213 met on the overrides blob, on the coupon registry. `toCouponsMirror` rebuilt
 * `coupons:config` wholesale from git, which is correct only while git is the sole writer. The moment an admin
 * action writes a coupon straight to KV, the next run of the six-hourly mirror ERASES it: the coupon works,
 * then quietly stops within six hours, on a green run, with nothing reporting it.
 *
 * The fix is sow-213's, because the shape is sow-213's: a PROPERTY RATHER THAN A DISCIPLINE. An entry marked
 * `source: 'kv'` is preserved, so this writer can add and update git-sourced coupons but can never delete a
 * KV-native one. Nobody has to remember a rule at the moment the writers invert.
 *
 * Identity here is the CODE, not the id, because the code is what a redemption looks up (`couponsFromParsed`
 * keys on it). An unmarked existing entry is treated as a stale copy of a git one and dropped, which is what
 * keeps a REMOVAL in git effective: deactivating a coupon in git must still deactivate it, or this would trade
 * one silent failure for another.
 */
export function mergeCouponsList(gitCoupons, existingCoupons) {
  const git = Array.isArray(gitCoupons) ? gitCoupons : [];
  const existing = Array.isArray(existingCoupons) ? existingCoupons : [];
  const codeOf = (c) => (c && c.code != null && c.code !== '' ? String(c.code) : null);
  const gitCodes = new Set(git.map(codeOf).filter(Boolean));
  const kvNative = existing.filter((c) => c?.source === 'kv' && codeOf(c) && !gitCodes.has(codeOf(c)));
  return kvNative.length === 0 ? git : [...git, ...kvNative];
}

/**
 * Build the `coupons:config` blob the signup Worker reads.
 *
 * `existing` is the blob currently in KV; pass it so a KV-native coupon is not clobbered. `ownedByGit` says
 * whether `house/coupons.yml` still exists in the checkout: sow-291 Phase 2 deletes it, and from that moment a
 * rebuild from the empty read would write an EMPTY registry over the live one, taking every coupon down within
 * six hours on a green run. So when git does not own the registry, KV is the source and this does not rebuild
 * it. If there is nothing usable to preserve, the write ABORTS rather than writing empty.
 *
 * What an abort costs, stated rather than waved at: the blob stops being refreshed, so a transient failure is
 * absorbed by the Worker's 48h freshness window and a persistent one ages the blob out and fails every coupon
 * CLOSED. That is the safe direction and it is LOUD (the six-hourly job exits non-zero, so it reds four times a
 * day). The alternative is an erase that disables every coupon on a GREEN run with nobody watching.
 */
export function toCouponsMirror(raw, now = new Date(), existing = null, ownedByGit = true) {
  const generatedAt = now.toISOString();
  if (!ownedByGit) {
    // NO ARRAY AT ALL and AN EMPTY ARRAY are different, and only the first is a fault. This aborted on both
    // until SecurityMaster pointed out that the abort buys no safety in the empty case: zero coupons already
    // means nothing is redeemable, so refusing to write does not protect anything, it only makes a legitimate
    // state unreachable. "Every campaign has ended" is a real admin action, and under the old rule it would
    // have red the six-hourly job four times a day forever, with no legitimate way to clear it except putting
    // a coupon back. That job also carries the overrides mirror, so a permanently red run there is a genuine
    // failure nobody would look at any more.
    //
    // The case the abort EXISTS for is untouched by the split: a Phase 2 flip performed before KV was
    // populated leaves no coupons array at all (a 404 read, or a blob of another shape), and that still
    // aborts. That is the ordering mistake worth being loud about.
    const kept = existing?.coupons;
    if (!Array.isArray(kept)) {
      throw new Error('refusing to write coupons:config: house/coupons.yml is absent and KV carries no coupon registry to preserve');
    }
    return { generatedAt, coupons: kept };
  }
  return {
    generatedAt,
    coupons: mergeCouponsList([...couponsFromParsed(raw).values()], existing?.coupons),
  };
}
