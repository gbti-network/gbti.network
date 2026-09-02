// Publish-eligibility for the client (SOW-011). Publishing to the canonical repo is paid-only, so the
// client must know whether the signed-in member may publish BEFORE it opens a pull request, both to show a
// "membership required to publish" notice and to keep a trial member's drafts on their own fork (nothing
// reaches the canonical repo until they pay). This is advisory UX: the SOW-005 gate stays the authority.
//
// The client holds no Stripe key, so it learns its EFFECTIVE membership from the signup Worker's
// /membership/status oracle (which verifies the GitHub token -> github_id and folds ban > staff > grandfather >
// Stripe SERVER-SIDE over the KV overrides mirror, returning it as `effectiveStatus`). sow-213 R2: the client no
// longer reads house/bans.yml + house/grandfathered.yml to re-fold that precedence itself, because those two
// person-keyed files left the public repo for the mirror. The result is computed once at login and cached, so
// the publish choke point is a trivial synchronous check.

import yaml from 'js-yaml';
import { roleOf, rolesFromText, ROLE } from './roles.mjs';

const STAFF = new Set([ROLE.moderator, ROLE.admin, ROLE.superadmin]);

// Known statuses that may NOT publish. 'unknown' is deliberately absent: when the status oracle is
// unreachable the client fails OPEN to the gate (it never wrongly blocks a paid member; the gate rejects a
// genuinely non-paid PR anyway).
const NON_PUBLISHABLE = new Set(['trialing', 'expired', 'cancelled', 'none', 'banned']);

