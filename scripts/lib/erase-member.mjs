// SOW-024: the right-to-erasure tool library. Erasing a member is now AUTO-DRIVEN for the safe, reversible
// moves and the per-member edge-store keys, with the irreversible moves (Stripe delete, content REMOVAL,
// crypto-shred) kept deliberately gated. On --apply the orchestrator (runErasure) performs:
//   - the per-member KV deletes: activity:<id> (favorites+collections), follows:<id> (the follow graph),
//     gh:<id> (the Stripe-customer lookup cache);
//   - Discord: removes the member's managed roles (Member/Trial/Locked);
//   - content: ONE auto-merged PR that flips the member's content -> draft AND removes their members-index
//     entry (reversible; git history persists, disclosed in the TOS);
//   - Stripe customer delete ONLY when --delete-stripe is explicitly passed (irreversible; tax-retention).
// Crypto-shred (the global SOW-016 key rotation) and de-index stay manual. Every step is identity-minimally
// recorded to the deletable erasure audit log (scripts/lib/erase-audit.mjs).
//
// Pure + injectable (env + fetch + clients), so each piece is unit-tested with fakes (no network, no secrets).
// The CF KV REST calls live in ./kv-rest.mjs, which mirrors scripts/lib/kv-mirror.mjs.
//
// Split at the 900-line cap (2026-09-30). This file keeps the per-member KV steps, the plan (planErasure), the
// orchestrator (runErasure) and its step list. The KV REST helpers moved to ./kv-rest.mjs, the mail and digest
// erasure to ./erase-mail.mjs, and the git content erasure to ./erase-content.mjs. Every name this file exported
// before the split is still exported from here, so no caller has to change its import.

import { buildAuditRecord, storeAuditRecord } from './erase-audit.mjs';
import { INVITE_KEY_PREFIX } from '../../membership/invites.mjs'; // sow-231 Phase 2
import { scrubOpener } from '../../membership/news-opens.mjs'; // SOW-111: per-item news detail-open sets
import { scrubCounterpart } from '../../workers/signup/conversion-snapshot-store.mjs'; // SOW-059 P1c
import { couponGrantKey } from '../../workers/signup/coupons.mjs'; // SOW-119 / sow-212: the one-per-member lock
import { redemptionKey, redemptionCountKey } from '../../membership/coupons.mjs'; // SOW-119 key builders
import { listCouponRedemptions } from './coupon-grants.mjs';
import { couponLockKey, COUPON_LOCK_VALUE } from '../../membership/coupon-lock.mjs'; // sow-212: the minimized lock
import { FOLLOWERS_KEY, normalizeFollowers, applyFollower } from '../../membership/member-followers.mjs'; // SOW-186 phase 3
import { readPlaced as readShoptalkPlaced, writePlaced as writeShoptalkPlaced, readSeen as readShoptalkSeen, writeSeen as writeShoptalkSeen, OPTOUT_PREFIX as SHOPTALK_OPTOUT_PREFIX } from './shoptalk-state.mjs'; // sow-314
import { seriesFromInstances, isSeriesProblem } from '../../membership/shoptalk-series.mjs'; // sow-314
import { createGoogleCalendarClient } from '../../clients/google-calendar.mjs'; // sow-314
import { SHOPTALK_QUERY as SHOPTALK_SERIES_QUERY } from './shoptalk-sweep.mjs'; // sow-314: one definition of the search, shared with the sweep
import { erasePreparedListings } from './erase-prepared-listings.mjs'; // sow-427: its own module (this file was over the cap)
import { deleteKvKey, listKvByPrefix, putKvValue, readKvValueStrict } from './kv-rest.mjs';
import { eraseMailRecords } from './erase-mail.mjs';
import { eraseContent } from './erase-content.mjs';
export { deleteKvKey, listKvByPrefix, putKvValue, readKvValueStrict, readKvValue, kvRestShim } from './kv-rest.mjs';
export { findMemberSubscriberHashes, eraseMailRecords } from './erase-mail.mjs';
export { eraseContent, MEMBERS_INDEX_PATH } from './erase-content.mjs';

export const ACTIVITY_KEY = (githubId) => `activity:${githubId}`;
export const FOLLOWS_KEY = (githubId) => `follows:${githubId}`; // SOW-023 subscription graph
export const NOTIFICATIONS_KEY = (githubId) => `notifications:${githubId}`; // SOW-150/186 per-member notification store
export const DRAFTS_KEY = (githubId) => `drafts:${githubId}`; // SOW-157 hosted draft staging
export const DRAFT_IMAGES_PREFIX = (githubId) => `draftimg:${githubId}:`; // staged image bytes, one key per image per draft
export const PREFS_KEY = (githubId) => `prefs:${githubId}`; // SOW-046 member prefs (categories + followed news channels)
export const LOOKUP_KEY = (githubId) => `gh:${githubId}`; // the github_id -> Stripe customer_id lookup cache
export const CONV_SNAPSHOT_KEY = (githubId) => `conv:${githubId}`; // SOW-059 P1c: the frozen conversion attribution snapshot
// SOW-119 coupon lock. Delegates to the canonical builder rather than restating `coupon-grant:<id>`: a
// duplicated key literal is exactly how two halves of this system have drifted before.
export const COUPON_GRANT_KEY = (githubId) => couponGrantKey(String(githubId));

/** Hard-delete a member's activity (favorites + collections) from the deletable edge store. */
export async function eraseActivity({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: ACTIVITY_KEY(String(githubId)), env, fetchImpl });
}

/** Hard-delete a member's OUTBOUND follow graph (SOW-023) from the deletable edge store. Inbound follows
 *  (others following this member) self-heal: the feed drops a followed username with no published profile. */
