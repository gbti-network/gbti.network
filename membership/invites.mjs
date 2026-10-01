// sow-231: the ISSUED INVITE core. A campaign (house/coupons.yml) says WHAT an invite is worth; an invite
// says WHO we handed one to. This module is the pure half: minting a unique code, building the record, and
// deciding whether a given record may still be redeemed. Node-free (no fs, no yaml, no crypto), so the
// Worker, the CI validator and the tests all share one implementation.
//
// WHY THESE LIVE IN KV AND NOT IN house/coupons.yml, since that is the surprising part:
// an issued invite is a record of who we sent something to, carrying an administration note that in
// practice names a person. That is private, mutable, per-person state, and CLAUDE.md's storage boundary
// puts it in KV. Minting unique codes into the registry would write person-keyed records into a public,
// forkable, CDN-cached repository permanently, open one pull request per invite, and make the note the most
// identifying field in git history. The campaign stays in git because it is curated configuration; the
// invites do not because they are about people.
//
// THE BEARER PROPERTY IS ACCEPTED, NOT DENIED (owner, 2026-08-12, reversing their own 2026-07-18 ruling).
// Whoever opens a one-time link first can redeem it, so a forwarded link is a transferred membership. That
// was weighed and accepted: the alternative in place today is a shared, uncapped, published code whose
// failure mode is the WHOLE campaign, where this one fails at a single seat. Invites are deliberately
// FIRST-COME rather than bound to a named recipient, because the coupon is validated at /signup/start
// before either OAuth hop, so a bound invite could only be REFUSED after the recipient had already
// authorized GitHub and Discord. See sow-231 open questions 1 and 2.
//
// sow-427 NARROWS THAT FOR PREPARED LISTINGS ONLY. An invite minted for a prepared project may be BOUND to one
// GitHub account number (`boundGithubId`), resolved when the superadmin prepares it. redeemCoupon refuses a
// bound invite for any other account (bindingRefuses below) and leaves it unused, so the right person can still
// redeem it. What made that affordable is that the Discord hop moved to the welcome, so a refusal now costs the
// wrong person one GitHub authorization rather than two. Plain invites, and prepared ones left unbound, stay
// first-come exactly as described above.
//
// A prepared invite also has a CLAIM, which is a separate fact from the redemption on purpose: an existing
// member claims a listing without redeeming anything, and redeemCoupon returns early for anyone who already
// holds a grant. So the claim lives in its own fields (`claimPendingAt`, `claimedAt`), is written only by the
// claim route, and is never inferred from `redeemedAt`.

import { normalizeCouponCode, COUPON_CODE_RE, couponsFromParsed } from './coupons.mjs';

/**
 * The code alphabet, deliberately NOT the full A-Z 0-9 that COUPON_CODE_RE allows. `0/O`, `1/I/L` and `U`
 * are removed because these codes get read aloud, retyped from a message and pasted by hand, and a code
 * nobody can transcribe is a support ticket. 30 characters, so a 10-character suffix is about 49 bits.
 */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_SUFFIX_LEN = 10;

/** The campaign-derived prefix is capped so `prefix + suffix` always fits COUPON_CODE_RE's 32 characters. */
export const INVITE_PREFIX_MAX = 12;

/** An administration note is free text about a person, so it is bounded and stripped of control characters. */
export const MAX_INVITE_NOTE = 280;

export const INVITE_STATE = Object.freeze({
  issued: 'issued',
  redeemed: 'redeemed',
  revoked: 'revoked',
  expired: 'expired',
  claim_pending: 'claim_pending', // sow-427: a claim pull request is open for the prepared listing
  claimed: 'claimed', // sow-427: the prepared listing was published under the claimant's name
  unknown: 'unknown', // a malformed or missing record: never redeemable
});

/** sow-427: a GitHub account number, as every record in this system stores it. */
const GITHUB_ID_RE = /^\d{1,20}$/;

/** The KV key for one invite. ONE builder, so every reader and writer agrees on the shape. */
export function inviteKey(code) {
  return `invite:${normalizeCouponCode(code)}`;
}

/** The KV key prefix an admin sweep lists over. Kept next to inviteKey so the two can never drift apart. */
export const INVITE_KEY_PREFIX = 'invite:';

