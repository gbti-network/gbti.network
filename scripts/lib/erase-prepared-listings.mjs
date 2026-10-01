// sow-427: right-to-erasure for PREPARED LISTINGS. Its own module because scripts/lib/erase-member.mjs was over the
// 900-line cap when this was written; that file carries only the import, one runStep line and one plan entry.
//
// WHY A SWEEP. A prepared listing is keyed by a listing id and an invite by its code, so neither key can be computed
// from a github_id. The member appears only INSIDE records, in four roles, and each is handled differently:
//
//   1. The listing was TIED to them (`boundGithubId`), or they REDEEMED its current invitation, or they hold its
//      pending claim, and it is NOT claimed: the listing is about them (it greets them by name and carries a message
//      written to them), so it is DELETED with its images. Its invitation is revoked first and its tie then removed,
//      in that order, because untying a still-usable invitation would turn it into one anybody holding the link could
//      redeem. A code retired by "Send again" does not count: the listing it once opened now greets somebody else.
//   2. They CLAIMED it: the project now lives in the repository (the content step drafts it), and the minimized
//      listing record keeps saying "prepared, claimed on this date" with nobody attached. The greeting name, the
//      title, the slug, the suggested note, the claimant fields, the tie and the pull request number are nulled.
//   3. An invite names them as the claimant, the pending claimant or the tied account: those fields are nulled. A
//      pending claim keeps its date, so the invite stays unredeemable (fail closed) rather than reopening.
//   4. An invite they REDEEMED: not touched here. minimizeRedeemedInvites owns `redeemedBy`, and runs AFTER this step
//      because this one reads `redeemedBy` to find the listings in role 1.
//
// An UNTIED listing that nobody redeemed or claimed carries no account number at all, so no github_id-keyed erasure
// can find it. That case is a non-member's request, handled by Delete in the superadmin manager (the SOP says so).
//
// FAIL CLOSED like the other scan steps: a failed key list throws (runStep records the error), and a record whose
// value could not be read is reported as `incomplete`, never as a clean run.
//
// The KV helpers come from kv-rest.mjs, a leaf module that imports nothing local, so this module and
// erase-member.mjs (which imports this one statically) cannot form a ring. It used to need a dynamic import of
// erase-member.mjs for that reason, before the KV helpers were split out of it (2026-09-30).

import { LISTING_KEY_PREFIX, listingImagePrefix, isListingId } from '../../membership/prepared-listings.mjs';
import { INVITE_KEY_PREFIX, INVITE_STATE, inviteState, revokeInvite, clearInviteClaimPending } from '../../membership/invites.mjs';
import { normalizeCouponCode } from '../../membership/coupons.mjs';
import * as kvRest from './kv-rest.mjs';

const same = (v, id) => v !== null && v !== undefined && v !== '' && String(v) === id;

function incomplete(listedListings, listedInvites) {
  const unreadable = (listedListings?.unreadable || 0) + (listedInvites?.unreadable || 0);
  if (!unreadable) return null;
  const total = (listedListings?.keys?.length || 0) + (listedInvites?.keys?.length || 0);
  return {
    incomplete: true,
    unreadable,
    reason: `${unreadable} of ${total} ${LISTING_KEY_PREFIX}* / ${INVITE_KEY_PREFIX}* record(s) could not be read and were NOT scrubbed`,
  };
}

/**
 * Erase the member's traces from the prepared-listing store and from the prepared invites.
 * Returns `{ minimized, deleted, images, scanned }` (plus `incomplete`, `unreadable`, `reason` when a record could not
 * be read), or `{ skipped: true, reason }` without Cloudflare credentials. `minimized` counts every record changed or
 * removed, which is what the audit summary reads.
 */
