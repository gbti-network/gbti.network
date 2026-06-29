// SOW-059 P1c (Phase B): freeze + persist the attribution snapshot at the PAID conversion. The signup Worker cannot
// read git, so it freezes the MINIMAL attribution (first/last-touch owners + items + invite + conversionAt + window);
// the collaboration POINTS are tallied later by the offline payout job from git (the items + window are pinned at the
// conversion instant, so that later gather is deterministic and equivalent to freezing them now).
//
// Storage: KV `conv:<github_id>` in SIGNUP_KV, written ONCE per member (absent-only) and holding GITHUB_IDS ONLY (no
// username/email/login) plus content type/slug pointers, so erasing a member is a clean find-and-clear (the snapshot
// is NEVER persisted to immutable git, which would regress erasability vs the points-ledger it replaces). Frozen once,
// only eligibility is re-applied at payout, so a later ban/refund changes WHO is paid, never the frozen attribution.
import { readTouches, eraseTouches } from './membership-touches.mjs';
import { freezeSnapshot } from '../../membership/conversion-snapshot.mjs';

export const CONV_KEY = (githubId) => `conv:${githubId}`;
export const ATTRIBUTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // the 90-day attribution window

/**
 * Freeze + persist the attribution snapshot for a paid conversion. Flag-gated (TOUCH_CAPTURE_ENABLED) and idempotent
 * (absent-only write). FAIL-SOFT by contract: the webhook caller wraps this so a failure never blocks the Discord
 * role swap. `customer` = the Stripe Customer (its metadata carries github_id, touch_session, and referred_by).
 * `conversionAt` = the invoice paid timestamp in ms (NOT now: the 90-day window is measured back from it).
 */
export async function freezeAndPersist({ env, customer, conversionAt, kv = env?.SIGNUP_KV, now = Date.now }) {
  if (!kv || env?.TOUCH_CAPTURE_ENABLED !== 'true') return { persisted: false, reason: 'disabled' };
  const githubId = customer?.metadata?.github_id ? String(customer.metadata.github_id) : null;
  if (!githubId) return { persisted: false, reason: 'no_github_id' };

  const key = CONV_KEY(githubId);
  // Absent-only: a conversion freezes ONCE. Essential because the webhook can re-deliver BEFORE evt:<id> is marked
  // seen (markEventSeen only fires after the whole handler succeeds), so a retry must find the snapshot already there.
  const existing = await kv.get(key);
  if (existing) return { persisted: false, reason: 'already_frozen' };

  const session = customer?.metadata?.touch_session || '';
  const touchRecord = session ? await readTouches(env, session, { kv }) : null;

  // The invite lane: prefer the self-rejected referred_by (set + self-checked at signup) and fall back to the touch
  // store's first-wins invite. A self-invite (inviter === the converting member) is rejected here too (defense in
  // depth: referred_by is already self-rejected, but the touch invite is not).
  let inviter = (customer?.metadata?.referred_by || (touchRecord && touchRecord.invite) || null);
  if (inviter && String(inviter) === githubId) inviter = null;

  const at = Number.isFinite(conversionAt) ? conversionAt : now();
  const snapshot = freezeSnapshot({
    touchRecord,
    conversionAt: at,
    windowMs: ATTRIBUTION_WINDOW_MS,
    collaborationEvents: [], // tallied at payout from git, bounded to the frozen items + conversionAt
    inviter,
  });
  // SOW-059 payout-audit fix (HIGH): a converting member must NEVER be their own payout recipient. The invite lane is
  // self-rejected above; mirror that for the content lane (first/last-touch owner + their items) by scrubbing the
  // converting member out of their own snapshot. scrubCounterpart nulls those owners -> the share falls to retained
  // (money-safe). Collaboration self-pay is closed separately at payout (the splitInvoice member guard), since the
  // 5% points are tallied from git there, not frozen here.
  const record = { v: 1, member: githubId, ...snapshot, frozenAt: now() };
  const selfScrubbed = scrubCounterpart(record, githubId) || record;
  await kv.put(key, JSON.stringify(selfScrubbed));

  // The pre-signup behavioral touch record is consumed; clear it (GDPR data minimization). Best-effort.
  if (session) { try { await eraseTouches(env, session, { kv }); } catch { /* self-expires anyway */ } }

  return { persisted: true, member: githubId, record: selfScrubbed };
}

/** Read a member's frozen snapshot (for the payout job). Null when absent. */
export async function readSnapshot(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv || !githubId) return null;
  return kv.get(CONV_KEY(String(githubId)), 'json');
}

/** SOW-024 right-to-erasure: hard-delete a member's OWN conversion snapshot. */
export async function eraseSnapshot(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv || !githubId) return { ok: false };
  await kv.delete(CONV_KEY(String(githubId)));
  return { ok: true };
}

/**
 * Pure: scrub an erased member's github_id wherever it appears as a COUNTERPART in someone else's frozen snapshot
 * (first/last owner, inviter, an item owner, or a collaboration recipient). Returns the cleaned record, or null if
 * the record did not reference the erased member (nothing to write back). The payout job treats a null owner/inviter
 * as ineligible -> that share falls to retained, so scrubbing is also money-safe.
 */
export function scrubCounterpart(record, erasedId) {
  if (!record || !erasedId) return null;
  const id = String(erasedId);
  let changed = false;
  const out = { ...record };
  for (const k of ['firstOwner', 'lastOwner', 'inviter']) {
    if (out[k] != null && String(out[k]) === id) { out[k] = null; changed = true; }
  }
  for (const k of ['firstItem', 'lastItem']) {
    if (out[k] && out[k].owner != null && String(out[k].owner) === id) { out[k] = { ...out[k], owner: null }; changed = true; }
  }
  if (Array.isArray(out.points)) {
    const kept = out.points.filter((p) => p && String(p.member) !== id);
    if (kept.length !== out.points.length) { out.points = kept; changed = true; }
  }
  return changed ? out : null;
}