/**
 * The campaign-derived prefix of a minted code, so a code is recognizable in `house/grandfathered.yml`
 * after the reconcile fold lands it as `reason: coupon:<CODE>`. Anything outside the alphabet is dropped
 * rather than substituted, because a substitution could silently collide two campaigns onto one prefix.
 * Returns '' when the campaign yields no usable characters, which the caller must treat as unmintable.
 */
export function invitePrefix(campaign) {
  const up = normalizeCouponCode(campaign);
  let out = '';
  for (const ch of up) {
    if (INVITE_ALPHABET.includes(ch) && out.length < INVITE_PREFIX_MAX) out += ch;
  }
  return out;
}

/**
 * `len` characters of INVITE_ALPHABET from caller-supplied random bytes, or '' when the bytes run out first.
 * The rejection sampling described below lives here, once, so the invite code and the sow-427 listing id
 * (membership/prepared-listings.mjs) cannot drift into two samplers with different biases.
 */
export function alphabetSample(bytes, len) {
  const src = bytes instanceof Uint8Array ? bytes : Uint8Array.from(Array.isArray(bytes) ? bytes : []);
  const limit = 256 - (256 % INVITE_ALPHABET.length); // 240 for a 30-character alphabet
  let out = '';
  for (let i = 0; i < src.length && out.length < len; i += 1) {
    const b = src[i];
    if (b >= limit) continue; // biased sample: discard rather than fold it back in
    out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  }
  return out.length === len ? out : '';
}

/**
 * Mint a unique invite code for `campaign` from caller-supplied random bytes.
 *
 * Pure on purpose: the Worker passes `crypto.getRandomValues(new Uint8Array(32))` and the tests pass a
 * fixed array, so the same function is exercised in both and there is no untested branch in production.
 *
 * REJECTION SAMPLING, not plain modulo. 256 does not divide 30, so `byte % 30` would make the first six
 * letters of the alphabet measurably likelier. Bytes at or above 240 are skipped instead, which costs a
 * few extra bytes and removes the bias entirely.
 *
 * @throws when the campaign has no usable prefix, or the byte supply runs out before the suffix is full.
 */
export function mintInviteCode(campaign, bytes) {
  const prefix = invitePrefix(campaign);
  if (!prefix) throw new Error('invites: the campaign code yields no usable prefix');
  const suffix = alphabetSample(bytes, INVITE_SUFFIX_LEN);
  if (!suffix) throw new Error('invites: not enough random bytes to mint a code');
  const code = `${prefix}${suffix}`;
  // The minted code must satisfy the SAME rule every other coupon code does, because it travels the whole
  // existing validate -> sign -> redeem path with no special-casing. A failure here is a programming error.
  if (!COUPON_CODE_RE.test(code)) throw new Error(`invites: minted an invalid code (${code})`);
  return code;
}

/**
 * Bound + strip an administration note. Control characters (newlines and tabs included) collapse to a
 * single space so a note stays one line in a table and cannot smuggle framing into a log or an export;
 * everything else is stored as written. The escapes are written as \x.. rather than as literal bytes so the
 * intent survives a copy-paste through an editor that would silently eat the raw characters.
 */
export function sanitizeNote(note) {
  if (typeof note !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return note.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_INVITE_NOTE);
}

function isoOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Build a fresh invite record. `expiresAt` is a STORED DATE checked at redemption, deliberately not a KV
 * `expirationTtl`: a TTL'd key vanishes, and it would take the issuance record and the administration note
 * with it. An expired invite has to stay visible as "issued to X, never redeemed, expired" (sow-231 Q4).
 *
 * An unparseable `expiresAt` normalizes to null rather than throwing, and the CALLER validates it, so a bad
 * date can never quietly become an invite that lives forever.
 */