export async function erasePreparedListings({ githubId, env = process.env, fetchImpl = globalThis.fetch, now = new Date(), kvOps = null } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const { listKvByPrefix, putKvValue, deleteKvKey } = kvOps || kvRest;
  const id = String(githubId);

  const invites = await listKvByPrefix({ prefix: INVITE_KEY_PREFIX, env, fetchImpl });
  if (!invites.available) return { skipped: true, reason: invites.reason };
  const listings = await listKvByPrefix({ prefix: LISTING_KEY_PREFIX, env, fetchImpl });
  if (!listings.available) return { skipped: true, reason: listings.reason };

  // Role 1 lookups: the listings whose CURRENT invitation this member redeemed or holds a pending claim on. A code
  // retired by "Send again" no longer ties the listing to whoever redeemed it (publicReadable refuses it, so that
  // account can never claim the listing): erasing them must not delete a listing now meant for somebody else, nor
  // revoke its live link. Their fields on the retired invite are minimizeRedeemedInvites' job.
  const currentCode = new Map();
  for (const { value } of listings.entries ?? []) {
    if (value && typeof value === 'object' && value.id && value.code) currentCode.set(String(value.id), normalizeCouponCode(value.code));
  }
  const viaInvite = new Set();
  for (const { value } of invites.entries ?? []) {
    if (!value?.listingId || value.claimedAt) continue;
    if (currentCode.get(String(value.listingId)) !== normalizeCouponCode(value.code)) continue;
    if (same(value.redeemedBy, id) || same(value.claimPendingBy, id)) viaInvite.add(String(value.listingId));
  }

  let deleted = 0;
  let images = 0;
  let minimized = 0;
  const deletedIds = new Set();
  for (const { key, value } of listings.entries ?? []) {
    if (!value || typeof value !== 'object') continue;
    const lid = String(value.id ?? '');
    if (value.claimedAt) {
      if (!same(value.claimedBy, id)) continue;
      // Role 2: claimed by this member. Keep the fact of the claim, drop everyone and everything that names them.
      await putKvValue({
        key, env, fetchImpl,
        value: JSON.stringify({
          ...value,
          recipientName: null, message: null, suggestedNote: null, title: null, slug: null, frontmatter: null, body: null, images: [],
          claimedBy: null, claimedLogin: null, claimedFolder: null, claimedPath: null,
          boundGithubId: null, boundLogin: null, claimPendingBy: null, prNumber: null,
        }),
      });
      minimized++;
      continue;
    }
    const aboutThem = same(value.boundGithubId, id) || same(value.claimPendingBy, id) || viaInvite.has(lid);
    if (!aboutThem) continue;
    // Role 1: the listing is about this member and was never claimed. Delete its images, then the record.
    if (isListingId(lid)) {
      const imgs = await listKvByPrefix({ prefix: listingImagePrefix(lid), env, fetchImpl, keysOnly: true });
      for (const k of imgs.keys ?? []) {
        const r = await deleteKvKey({ key: k, env, fetchImpl });
        if (r?.deleted !== false) images++;
      }
    }
    const r = await deleteKvKey({ key, env, fetchImpl });
    if (r?.deleted !== false) { deleted++; minimized++; }
    if (lid) deletedIds.add(lid);
  }

  // Role 3 (and the invites of the listings deleted above): one write per invite, with every change merged.
  for (const { key, value } of invites.entries ?? []) {
    if (!value || typeof value !== 'object') continue;
    const ofDeleted = value.listingId && deletedIds.has(String(value.listingId));
    const namesThem = same(value.claimedBy, id) || same(value.claimPendingBy, id) || same(value.boundGithubId, id);
    if (!ofDeleted && !namesThem) continue;
    let next = { ...value };
    if (ofDeleted && !next.claimedAt) {
      // The listing is gone, so its pending claim (if any) can never merge; clear it so the revoke is accepted.
      next = clearInviteClaimPending(next).next;
      next = revokeInvite(next, { by: null, now }).next;
    }
    if (same(next.claimedBy, id)) next.claimedBy = null;
    if (same(next.claimPendingBy, id)) next.claimPendingBy = null; // the date stays: still unredeemable
    if (same(next.boundGithubId, id)) {
      // Untie only an invitation that can no longer be redeemed, or the tie's removal would open it to anybody.
      const st = inviteState(next, now);
      if (st === INVITE_STATE.issued) next = revokeInvite(next, { by: null, now }).next;
      next.boundGithubId = null;
      next.boundLogin = null;
    }
    if (JSON.stringify(next) === JSON.stringify(value)) continue;
    await putKvValue({ key, value: JSON.stringify(next), env, fetchImpl });
    minimized++;
  }

  const scanned = (listings.keys?.length || 0) + (invites.keys?.length || 0);
  return { minimized, deleted, images, scanned, ...(incomplete(listings, invites) || {}) };
}