export async function eraseFollows({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: FOLLOWS_KEY(String(githubId)), env, fetchImpl });
}

/** Hard-delete a member's prefs (SOW-046: category interests + followed news channels) from the deletable store. */
/**
 * sow-314 right-to-erasure: take the member OFF the Saturday Shop Talk event. This is the one erasure step that
 * reaches a system this project does not own (the owner's Google Calendar guest list), so it is the step that
 * makes the feature lawful to run at all: enrollment put an address there, erasure must take it away.
 *
 * Three things, in this order: (1) delete the opt-out marker shoptalk:optout:<id>; (2) find every address the
 * placed record attributes to this github_id; (3) if any, remove them from the series' guest list (Google mails
 * the un-invite), then drop them from shoptalk:placed so the sweep never re-adds or "removes" them again.
 *
 * FAILS CLOSED without calendar credentials when there is something to remove: the placed record is left
 * exactly as it is, so the next reconcile with credentials can still see the seat, and the audit shows an
 * ERROR rather than a silent "skipped" over an address that is still on the event.
 */
export async function eraseShoptalk({ githubId, env = process.env, fetchImpl = globalThis.fetch, calendar = null } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const id = String(githubId);
  const opt = await deleteKvKey({ key: `${SHOPTALK_OPTOUT_PREFIX}${id}`, env, fetchImpl });
  // The seen record (rule 5) holds the member's address keyed to their id: personal data, scrubbed here. Read
  // fail-closed like the placed record; an unreadable record is reported, never overwritten.
  const seenRead = await readShoptalkSeen({ env, fetchImpl });
  if (!seenRead.ok) return { ok: false, reason: `shoptalk: ${seenRead.reason}`, optOutDeleted: opt?.ok === true };
  const mineSeen = [...seenRead.seen.entries()].filter(([, who]) => who === id).map(([address]) => address);
  if (mineSeen.length) {
    for (const address of mineSeen) seenRead.seen.delete(address);
    const wroteSeen = await writeShoptalkSeen(seenRead.seen, { env, fetchImpl });
    if (wroteSeen && wroteSeen.ok === false) return { ok: false, reason: 'shoptalk: the seen record could not be rewritten', optOutDeleted: opt?.ok === true };
  }
  const placedRead = await readShoptalkPlaced({ env, fetchImpl });
  if (!placedRead.ok) return { ok: false, reason: `shoptalk: ${placedRead.reason}`, optOutDeleted: opt?.ok === true, seenScrubbed: mineSeen.length };
  const mine = [...placedRead.placed.entries()].filter(([, who]) => who === id).map(([address]) => address);
  if (!mine.length) return { ok: true, skipped: true, reason: 'not on the Shop Talk placed record', matched: 0, optOutDeleted: opt?.ok === true, seenScrubbed: mineSeen.length };
  const cal = calendar ?? (
    env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET && env.GOOGLE_CALENDAR_REFRESH_TOKEN
      ? createGoogleCalendarClient({
        clientId: env.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
        refreshToken: env.GOOGLE_CALENDAR_REFRESH_TOKEN, calendarId: env.GOOGLE_CALENDAR_ID || 'primary', fetch: fetchImpl,
      })
      : null
  );
  if (!cal) return { ok: false, reason: `shoptalk: GOOGLE_CALENDAR_* not set, so ${mine.length} address(es) stay on the event; the placed record was left untouched for the next run that has credentials`, matched: mine.length };
  const series = seriesFromInstances(await cal.nextOccurrences(SHOPTALK_SERIES_QUERY));
  if (isSeriesProblem(series)) return { ok: false, reason: `shoptalk: ${series.problem}; ${mine.length} address(es) stay on the event`, matched: mine.length };
  const guests = (await cal.listAttendees(series.seriesId)) || [];
  const next = guests.filter((g) => !mine.includes(g));
  if (next.length !== guests.length) await cal.setAttendees(series.seriesId, next, { sendUpdates: 'all' });
  for (const address of mine) placedRead.placed.delete(address);
  const wrote = await writeShoptalkPlaced(placedRead.placed, { env, fetchImpl });
  if (wrote && wrote.ok === false) return { ok: false, reason: 'shoptalk: the address left the event but the placed record could not be rewritten; the next sweep will report it', matched: mine.length, removedFromEvent: next.length !== guests.length };
  return { ok: true, matched: mine.length, removedFromEvent: next.length !== guests.length, optOutDeleted: opt?.ok === true, seenScrubbed: mineSeen.length };
}

export async function erasePrefs({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: PREFS_KEY(String(githubId)), env, fetchImpl });
}

/** SOW-150/186 right-to-erasure: hard-delete the member's INBOUND notification store (mentions + followed-author
 *  publishes addressed to them). Per-recipient, keyed by their own github_id, so this is a computed-key delete
 *  like activity/follows. The follow GRAPH that produced these (who they follow, and their entry in others'
 *  reverse follower index) is erased separately (eraseFollows + eraseReverseFollows, SOW-186 phase 3). */
export async function eraseNotifications({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: NOTIFICATIONS_KEY(String(githubId)), env, fetchImpl });
}