export function newInvite({
  campaign, code, issuedBy = null, issuedByLogin = null, note = '', expiresAt = null, now = new Date(),
  listingId = null, boundGithubId = null, boundLogin = null,
} = {}) {
  const c = normalizeCouponCode(code);
  const camp = normalizeCouponCode(campaign);
  if (!COUPON_CODE_RE.test(c)) throw new Error('invites: invalid invite code');
  if (!COUPON_CODE_RE.test(camp)) throw new Error('invites: invalid campaign code');
  // sow-427: a binding that cannot be read is REFUSED, never normalized to null. Null means "first-come", so
  // quietly dropping a malformed account number would turn an invitation meant for one person into one anybody
  // holding the link can redeem, which is the opposite of what the superadmin asked for.
  const bound = boundGithubId === null || boundGithubId === undefined || boundGithubId === '' ? null : String(boundGithubId);
  if (bound !== null && !GITHUB_ID_RE.test(bound)) throw new Error('invites: invalid bound account number');
  return {
    code: c,
    campaign: camp,
    issuedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    issuedBy: issuedBy === null || issuedBy === undefined ? null : String(issuedBy),
    issuedByLogin: issuedByLogin || null,
    note: sanitizeNote(note),
    expiresAt: isoOrNull(expiresAt),
    redeemedBy: null,
    redeemedByLogin: null,
    redeemedAt: null,
    revokedAt: null,
    revokedBy: null,
    // sow-427: the prepared-listing fields. Null on every plain invite, so its behaviour is unchanged.
    listingId: listingId ? String(listingId) : null,
    boundGithubId: bound,
    boundLogin: bound && boundLogin ? String(boundLogin) : null,
    claimPendingAt: null,
    claimPendingBy: null,
    claimPr: null,
    claimedAt: null,
    claimedBy: null,
  };
}

/**
 * The state of an invite at `now`. Order matters and encodes the policy:
 *   claimed beats everything (sow-427: the prepared listing is published, so the link must never grant a year
 *   again, whoever holds it next),
 *   then claim_pending (a claim pull request is open, so the link is held until it merges or closes),
 *   then redeemed (a used invite stays used even once its expiry passes, so the audit trail
 *   keeps saying what actually happened rather than being rewritten by the clock),
 *   then revoked, then expired, then issued.
 * A missing or structurally unusable record is `unknown`, never `issued`.
 */
export function inviteState(rec, now = new Date()) {
  if (!rec || typeof rec !== 'object') return INVITE_STATE.unknown;
  if (!COUPON_CODE_RE.test(normalizeCouponCode(rec.code))) return INVITE_STATE.unknown;
  if (rec.claimedAt) return INVITE_STATE.claimed;
  if (rec.claimPendingAt) return INVITE_STATE.claim_pending;
  if (rec.redeemedAt) return INVITE_STATE.redeemed;
  if (rec.revokedAt) return INVITE_STATE.revoked;
  if (rec.expiresAt) {
    const t = new Date(rec.expiresAt);
    // FAIL CLOSED: an expiry we cannot read is treated as passed, matching couponIsRedeemable's handling of
    // an unparseable campaign expiry. A corrupt date must not become an invite that never expires.
    if (Number.isNaN(t.getTime())) return INVITE_STATE.expired;
    if ((now instanceof Date ? now : new Date(now)).getTime() >= t.getTime()) return INVITE_STATE.expired;
  }
  return INVITE_STATE.issued;
}

/** True only for a record in the `issued` state. Every other outcome, including unknown, is false. */
export function inviteIsRedeemable(rec, now = new Date()) {
  return inviteState(rec, now) === INVITE_STATE.issued;
}

/**
 * Mark an invite redeemed. Returns { next, changed }. Idempotent by contract: a record already redeemed is
 * returned UNCHANGED rather than re-stamped, so a retried signup chain cannot rewrite who redeemed it or
 * when. A non-redeemable invite returns changed:false and the caller refuses the redemption.
 */
export function markInviteRedeemed(rec, { githubId, login = null, now = new Date() } = {}) {
  if (!inviteIsRedeemable(rec, now)) return { next: rec, changed: false };
  if (!githubId) return { next: rec, changed: false };
  return {
    next: {
      ...rec,
      redeemedBy: String(githubId),
      redeemedByLogin: login || null,
      redeemedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    },
    changed: true,
  };
}

/**
 * Revoke an unredeemed invite. Returns { next, changed }. A REDEEMED invite is never revoked: the grant it
 * produced is already live and is taken back through the grandfather machinery (ban or grant removal), not
 * by editing the record of how it was issued.
 *
 * sow-427: a CLAIMED invite is refused for the same reason (its listing is already public), and so is one with
 * a claim PENDING: the pull request is in flight, and a revoke written under it would be overruled the moment it
 * merged. Close the pull request first; that clears the pending claim, and the revoke is then accepted.
 */