/** Parse bans.yml TEXT -> Set of banned github_id strings. Missing/unparseable -> empty (fail open to the gate). */
export function bannedIdsFromText(text) {
  if (!text) return new Set();
  try {
    const parsed = yaml.load(text);
    return new Set((parsed?.bans ?? []).map((e) => String(e?.github_id ?? e)).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Parse grandfathered.yml TEXT -> Map github_id -> entry. Missing/unparseable -> empty. */
export function grandfathersFromText(text) {
  if (!text) return new Map();
  try {
    const parsed = yaml.load(text);
    const m = new Map();
    for (const e of parsed?.grandfathered ?? []) {
      const id = String(e?.github_id ?? e);
      if (id) m.set(id, e);
    }
    return m;
  } catch {
    return new Map();
  }
}

/** A grandfather grant is active when there is no `until`, or `until` is in the future. Fail closed on a bad date. */
export function grandfatherActive(entry, now = Date.now()) {
  if (!entry) return false;
  const until = entry.until;
  if (until === undefined || until === null || until === '') return true;
  const t = new Date(until).getTime();
  if (Number.isNaN(t)) return false; // an unparseable `until` expires the grant
  return now < t;
}

/**
 * Effective publish-eligibility status, mirroring the gate's effectiveStatus precedence
 * (ban > staff > grandfather > Stripe). Returns 'banned' | 'paid' | 'trialing' | 'expired' | 'cancelled' |
 * 'none' | 'unknown'.
 */
export function effectiveMembership({ githubId, stripeStatus = 'unknown', roles = new Map(), banned = new Set(), grandfathers = new Map(), now = Date.now() } = {}) {
  const id = String(githubId ?? '');
  if (banned.has(id)) return 'banned';
  if (STAFF.has(roleOf(id, roles))) return 'paid'; // staff are paid-equivalent
  if (grandfatherActive(grandfathers.get(id), now)) return 'paid'; // a grandfather grant publishes with no sub
  return stripeStatus || 'unknown';
}

/** Whether a membership value may publish to the canonical repo. Only a paid (or paid-equivalent) member may. */
export function canPublish(membership) {
  return membership === 'paid';
}

// SOW-082: who may STAGE a draft on their OWN fork (Save, no PR). The tier table "Author + stage drafts": Trial yes /
// Paid yes / Free no / banned no. This is DISTINCT from canSave (the KV favorites/follow perk) and from canPublish
// (paid-only). 'unknown' is deliberately absent so the op fails OPEN (the fork write is the member's own repo; the
// members-only encryption path re-checks effective-paid server-side anyway).
const STAGE_TIER = new Set(['paid', 'trialing']);
export function canStageDrafts(membership) {
  return STAGE_TIER.has(membership);
}

// SOW-077: a ban is a COMMUNITY ban, not total. A banned account stays a READ-only signed-in user (browse member
// activity, read the news feed, see public shares) but gets ZERO KV: no save/collect/follow/prefs (its own mutable
// member record). So there are TWO free-tier sets:
//   READ_TIER  = any signed-in status INCLUDING banned (the non-KV reads).
//   FREE_TIER  = signed-in AND NOT banned (the KV "basket": save/collect/follow + news prefs).
// Only the unresolved 'unknown' is excluded from both. Member-only content/comments stay on canSeeShares; publishing
// stays on canPublish. (SOW-060 opened these to the free tier; SOW-077 carves banned out of the KV ones only.)
const READ_TIER = new Set(['paid', 'trialing', 'expired', 'cancelled', 'none', 'banned']);
const FREE_TIER = new Set(['paid', 'trialing', 'expired', 'cancelled', 'none']);
/** READ perks (no KV) — a banned account keeps these. Browse is a STATIC feed (no gated endpoint). NEWS is a gated
 *  Worker endpoint, now opened to ANY signed-in account INCLUDING banned by the SOW-077 Phase 2 read-gate
 *  (the Worker's authorizeSignedIn), so canSeeNews matches canBrowse (the READ tier). Following channels / news-prefs
 *  (the KV write) stay on the CURATE tier below (canFollow/canSave), which excludes banned. */
export function canBrowse(membership) { return READ_TIER.has(membership); }
export function canSeeNews(membership) { return READ_TIER.has(membership); }
// SOW-018/078: who may see the MEMBER-only Shares stream (and member-visibility comment stubs) — an active trial
// may READ, a paid member fully. Mirrors client-ui/all-merge.mjs canSeeShares (the browser copy) and the Worker
// decrypt's READ_TRIAL_OK; kept in lockstep. Used HOST-side to filter member Share/comment stubs out of the list
// responses for any caller below this tier, so the raw list ops cannot be hit to harvest the members-only stream.
const SEE_SHARES_TIER = new Set(['paid', 'trialing']);
export function canSeeShares(membership) { return SEE_SHARES_TIER.has(membership); }
/** CURATE / KV perks (write the member's own record) — a banned account loses these (it always has, via FREE_TIER). */
export function canFollow(membership) { return FREE_TIER.has(membership); }
export function canSave(membership) { return FREE_TIER.has(membership); }

// SOW-018: a "Locked" account is a member whose access has LAPSED (expired trial, cancelled, banned, or no
// record). The extension shows a lock splash for these. Deliberately EXCLUDES 'trialing' (an active trial may
// read), 'paid', and 'unknown' (the status oracle is unreachable — fail OPEN so a paid member is never wrongly
// locked; the Worker remains the real authority for decrypting/publishing).
const LOCKED_MEMBERSHIP = new Set(['expired', 'cancelled', 'none', 'banned']);

/** Whether a membership value is a LOCKED (lapsed) account that should see the extension lock splash. */
export function isLockedMembership(membership) {
  return LOCKED_MEMBERSHIP.has(membership);
}

// SOW-077: the new-tab READ tier (free / lapsed) now BROWSES read-only instead of hitting the old full-screen renew
// wall, and sees a non-blocking upgrade prompt. Returns the prompt KIND, or null for everyone who should see NO prompt:
//   'join'  -> a never-subscribed free account ('none').
//   'renew' -> a lapsed account ('expired' | 'cancelled').
//   null    -> paid / trialing (active), 'banned' (a ban is NOT lifted by paying; ban > Stripe), and 'unknown'
//              (the status oracle is unreachable -> fail open, do not nag a possibly-paid member).
export function upgradePromptKind(membership) {
  if (membership === 'none') return 'join';
  if (membership === 'expired' || membership === 'cancelled') return 'renew';
  return null;
}

/** Whether a membership value is a KNOWN non-paid status (so the publish is blocked, not merely unverified). */
export function isBlockedFromPublishing(membership) {
  return NON_PUBLISHABLE.has(membership);
}

/**
 * Fetch the member's Stripe-derived status from the signup Worker (the one Stripe oracle; the client holds
 * no Stripe key). Returns 'paid'|'trialing'|'expired'|'cancelled'|'none', or 'unknown' on any error so the
 * client fails OPEN to the gate rather than wrongly blocking a paid member when the oracle is unreachable.
 */
export async function fetchStripeStatus({ token, signupBase, fetch = globalThis.fetch } = {}) {
  if (!token || !signupBase) return { status: 'unknown', effectiveStatus: 'unknown', couponUntil: null, paidTier: 'none' };
  try {
    const res = await fetch(`${String(signupBase).replace(/\/$/, '')}/membership/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { status: 'unknown', effectiveStatus: 'unknown', couponUntil: null, paidTier: 'none' };
    const data = await res.json();
    // SOW-119 QA: couponUntil is the grant end date the oracle emits ONLY when the paid signal is a coupon
    // grant (never for a real subscription); it drives the extension expiry countdown.
    // sow-185: paidTier (none|member|creator) is the Worker's authoritative, override-aware tier for this
    // caller (resolveEffectiveTier over the KV mirror). The client TRUSTS it and never re-derives the tier
    // itself (that needs the Stripe price map, held server-side); fail closed to 'none' for an older Worker.
    // sow-213 R2: effectiveStatus is the Worker's SERVER-SIDE fold of ban > staff > grandfather > Stripe over
    // the KV overrides mirror (the same value the gate decides on). The client trusts it instead of re-reading
    // house/bans.yml + house/grandfathered.yml, which have left the public repo. Fail closed to 'unknown' for an
    // older Worker that omits it, which resolveMembership then treats as the fail-open non-banned/non-paid view.
    return { status: data?.status ?? 'unknown', effectiveStatus: typeof data?.effectiveStatus === 'string' ? data.effectiveStatus : 'unknown', couponUntil: data?.couponUntil ?? null, paidTier: typeof data?.paidTier === 'string' ? data.paidTier : 'none' };
  } catch {
    return { status: 'unknown', effectiveStatus: 'unknown', couponUntil: null, paidTier: 'none' };
  }
}

/**
 * Resolve the effective membership at login. Returns { stripeStatus, membership, couponUntil, paidTier } for the
 * host to cache. Pure over the injected fetch, so it is unit-tested with fakes.
 *
 * sow-213 R2: this USED TO fetch the Stripe status from the Worker AND read house/bans.yml + house/
 * grandfathered.yml (and roles.yml) via the host reader, folding the ban > staff > grandfather > Stripe
 * precedence locally. Those two person-keyed files left the public repo for the KV mirror (a public repo cannot
 * satisfy erasure), so the client can no longer read them, and it does not need to: the Worker's
 * /membership/status already folds that precedence SERVER-SIDE over the mirror and returns it as
 * `effectiveStatus` on THIS SAME response. So we trust the value the server already sent instead of duplicating
 * the fold. roles.yml stays git-native but is not read here either, because effectiveStatus already folds staff.
 *
 * FAIL-OPEN, AND IT IS SAFE ONLY BECAUSE THE GATE REPEATS THE CHECK. If the Worker is unreachable
 * fetchStripeStatus returns effectiveStatus 'unknown', so this resolves to a non-banned, non-paid view. That is
 * a UX courtesy (block publish early, show a lock), NEVER the security boundary: every real action re-checks
 * server-side, publish through the SOW-005 PR gate and decrypt/encrypt through the Worker's effective-paid gate
 * on the live mirror. Do NOT "harden" this to fail closed, and do NOT let anything trust this client view for a
 * decision the gate does not repeat: the moment something does, this stops being defensible.
 *
 * `readFile` and `now` are still accepted so the hosts that inject a repo reader do not have to change, but
 * sow-213 no longer reads any override file or re-derives a date here. Both are candidates for removal once no
 * client path folds bans/grandfathered locally.
 */
export async function resolveMembership({ githubId, token, signupBase, readFile, fetch = globalThis.fetch, now = Date.now() } = {}) {
  const { status: stripeStatus, effectiveStatus, couponUntil: workerCouponUntil, paidTier: workerPaidTier } = await fetchStripeStatus({ token, signupBase, fetch });
  // effectiveStatus is the Worker's server-folded value; 'unknown' is its "did not fold / unavailable" sentinel.
  // Fall back to the Stripe status for it: an older Worker that omits effectiveStatus still sends its Stripe
  // status, and when the Worker is unreachable BOTH are 'unknown' so this stays 'unknown' (the fail-open view).
  const membership = (effectiveStatus && effectiveStatus !== 'unknown') ? effectiveStatus : (stripeStatus || 'unknown');
  // SOW-119 QA: the coupon-grant end date drives the extension expiry countdown, and it is the Worker's to emit
  // (only when a coupon grant is the paid source). sow-213 removed the local git-grandfather fallback along with
  // the grant read, so this is purely the oracle value now; a ban suppresses it.
  const couponUntil = membership === 'banned' ? null : (workerCouponUntil ?? null);
  // sow-185: the Worker's authoritative paid TIER, carried through; a ban forces it to none (the real creator
  // gate is authorizeCreator server-side). Any Worker error already resolved workerPaidTier to 'none'.
  const paidTier = membership === 'banned' ? 'none' : (workerPaidTier ?? 'none');
  return { stripeStatus, membership, couponUntil, paidTier };
}