/**
 * SOW-186 phase 3 (REWORKED 2026-08-22) right-to-erasure, BOTH directions of the github_id-keyed reverse
 * follower index (followers:<github_id>):
 *   - AS A FOLLOWED TARGET: delete followers:<github_id> (the inbound index keyed by the erased member's own id
 *     -- who follows them). The follower github_ids in it are OTHER members' data, preserved in their own
 *     forward follows: lists (the source of truth), so deleting this derived index loses nothing recoverable.
 *   - AS A FOLLOWER: scrub the member's github_id from every followers:<G> set they appear in (the "id follows
 *     G" reflection). This also stops a followed author's next publish from re-creating a notifications:<id> for
 *     the erased member. Resolution-FREE prefix scan over followers:* (mirrors the news-opens step) -- the reworked
 *     index is keyed by github_id, and erasure holds only the member's own id, not the followed members' ids,
 *     so a scan is how it finds them WITHOUT the username->github_id resolution the rework deliberately removed.
 *
 * No follows:<github_id> read, so there is NO ordering dependency on the `follows` step (unlike the retired
 * username-keyed version). reconcile's full recompute is the periodic backstop that also drops the id; this makes
 * the erasure PROMPT. Reported no-op without CF creds.
 */
export async function eraseReverseFollows({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const accountId = env.CF_ACCOUNT_ID, namespaceId = env.CF_KV_NAMESPACE_ID, apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return { skipped: true, reason: 'CF creds not set' };
  const id = String(githubId);

  // AS A FOLLOWED TARGET: delete the member's own inbound follower list (github_id-keyed now).
  let inboundDeleted = false;
  let inboundUnreadable = false;
  const inboundKey = FOLLOWERS_KEY(id);
  // Strict: a failed read here used to look exactly like "no such record", so a transient 500 left the member's
  // own follower list in place and the step reported the same numbers as a run where it was never there.
  const inbound = await readKvValueStrict({ key: inboundKey, env, fetchImpl });
  if (!inbound.ok) inboundUnreadable = true;
  else if (inbound.value !== null) {
    await deleteKvKey({ key: inboundKey, env, fetchImpl });
    inboundDeleted = true;
  }

  // AS A FOLLOWER: scrub the id from every OTHER member's follower set. followers:* is keyed by TARGET, so the
  // per-member deletes above do not reach it; a prefix scan is the resolution-free way to find + remove it.
  const listed = await listKvByPrefix({ prefix: 'followers:', env, fetchImpl });
  let outboundScrubbed = 0;
  for (const { key, value } of (listed.available ? listed.entries : [])) {
    if (key === inboundKey) continue; // already deleted above
    const before = normalizeFollowers(value);
    const after = applyFollower(before, { githubId: id, on: false });
    if (after.followers.length !== before.followers.length) {
      await putKvValue({ key, value: JSON.stringify(after), env, fetchImpl });
      outboundScrubbed++;
    }
  }
  const scanNote = incompleteScan(listed, 'followers:');
  const note = inboundUnreadable
    ? { incomplete: true, unreadable: (scanNote?.unreadable ?? 0) + 1, reason: `the member's own ${inboundKey} could not be read and was NOT deleted${scanNote ? `; ${scanNote.reason}` : ''}` }
    : scanNote;
  return { scrubbed: outboundScrubbed + (inboundDeleted ? 1 : 0), outboundScrubbed, inboundDeleted, ...(note || {}) };
}

/** Hard-delete a member's hosted draft store (SOW-157: staged authoring state, may contain unpublished text). */
export async function eraseDrafts({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: DRAFTS_KEY(String(githubId)), env, fetchImpl });
}

/**
 * Hard-delete a member's STAGED IMAGE bytes (`draftimg:<github_id>:<type>:<slug>:<file>`, one key per image).
 *
 * Swept by PREFIX, so it reaches every key shape the store has ever written, including the pre-item
 * `draftimg:<github_id>:<file>` keys that predate the per-draft scoping.
 *
 * A separate step from eraseDrafts because it is a separate keyspace: the bytes could not live inside the draft
 * record (a draft is capped at 150,000 bytes, one image may be 1,048,576), so they sit beside it under their own
 * prefix. It is unpublished member-authored content exactly as a draft is, and a per-member store the erasure
 * runbook did not know about would be a right-to-erasure hole.
 *
 * Fail-closed on the listing: listKvByPrefix throws on a failed page rather than returning a short list, so a
 * partial sweep cannot be reported as a complete one.
 */
export async function eraseDraftImages({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listKvByPrefix({ prefix: DRAFT_IMAGES_PREFIX(String(githubId)), env, fetchImpl, keysOnly: true });
  if (!listed.available) return { available: false, reason: listed.reason, deleted: 0 };
  let deleted = 0;
  for (const key of listed.keys) {
    const r = await deleteKvKey({ key, env, fetchImpl });
    if (r?.deleted !== false) deleted++;
  }
  return { available: true, deleted, scanned: listed.keys.length };
}

/** Hard-delete the github_id -> Stripe customer_id lookup cache (`gh:<github_id>`). It is per-member identity
 *  data; after a Stripe delete it would dangle, and even without one it maps the member to their billing record,
 *  so it is part of the erasure set. A signup re-resolves via Stripe Search if the member ever returns. */
export async function eraseLookupCache({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: LOOKUP_KEY(String(githubId)), env, fetchImpl });
}

/**
 * The shared refusal for a scan-and-scrub erasure step. `listKvByPrefix` reports the keys it could not read, and
 * each of those is a record that MAY name this member and was NOT scrubbed. A step's own count says only what it
 * DID change, so without this the audit record cannot tell "there was nothing to scrub" from "we could not look".
 * Only `unreadable` triggers it: an `unparsed` value was read successfully and simply is not the shape this step
 * scrubs, which is schema drift rather than a blind spot.
 */
function incompleteScan(listed, prefix) {
  if (!listed?.unreadable) return null;
  const total = listed.keys?.length ?? 0;
  return {
    incomplete: true,
    unreadable: listed.unreadable,
    reason: `${listed.unreadable} of ${total} ${prefix}* record(s) could not be read and were NOT scrubbed`,
  };
}