export function revokeInvite(rec, { by = null, now = new Date() } = {}) {
  const state = inviteState(rec, now);
  if (state === INVITE_STATE.redeemed || state === INVITE_STATE.unknown) return { next: rec, changed: false };
  if (state === INVITE_STATE.claimed || state === INVITE_STATE.claim_pending) return { next: rec, changed: false };
  if (rec.revokedAt) return { next: rec, changed: false }; // idempotent
  return {
    next: { ...rec, revokedAt: (now instanceof Date ? now : new Date(now)).toISOString(), revokedBy: by === null ? null : String(by) },
    changed: true,
  };
}

/** Set the administration note on an existing invite. Allowed in any state: notes are an audit aid. */
export function setInviteNote(rec, note) {
  if (!rec || typeof rec !== 'object') return { next: rec, changed: false };
  const next = sanitizeNote(note);
  if (next === (rec.note ?? '')) return { next: rec, changed: false };
  return { next: { ...rec, note: next }, changed: true };
}

/**
 * sow-427: true when a BOUND invite must refuse `githubId`. Unbound invites never refuse (first-come, as sow-231
 * ruled), so this is false for every plain invite. A bound invite refuses every other account number and also
 * a missing one, because "we do not know who this is" must never read as "this is the person it was tied to".
 * Compared by account number only: a GitHub login can be renamed, the number cannot.
 */
export function bindingRefuses(rec, githubId) {
  const bound = rec && typeof rec === 'object' ? rec.boundGithubId : null;
  if (bound === null || bound === undefined || bound === '') return false;
  const id = githubId === null || githubId === undefined ? '' : String(githubId);
  return !id || String(bound) !== id;
}

const iso = (now) => (now instanceof Date ? now : new Date(now)).toISOString();

/**
 * sow-427: tie, retie or untie an invite (`boundGithubId` null unties it). Returns { next, changed }. Only while the
 * invite is issued, revoked or expired: once it is redeemed, pending a claim or claimed, the year or the listing has
 * already gone to one account, and moving the tie would hand it to another. The prepared-listing edit
 * (applyListingEdit) reports that refusal to the superadmin; this refuses the same cases so the invite and the
 * listing can never disagree about who the invitation is for. A malformed account number is refused, never
 * stored as null, because null means first-come.
 */
export function setInviteBinding(rec, { boundGithubId = null, boundLogin = null, now = new Date() } = {}) {
  const st = inviteState(rec, now);
  if (st !== INVITE_STATE.issued && st !== INVITE_STATE.revoked && st !== INVITE_STATE.expired) return { next: rec, changed: false };
  const bound = boundGithubId === null || boundGithubId === undefined || boundGithubId === '' ? null : String(boundGithubId);
  if (bound !== null && !GITHUB_ID_RE.test(bound)) return { next: rec, changed: false };
  const login = bound && boundLogin ? String(boundLogin) : null;
  if ((rec.boundGithubId ?? null) === bound && (rec.boundLogin ?? null) === login) return { next: rec, changed: false };
  return { next: { ...rec, boundGithubId: bound, boundLogin: login }, changed: true };
}

/**
 * sow-427: record that a claim pull request is open for this invite's listing. Returns { next, changed }.
 *
 * While pending the invite is NOT redeemable (inviteState reports claim_pending), which is the point: the
 * listing is about to go live, so the link must not hand a free year to the next person who opens it while the
 * pull request waits. Refused (changed:false) unless the invite is issued, or redeemed by this same account;
 * refused for a bound invite and another account; refused while another account holds the pending claim.
 * Recording the same claimant again only fills in `claimPr`, so a retried claim can store the number it found.
 */
export function markInviteClaimPending(rec, { githubId, pr = null, now = new Date() } = {}) {
  const id = githubId === null || githubId === undefined ? '' : String(githubId);
  if (!GITHUB_ID_RE.test(id)) return { next: rec, changed: false };
  const state = inviteState(rec, now);
  const prNum = Number.isInteger(pr) && pr > 0 ? pr : null;
  if (state === INVITE_STATE.claim_pending) {
    if (String(rec.claimPendingBy ?? '') !== id) return { next: rec, changed: false };
    if (prNum === null || rec.claimPr === prNum) return { next: rec, changed: false };
    return { next: { ...rec, claimPr: prNum }, changed: true };
  }
  if (state !== INVITE_STATE.issued && state !== INVITE_STATE.redeemed) return { next: rec, changed: false };
  if (state === INVITE_STATE.redeemed && String(rec.redeemedBy ?? '') !== id) return { next: rec, changed: false };
  if (bindingRefuses(rec, id)) return { next: rec, changed: false };
  return { next: { ...rec, claimPendingAt: iso(now), claimPendingBy: id, claimPr: prNum }, changed: true };
}

/**
 * sow-427: clear a pending claim, because its pull request closed without merging. Returns { next, changed }.
 * With `githubId`, only that claimant's pending claim is cleared. The invite returns to the state it held before
 * the claim (issued, or redeemed), so the person can try again with the same link. A claimed invite is never
 * touched: its listing is already public.
 */
export function clearInviteClaimPending(rec, { githubId = null } = {}) {
  if (!rec || typeof rec !== 'object' || rec.claimedAt) return { next: rec, changed: false };
  if (!rec.claimPendingAt && !rec.claimPendingBy && !rec.claimPr) return { next: rec, changed: false };
  if (githubId !== null && githubId !== undefined && String(rec.claimPendingBy ?? '') !== String(githubId)) return { next: rec, changed: false };
  return { next: { ...rec, claimPendingAt: null, claimPendingBy: null, claimPr: null }, changed: true };
}

/**
 * sow-427: mark the invite CLAIMED, once its claim pull request has MERGED. Returns { next, changed }.
 *
 * Idempotent: an invite already claimed is returned unchanged, so a finalize that runs twice (the claimant's
 * page, the manager and the scheduled sweep can each notice the same merge) never rewrites who or when. Accepted
 * from any readable state, including revoked, because the merge is a fact about the repository: the project is
 * public under that account whatever happened to the link meanwhile, and a claimed invite can never grant a year
 * again, which is the direction a mistake here has to fall.
 */
export function markInviteClaimed(rec, { githubId, pr = null, now = new Date() } = {}) {
  const id = githubId === null || githubId === undefined ? '' : String(githubId);
  if (!GITHUB_ID_RE.test(id)) return { next: rec, changed: false };
  if (inviteState(rec, now) === INVITE_STATE.unknown) return { next: rec, changed: false };
  if (rec.claimedAt) return { next: rec, changed: false };
  const prNum = Number.isInteger(pr) && pr > 0 ? pr : (Number.isInteger(rec.claimPr) ? rec.claimPr : null);
  return {
    next: { ...rec, claimedAt: iso(now), claimedBy: id, claimPendingAt: null, claimPendingBy: null, claimPr: prNum },
    changed: true,
  };
}

/**
 * The shareable link for an invite. Reuses the EXISTING plain `?coupon=` parameter the invite page already
 * reads (`src/pages/codeable-invite/index.astro`), so nothing new has to be built on the page: what changed
 * is that the code in the link is unique per invite rather than shared. The sow-119 `?t=<token>` resolver
 * stays retired.
 */
/**
 * sow-231 Phase 3: WHICH LANDER a coupon's link should point at.
 *
 * There are now three tier-scoped invite landers, and sending a code to the wrong one advertises benefits
 * the recipient will not receive. That is not hypothetical: a member-tier coupon went live pointed at the
 * Creator lander on 2026-08-15 and the owner caught it. `house/membership-tiers.yml` calls benefit copy a
 * legal line, so the pairing is a correctness question rather than a routing convenience.
 *
 * Node-free and pure so the browser manager, the CLI and any future surface resolve it identically. It is
 * the ONLY place the mapping lives; a second copy would drift and the drift would be invisible until
 * somebody read a lander they were sent.
 */
export const LANDER_BY_TIER = Object.freeze({
  member: '/member-invite/',
  creator: '/curator-invite/',
});

// Per-CAMPAIGN overrides, for a campaign with its own audience-specific page. CODEABLEYEAR is MEMBER tier
// (house/coupons.yml), so the tier map alone would already send it to /member-invite/; the override exists
// because it has a Codeable page whose copy addresses that audience directly. Keyed by campaign because that
// is what it is: a property of the campaign, not of the tier.
//
// Corrected 2026-08-24: this comment said "CODEABLEYEAR is creator tier, so the tier map alone would send it
// to the generic curator lander". That was false against house/coupons.yml, which has named `tier: member` on
// this code since 2026-08-12. The routing was right either way, which is exactly why nobody caught it, and
// the same false belief written one file over is what kept /codeable-invite/ advertising Content Creator at
// $150 for a $50 member grant.
export const LANDER_BY_CAMPAIGN = Object.freeze({
  CODEABLEYEAR: '/codeable-invite/',
});