/**
 * SOW-111 GDPR: scrub the member's github_id from every per-item news detail-open set (`news-opens:*`). These
 * sets are keyed by news guid (not by member), so the per-member activity: delete does not reach them.
 * Mirrors the news-opens step (list -> scrub -> write back). Reported no-op without CF creds.
 */
export async function eraseNewsOpens({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listKvByPrefix({ prefix: 'news-opens:', env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  let scrubbed = 0;
  for (const { key, value } of listed.entries) {
    const { record, changed } = scrubOpener(value, String(githubId));
    if (changed) {
      await putKvValue({ key, value: JSON.stringify(record), env, fetchImpl });
      scrubbed++;
    }
  }
  return { scrubbed, ...(incompleteScan(listed, 'news-opens:') || {}) };
}

/**
 * SOW-119 / sow-212: hard-delete the raw coupon grant `coupon-grant:<githubId>`.
 *
 * NOT used by erasure. The owner ruled on 2026-08-11 that the one-coupon-per-member lock SURVIVES an
 * erasure, so erasure calls minimizeCouponGrant below instead. This outright delete exists for the sow-212
 * TEST RESET, where the whole point is to make a disposable account redeemable again.
 *
 * The two are deliberately separate functions rather than one function with a flag: "erase this person" and
 * "make this test account reusable" are different intents, and a boolean parameter is how they would end up
 * confused at a call site.
 */
export async function eraseCouponGrant({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: couponGrantKey(String(githubId)), env, fetchImpl });
}

/** sow-212: delete the MINIMIZED lock too. Test-reset only, for an account erased before it was reset. */
export async function eraseCouponLock({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const key = await couponLockKey(env.COUPON_LOCK_KEY, githubId);
  if (!key) return { skipped: true, reason: 'COUPON_LOCK_KEY not set (cannot compute the lock key)' };
  return deleteKvKey({ key, env, fetchImpl });
}

/**
 * SOW-119 / erasure: MINIMIZE the coupon grant instead of deleting it.
 *
 * Owner ruling, 2026-08-11: the lock stays, because deleting it would let an erased account redeem the same
 * coupon again. SecurityMaster's minimization branch reconciles that with Article 17: write a keyed HASH of
 * the github_id (membership/coupon-lock.mjs), then delete the raw-id record. The lock keeps working; the
 * stored artifact stops being a direct identifier.
 *
 * ORDER IS LOAD-BEARING: write the hashed lock FIRST, delete the raw record second. If the process dies
 * between the two, the failure mode is a duplicated lock (harmless, both deny) rather than no lock at all
 * (which silently restores the abuse the owner asked us to prevent).
 *
 * FAIL CLOSED WITHOUT THE SALT: with no COUPON_LOCK_KEY there is no way to write a lock that redeemCoupon
 * could later find, so this does NOT delete the raw record. Reported as skipped with the reason, never a
 * silent pass: leaving identifying data in place is the lesser harm against restoring a coupon exploit, and
 * an operator who sees the skip can provision the key and re-run.
 */
export async function minimizeCouponGrant({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const lockKey = await couponLockKey(env.COUPON_LOCK_KEY, githubId);
  if (!lockKey) {
    return { skipped: true, reason: 'COUPON_LOCK_KEY not set: raw coupon-grant KEPT rather than delete the one-per-member lock' };
  }
  // Strict: "we could not read the grant" must not be reported as "there is no grant to minimize", or a transient
  // failure silently leaves identifying coupon data in place while the run records the step as a clean skip.
  const existing = await readKvValueStrict({ key: couponGrantKey(String(githubId)), env, fetchImpl });
  if (!existing.ok) {
    return { incomplete: true, unreadable: 1, reason: 'coupon grant could not be read, so it was NOT minimized; re-run' };
  }
  if (existing.value === null) return { skipped: true, reason: 'no coupon grant to minimize' };
  await putKvValue({ key: lockKey, value: COUPON_LOCK_VALUE, env, fetchImpl });
  return deleteKvKey({ key: couponGrantKey(String(githubId)), env, fetchImpl });
}

/**
 * SOW-119 / sow-212: delete every `redemption:<CODE>:<githubId>` record for this member and DECREMENT the
 * shared per-code counter `redemptions:<CODE>` for each one removed.
 *
 * Two things here are deliberate and easy to get wrong:
 *   - The redemption key carries the github_id in the KEY NAME, so it is person-keyed data in its own right
 *     (SecurityMaster, 2026-08-11), not merely a value holding an id.
 *   - The counter is SHARED ACROSS ALL MEMBERS and enforces a coupon's maxRedemptions. It is decremented,
 *     never deleted: deleting it would un-burn every other member's redemption and silently hand back
 *     capacity on a capped coupon. Clamped at zero so a repeated run cannot drive it negative.
 *
 * Reuses listCouponRedemptions (the canonical `redemption:` sweep) rather than re-deriving the key shape.
 * Reported no-op without CF creds, matching every other step here.
 */
export async function eraseCouponRedemptions({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listCouponRedemptions({ env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  const id = String(githubId);
  // KEY-ONLY on purpose (QAmaster, 2026-08-22). Erasure needs the code and the github_id, and BOTH are in the
  // key, so it must not filter `redemptions`: that list is built from records whose VALUE parsed and carried an
  // `until`, and a record dropped for either reason is one this member still has. Which failure is benign is a
  // property of the CONSUMER, not of the data: for the grant fold, a record it cannot parse is schema drift and
  // skipping it is right; for erasure, "read it and it was the wrong shape" ends exactly where "could not read
  // it" ends, with the record still sitting there. Filtering on the key match is immune to all of it.
  const mine = (listed.matches ?? []).filter((r) => String(r.githubId) === id);
  let scrubbed = 0;
  const unreadableCounters = [];
  for (const r of mine) {
    await deleteKvKey({ key: redemptionKey(r.code, id), env, fetchImpl });
    const countKey = redemptionCountKey(r.code);
    // MUST be a strict read. The old plain read collapsed a failed fetch to null, Number(null) || 0 is 0, and the
    // decrement then wrote "0" over a SHARED counter: one transient 500 reset a capped coupon to zero redemptions
    // and handed back its entire capacity, which is precisely the harm the note above says is being prevented.
    // Skipping the decrement leaves the counter one too HIGH, which under-grants capacity and is the safe side.
    const read = await readKvValueStrict({ key: countKey, env, fetchImpl });
    if (!read.ok) { unreadableCounters.push(r.code); continue; }
    const current = Number(read.value) || 0;
    await putKvValue({ key: countKey, value: String(Math.max(0, current - 1)), env, fetchImpl });
    scrubbed++;
  }
  const notes = [];
  if (unreadableCounters.length) notes.push(`redemption counter unreadable for ${unreadableCounters.join(', ')}: NOT decremented (left high rather than reset)`);
  // `listed.unreadable` is deliberately NOT reported here any more: since `mine` comes from the key match, a
  // record whose value could not be read is still deleted, so it no longer shortens this member's erasure.
  // An UNMATCHED key is different. It is under the redemption: prefix in a shape we do not recognise, so we
  // cannot tell whose it is, and one of them could be this member's.
  if (listed.unmatchedKeys) notes.push(`${listed.unmatchedKeys} key(s) under redemption: have an unrecognised shape and could not be attributed; one may belong to this member`);
  if (notes.length) {
    return { scrubbed, incomplete: true, unreadable: unreadableCounters.length + (listed.unmatchedKeys || 0), reason: notes.join('; ') };
  }
  return { scrubbed };
}

/**
 * sow-231 Phase 2: MINIMIZE the issued invites this member redeemed.
 *
 * WHY THIS NEEDS A SWEEP RATHER THAN A COMPUTED KEY. Every other record here is keyed by the github_id, so
 * erasure computes the exact key and deletes it. An invite is keyed by its CODE, and the member's id appears
 * only INSIDE the record as `redeemedBy`, so there is no key to compute. This mirrors eraseCouponRedemptions,
 * which has the same problem for the same reason and solves it by listing the prefix and filtering.
 *
 * MINIMIZED, NOT DELETED, per the standing owner ruling that the one-coupon-per-member lock survives erasure
 * while the identifying record does not. The invite must keep saying it was issued and used, or a superadmin
 * loses the audit trail of a seat they gave away and the campaign's own accounting silently changes. What is
 * removed is WHO used it: `redeemedBy` and `redeemedByLogin` are nulled, `redeemedAt` is kept because a date
 * with no person attached identifies nobody.
 *
 * The administration note is deliberately NOT touched here. It is superadmin-authored text about the
 * OUTREACH ("sent to the lead at X"), it may name a person, and it is exactly the sort of field an erasure
 * should consider. It is left because deciding that is the owner's call and quietly redacting an admin's
 * own note is not a decision a cleanup step should make on its own. Flagged in the SOW rather than done.
 */
export async function minimizeRedeemedInvites({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listKvByPrefix({ prefix: INVITE_KEY_PREFIX, env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  const id = String(githubId);
  let minimized = 0;
  // listKvByPrefix returns { key, value } with the value ALREADY PARSED. A record it could not READ is one that
  // may name this member and was not minimized, so it is carried out as `incomplete` rather than skipped quietly.
  for (const { key, value } of listed.entries ?? []) {
    if (String(value?.redeemedBy ?? '') !== id) continue;
    await putKvValue({ key, value: JSON.stringify({ ...value, redeemedBy: null, redeemedByLogin: null }), env, fetchImpl });
    minimized++;
  }
  return { minimized, ...(incompleteScan(listed, INVITE_KEY_PREFIX) || {}) };
}

/** Hard-delete the member's OWN frozen conversion snapshot (SOW-059: their attribution + invite/collaboration record). */
export async function eraseConversionSnapshot({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: CONV_SNAPSHOT_KEY(String(githubId)), env, fetchImpl });
}

/**
 * SOW-059 GDPR: scrub the member's github_id from every OTHER member's frozen snapshot where they appear as a
 * COUNTERPART (first/last-touch owner, an item owner, the inviter, or a collaboration recipient). The per-member
 * conv:<id> delete does not reach those. Nulling the id makes that share fall to retained at payout (money-safe).
 * Reported no-op without CF creds. Mirrors the news-opens step (list -> scrub -> write back).
 */
export async function scrubConversionSnapshots({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listKvByPrefix({ prefix: 'conv:', env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  const own = CONV_SNAPSHOT_KEY(String(githubId));
  let scrubbed = 0;
  for (const { key, value } of listed.entries) {
    if (key === own) continue; // their own record is deleted by eraseConversionSnapshot, not scrubbed
    const cleaned = scrubCounterpart(value, String(githubId));
    if (cleaned) { await putKvValue({ key, value: JSON.stringify(cleaned), env, fetchImpl }); scrubbed++; }
  }
  return { scrubbed, ...(incompleteScan(listed, 'conv:') || {}) };
}

/**
 * The ordered erasure runbook for a member (SOW-024). `auto: true` steps this tool performs on --apply; the
 * rest are the operator checklist (composed from reconcile + the SOW-016 rotation), printed so nothing is
 * silently skipped. Pure (returns data), so it is unit-tested.
 */
export function planErasure({ githubId, username } = {}) {
  const who = username ? `members/${username}/` : "the member's";
  return [
    { step: 'content', auto: true, tool: 'erase-member.mjs --apply', action: `Flip ${who} content status -> draft via an auto-merged PR (reversible; history persists), and remove their house/grandfathered.yml grant in the same PR.` },
    { step: 'coupon-grant', auto: true, tool: 'erase-member.mjs --apply', action: `MINIMIZE ${COUPON_GRANT_KEY(githubId)}: write a keyed-hash lock, then delete the raw-id record. The one-coupon-per-member lock SURVIVES erasure (owner ruling 2026-08-11); needs COUPON_LOCK_KEY.` },
    { step: 'coupon-redemptions', auto: true, tool: 'erase-member.mjs --apply', action: `Delete every redemption:<CODE>:${githubId} record (the id is in the key name) and decrement each shared redemptions:<CODE> counter.` },
    { step: 'draft-images', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete every ${DRAFT_IMAGES_PREFIX(githubId)}* key (staged image bytes for unpublished drafts).` },
    { step: 'activity', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete the edge-store keys ${ACTIVITY_KEY(githubId)} (favorites + collections) and ${FOLLOWS_KEY(githubId)} (the follow graph).` },
    // sow-313 follow-up: FOUR STEPS RAN AND THE PLAN NEVER LISTED THEM. `runErasure` called eraseFollows,
    // erasePrefs, eraseDrafts and minimizeRedeemedInvites while planErasure declared none of them, so the plan
    // under-reported what an erasure does for as long as those steps existed.
    //
    // The AUDIT record was never wrong: buildAuditRecord is fed the steps `runStep` accumulated, not the plan.
    // What was short is the PLAN, which is what a person reads BEFORE running it and what stands as the
    // written procedure. An erasure deleting somebody's follows, prefs and drafts while the documented
    // procedure mentions none of them is a gap in the description, not in the deletion.
    //
    // Found by diffing the two lists while removing a different pair of steps. A guard now holds them in
    // lockstep, because the same drift is otherwise invisible: nothing fails when the plan falls behind.
    { step: 'follows', auto: true, tool: 'erase-member.mjs --apply', action: `SOW-023: hard-delete the OUTBOUND follow graph (follows:${githubId}). Inbound follows self-heal, since the feed drops a followed username with no published profile.` },
    { step: 'prefs', auto: true, tool: 'erase-member.mjs --apply', action: `SOW-046: hard-delete the member's prefs (prefs:${githubId}: category interests + followed news channels).` },
    { step: 'shoptalk', auto: true, tool: 'erase-member.mjs --apply', action: `sow-314: remove the member's address from the Saturday Shop Talk event (a Google Calendar guest list this project does not own; Google mails the un-invite), drop it from shoptalk:placed, and delete shoptalk:optout:${githubId}. Fails closed without calendar credentials.` },
    { step: 'drafts', auto: true, tool: 'erase-member.mjs --apply', action: `SOW-157: hard-delete the hosted draft store (drafts:${githubId}), which may contain unpublished text.` },
    { step: 'prepared-listings', auto: true, tool: 'erase-member.mjs --apply', action: `sow-427: sweep invite-listing:* and invite:*. A prepared listing tied to github_id ${githubId}, redeemed by them or pending their claim, and never claimed, is DELETED with its images (invite-listing-img:<id>:*), and its invitation is revoked before its tie is removed. A listing they claimed keeps only the fact of the claim (the greeting name, title, slug, claimant fields and tie are nulled). Invites naming them as claimant, pending claimant or tied account have those fields nulled. Runs before redeemed-invites, which it reads.` },
    { step: 'redeemed-invites', auto: true, tool: 'erase-member.mjs --apply', action: `Minimize every invite this member redeemed (invite:*): null redeemedBy + redeemedByLogin, KEEP redeemedAt (a date with nobody attached identifies nobody). The superadmin administration note is deliberately left alone; redacting an admin's own outreach text is the owner's call, not a cleanup step's.` },
    { step: 'notifications', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete ${NOTIFICATIONS_KEY(githubId)} (SOW-150/186: the member's inbound notifications -- mentions + followed-author publishes).` },
    { step: 'reverse-follows', auto: true, tool: 'erase-member.mjs --apply', action: `SOW-186: delete ${FOLLOWERS_KEY(githubId)} (the inbound follower index) and scrub github_id ${githubId} from every followers:* set (a prefix scan, resolution-free). Follower github_ids survive in their own forward follows: lists; reconcile's full recompute is the periodic backstop.` },
    { step: 'lookup-cache', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete the lookup-cache key ${LOOKUP_KEY(githubId)} (github_id -> Stripe customer_id).` },
    { step: 'news-opens', auto: true, tool: 'erase-member.mjs --apply', action: `Scrub github_id ${githubId} from every per-item news detail-open set (news-opens:*, SOW-111).` },
    { step: 'conv-snapshot', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete the member's frozen conversion snapshot ${CONV_SNAPSHOT_KEY(githubId)} (SOW-059).` },
    { step: 'conv-counterpart', auto: true, tool: 'erase-member.mjs --apply', action: `Scrub github_id ${githubId} from every OTHER member's frozen snapshot (conv:*) where they are a first/last-touch owner, inviter, or collaborator.` },
    { step: 'mail', auto: true, tool: 'erase-member.mjs --apply', action: `SOW-166: resolve the address from Stripe, compute the mail hash, then delete mail:subscriber:<hash> and every mail:send:<issue>:<hash>. The unsubscribe marker mail:suppress:<hash> SURVIVES (deleting it would silently re-contact someone who opted out). MUST run before the stripe step: after it, the address is gone and the hash can never be computed again.` },
    { step: 'discord', auto: true, tool: 'erase-member.mjs --apply', action: 'Remove the member\'s managed Discord roles (Member/Trial/Locked).' },
    { step: 'members-index', auto: true, tool: 'erase-member.mjs --apply', action: 'Remove the members-index.yml entry (bundled into the content erasure PR).' },
    { step: 'crypto-shred', auto: false, tool: 'scripts/rotate-member-key.mjs', action: 'Rotate the SOW-016 member-content key (global) so the public-history ciphertext becomes keyless.' },
    { step: 'stripe', auto: false, tool: 'erase-member.mjs --apply --delete-stripe (opt-in)', action: 'Delete the Stripe customer (IRREVERSIBLE; anonymize instead where tax-record retention applies).' },
    { step: 'kv-mirror', auto: false, tool: 'scripts/reconcile.mjs --apply', action: 'Re-run reconcile so the overrides mirror + derived status no longer reference the member.' },
    { step: 'de-index', auto: false, tool: 'manual', action: 'Best-effort: purge jsDelivr + request search-engine removal. Forks/archives are outside our control (disclosed in the TOS).' },
  ];
}

/** Reduce a step result to its identity-free audit outcome (no personal fields). outcome in
 *  deleted|removed|drafted|skipped|error. `detail` is a generic string (a reason or a count), never PII. */
/** Flatten the numbers a step reports into one audit-legible detail string. */
function stepCounts(res) {
  const bits = [];
  for (const k of ['scrubbed', 'minimized', 'matched', 'scanned', 'unreadable']) {
    if (typeof res?.[k] === 'number') bits.push(`${k}:${res[k]}`);
  }
  return bits.join(' ');
}

function summarizeStep(step, res) {
  if (res?.error) return { step, outcome: 'error', detail: String(res.error).slice(0, 120) };
  // Ranked ABOVE every success branch on purpose: a step that could not see the whole keyspace, or could not read
  // some of it, has not proven the records are gone. Recording that as `ok` would make the audit artifact claim
  // more than the run did, which is the one thing an erasure record must never do.
  if (res?.incomplete) return { step, outcome: 'incomplete', detail: [res.reason, stepCounts(res)].filter(Boolean).join(' ').slice(0, 200) };
  if (res?.skipped) return { step, outcome: 'skipped', detail: res.reason };
  if (res?.deleted === false) return { step, outcome: 'skipped', detail: res.reason };
  if (res?.deleted === true) return { step, outcome: 'deleted' };
  if (res?.deletedCustomer) return { step, outcome: 'deleted' };
  if (typeof res?.scrubbed === 'number') return { step, outcome: res.scrubbed ? 'deleted' : 'skipped', detail: res.scrubbed ? `votes:${res.scrubbed}` : 'none' };
  if (typeof res?.flipped === 'number') return { step, outcome: 'drafted', detail: `pr#${res.pr} flipped:${res.flipped} index:${res.indexRemoved ? 'removed' : 'kept'} grant:${res.grantRemoved ? 'removed' : 'kept'}` };
  if (Array.isArray(res?.removed)) return { step, outcome: res.removed.length ? 'removed' : 'skipped', detail: res.removed.length ? res.removed.join('+') : (res.reason || 'no roles held') };
  if (typeof res?.minimized === 'number') return { step, outcome: res.minimized ? 'deleted' : 'skipped', detail: stepCounts(res) };
  // eraseMailRecords reports matched/scanned rather than a scrub count; without this its normal run is a bare `ok`.
  if (typeof res?.matched === 'number') return { step, outcome: res.matched ? 'deleted' : 'skipped', detail: stepCounts(res) };
  return { step, outcome: 'ok' };
}

/**
 * Remove the member's managed Discord roles (Member/Trial/Locked). The discord_user_id is read from Stripe
 * metadata (it is never stored in our KV). Reported no-op when the Discord client, guild, or discord_user_id is
 * absent, or the member is not in the guild. Never throws on a single role removal (best-effort per role).
 */
export async function eraseDiscordRoles({ githubId, stripe = null, discord = null, env = process.env } = {}) {
  if (!discord) return { skipped: true, reason: 'no Discord client (set DISCORD_BOT_TOKEN)' };
  const guildId = env.DISCORD_GUILD_ID;
  if (!guildId) return { skipped: true, reason: 'DISCORD_GUILD_ID not set' };
  let discordUserId = null;
  if (stripe) {
    try {
      const c = await stripe.findCustomerByGithubId(String(githubId));
      discordUserId = c?.metadata?.discord_user_id ?? null;
    } catch { /* Stripe Search lag / error: treat as no id, skip */ }
  }
  if (!discordUserId) return { skipped: true, reason: 'no discord_user_id in Stripe metadata' };

  const roleIds = { member: env.DISCORD_MEMBER_ROLE_ID, trial: env.DISCORD_TRIAL_ROLE_ID, locked: env.DISCORD_LOCKED_ROLE_ID, creator: env.DISCORD_CREATOR_ROLE_ID }; // sow-185: also strip the Content-Creator badge on erasure
  let member = null;
  try { member = await discord.getMember(guildId, discordUserId); } catch { member = null; }
  if (!member) return { skipped: true, reason: 'member not in the guild (nothing to remove)' };
  const held = Array.isArray(member.roles) ? member.roles : [];
  const removed = [];
  for (const [name, id] of Object.entries(roleIds)) {
    if (id && held.includes(id)) {
      try { await discord.removeRole(guildId, discordUserId, id); removed.push(name); } catch { /* best-effort per role */ }
    }
  }
  return { removed };
}

/**
 * IRREVERSIBLE: delete the member's Stripe customer (removes the email + all metadata). Only invoked behind the
 * explicit --delete-stripe opt-in. Reported no-op without a Stripe client or a resolvable customer.
 */
export async function eraseStripeCustomer({ githubId, stripe = null } = {}) {
  if (!stripe) return { skipped: true, reason: 'no Stripe client (set STRIPE_SECRET_KEY)' };
  let customer = null;
  try { customer = await stripe.findCustomerByGithubId(String(githubId)); } catch (e) { return { error: e?.message || 'Stripe lookup failed' }; }
  if (!customer?.id) return { skipped: true, reason: 'no Stripe customer found (Search lag or already deleted)' };
  await stripe.deleteCustomer(customer.id);
  return { deletedCustomer: true };
}

/**
 * The erasure orchestrator. On --apply it runs the auto-driven steps (KV deletes, Discord, content+index),
 * optionally the irreversible Stripe delete, and records ONE identity-minimal audit entry. Each step is
 * fail-isolated: a thrown step is captured as an `error` outcome so the remaining steps still run and the audit
 * reflects exactly what happened. Returns { apply, steps, audit, record } (or { apply:false, plan } for dry-run).
 */
export async function runErasure({
  githubId, username = null, apply = false, deleteStripe = false, operator = null,
  env = process.env, fetchImpl = globalThis.fetch, clients = {}, files = [], now = new Date(),
} = {}) {
  if (!githubId) throw new Error('a github_id is required');
  if (!apply) return { apply: false, plan: planErasure({ githubId, username }) };

  const { stripe = null, github = null, discord = null } = clients;
  const steps = [];
  const runStep = async (name, fn) => {
    let res;
    try { res = await fn(); } catch (e) { res = { error: e?.message || String(e) }; }
    steps.push(summarizeStep(name, res));
    return res;
  };

  await runStep('activity', () => eraseActivity({ githubId, env, fetchImpl }));
  // SOW-186 phase 3: reads follows:<id>, so it MUST precede the follows delete below.
  await runStep('reverse-follows', () => eraseReverseFollows({ githubId, env, fetchImpl })); // SOW-186 phase 3 (reworked): github_id-keyed, no follows: read, so order-independent
  await runStep('follows', () => eraseFollows({ githubId, env, fetchImpl }));
  await runStep('notifications', () => eraseNotifications({ githubId, env, fetchImpl })); // SOW-150/186: inbound notification store
  await runStep('prefs', () => erasePrefs({ githubId, env, fetchImpl })); // SOW-046: categories + followed news channels
  await runStep('shoptalk', () => eraseShoptalk({ githubId, env, fetchImpl, calendar: clients.calendar ?? null })); // sow-314: the guest list we do not own
  await runStep('drafts', () => eraseDrafts({ githubId, env, fetchImpl })); // SOW-157: hosted draft staging
  await runStep('draft-images', () => eraseDraftImages({ githubId, env, fetchImpl })); // the staged image bytes beside those drafts
  await runStep('lookup-cache', () => eraseLookupCache({ githubId, env, fetchImpl }));
  await runStep('news-opens', () => eraseNewsOpens({ githubId, env, fetchImpl })); // SOW-111: per-item opener sets
  await runStep('coupon-grant', () => minimizeCouponGrant({ githubId, env, fetchImpl })); // SOW-119: minimize, never delete (owner ruling)
  await runStep('coupon-redemptions', () => eraseCouponRedemptions({ githubId, env, fetchImpl })); // SOW-119: id-in-key records + counter
  await runStep('prepared-listings', () => erasePreparedListings({ githubId, env, fetchImpl, now })); // sow-427: reads redeemedBy, so BEFORE the next step
  await runStep('redeemed-invites', () => minimizeRedeemedInvites({ githubId, env, fetchImpl })); // sow-231: person-keyed by redeemedBy, so it needs a sweep
  await runStep('conv-snapshot', () => eraseConversionSnapshot({ githubId, env, fetchImpl })); // SOW-059: own frozen snapshot
  await runStep('conv-counterpart', () => scrubConversionSnapshots({ githubId, env, fetchImpl })); // SOW-059: scrub as counterpart
  // SOW-166. ORDER IS LOAD-BEARING: this reads the address off the Stripe customer to derive the mail hash, so
  // it must precede the `stripe` step below, which deletes that customer. Afterwards the key is underivable
  // and the records are stranded forever. Pinned by a test in test/erase-member-mail.test.mjs.
  await runStep('mail', () => eraseMailRecords({ githubId, stripe, env, fetchImpl }));
  await runStep('discord', () => eraseDiscordRoles({ githubId, stripe, discord, env }));
  await runStep('content', () => eraseContent({ github, githubId, username, files, now, env, fetchImpl })); // sow-213 Step 3: env/fetchImpl for the KV grant removal
  if (deleteStripe) await runStep('stripe', () => eraseStripeCustomer({ githubId, stripe }));

  const record = buildAuditRecord({ githubId, operator, apply: true, steps, now });
  let audit;
  try { audit = await storeAuditRecord({ record, env, fetchImpl }); }
  catch (e) { audit = { recorded: false, reason: `audit write failed: ${e?.message || e}` }; }
  return { apply: true, steps, audit, record };
}