/**
 * The lander for a coupon/campaign, or NULL when nothing describes what it grants.
 *
 * Null rather than a fallback ON PURPOSE. Falling back to any page would describe a tier the coupon does
 * not confer, which is the exact defect this exists to prevent, so a caller must handle "no lander" rather
 * than be handed a plausible wrong one.
 */
export function landerFor({ code, id, tier } = {}) {
  // sow-291: keyed by the campaign's stable ID, falling back to the code. A per-campaign lander is a property
  // of the CAMPAIGN, not of the string someone redeems, so it must survive a code rotation untouched. `id`
  // defaults to `code` throughout the coupon core, so every existing caller passing only `code` is unchanged.
  const c = normalizeCouponCode(id || code);
  return LANDER_BY_CAMPAIGN[c] || LANDER_BY_TIER[tier] || null;
}

/**
 * sow-291: the CODE-FREE campaign manifest, projected from the parsed coupon registry.
 *
 * WHY A PROJECTION AND NOT A SECOND REGISTRY. Two consumers cannot reach KV and would otherwise be left
 * reading nothing once the registry moves off the public repository:
 *   - `test/invite-lander-parity.test.mjs`, a unit test with no network and no secrets by project rule, and
 *     the only guard stopping an invite lander from advertising a tier its campaign does not grant;
 *   - the Astro build, which resolves lander copy on a runner with no KV binding.
 * Both need to know which campaigns exist, what tier each confers and which page describes it. NONE of them
 * needs the redeemable code, which is the whole point: this carries identity and terms, never the credential.
 *
 * It is a PROJECTION, so it is generated and drift-guarded rather than hand-maintained. A hand-maintained
 * copy of a registry disagrees with it eventually, and the disagreement is invisible until somebody reads a
 * lander describing a tier they were not given, which is the defect that already shipped once here.
 *
 * `code` is deliberately absent from the returned shape rather than emptied, so a caller that wants it gets
 * `undefined` and fails, instead of silently reading a blank string as a valid code.
 */
export function campaignManifest(parsed) {
  const campaigns = [];
  const seen = new Set();
  for (const c of couponsFromParsed(parsed).values()) {
    if (seen.has(c.id)) continue; // first wins, mirroring couponsFromParsed's own duplicate rule
    seen.add(c.id);
    campaigns.push({
      id: c.id,
      tier: c.tier,
      active: c.active,
      lander: landerFor({ id: c.id, tier: c.tier }),
    });
  }
  campaigns.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // stable output, so a regenerate is a no-op diff
  return { campaigns };
}

export function inviteLink(siteBase, code, path = '/codeable-invite/') {
  const base = String(siteBase || '').replace(/\/+$/, '');
  return `${base}${path}?coupon=${encodeURIComponent(normalizeCouponCode(code))}`;
}

/** The admin-facing view of a record: the state resolved once, so no surface re-derives it. */
export function inviteSummary(rec, now = new Date()) {
  if (!rec || typeof rec !== 'object') return null;
  return {
    code: normalizeCouponCode(rec.code),
    campaign: normalizeCouponCode(rec.campaign),
    state: inviteState(rec, now),
    issuedAt: rec.issuedAt ?? null,
    issuedByLogin: rec.issuedByLogin ?? null,
    note: rec.note ?? '',
    expiresAt: rec.expiresAt ?? null,
    redeemedBy: rec.redeemedBy ?? null,
    redeemedByLogin: rec.redeemedByLogin ?? null,
    redeemedAt: rec.redeemedAt ?? null,
    revokedAt: rec.revokedAt ?? null,
    // sow-427: enough for the manager to hide a prepared invite from the plain list and to show its state. The
    // binding is reported as a yes or no only; the prepared-listing manager names the account.
    listingId: rec.listingId ?? null,
    bound: Boolean(rec.boundGithubId),
    claimPendingAt: rec.claimPendingAt ?? null,
    claimedAt: rec.claimedAt ?? null,
  };
}
