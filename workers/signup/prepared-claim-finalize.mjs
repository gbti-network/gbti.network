// sow-427 C2: FINALIZING A PREPARED-LISTING CLAIM, and the claim lock's life between the claim and the merge.
//
// A claim opens ONE pull request (the project, the claimant's note, a basic profile when they have none). From then
// until GitHub says what happened to it, the listing is `publishing` (the lock) and its invite is `claim_pending`, so
// nobody else can claim the listing and nobody can redeem the invite's free year. This module is what ends that:
//
//   merged              -> the invite becomes claimed, the listing's images are deleted, the listing is marked
//                          claimed and minimized, and a notice record comes back for the owner. Idempotent.
//   closed, not merged  -> the lock and the pending claim are released, so the person can try again (claim_failed).
//   open                -> nothing changes (publishing); a pull request number the claim could not store is stored.
//   no pull request     -> nothing changes while the claim that took the lock could still be opening one. Only a
//                          lock older than ORPHAN_LOCK_MS with NO pull request on GitHub for its branch is released.
//
// THE LOCK HAS NO EXPIRY WHILE ITS PULL REQUEST IS OPEN (amendment 10). A second claimant let in after a timeout would
// open a second pull request with the same permalink in another folder. Only a pull request GitHub reports closed and
// unmerged releases it, and an unreadable answer from GitHub always means "change nothing".
//
// Three callers, one function: the claimant's status poll, the superadmin manager (at most FINALIZE_PER_LIST rows per
// load), and the scheduled sweep (prepared-claim-sweep.mjs), so a claimant who closes the tab is still finalized.
//
// WHAT RIDES ON THE LISTING WHILE IT IS LOCKED. The claim records the claimant's members-index folder and GitHub login
// beside the lock (`claimPendingFolder`, `claimPendingLogin`), because the merge is noticed later, possibly by the
// sweep, and the claimed record must name the folder the files were actually committed to. Both are removed when the
// lock is released or the claim completes, and builder 1's erasure deletes an unclaimed listing pending for a member.
//
// No logging anywhere in this module: the listing carries a person's name and the code is a bearer secret.

import { getInstallationToken } from './github-app.mjs';
import { readInvite, writeInvite } from './invites-store.mjs';
import { readListing, writeListing, deleteListingImages } from './prepared-store.mjs';
import { readPull, findPullByBranch } from './hosted-commit.mjs';
import { hostedBranchFor } from '../../membership/hosted-author.mjs';
import { markInviteClaimed, markInviteClaimPending, clearInviteClaimPending, inviteState, INVITE_STATE } from '../../membership/invites.mjs';
import {
  isListingId, listingState, LISTING_STATE, takeListingClaimLock, recordListingClaimPr, releaseListingClaimLock,
  markListingClaimed, minimizeClaimedListing, projectUrl, CLAIM_STATE,
} from '../../membership/prepared-listings.mjs';
import { listingClaimedRecord } from '../../membership/prepared-notify.mjs';

/**
 * A lock with NO pull request anywhere on GitHub for its branch is released only once it is older than this. The claim
 * that took it opens its pull request within seconds, so this is generous; it exists for a claim that died between
 * taking the lock and opening the pull request, and it never applies while a pull request exists.
 */
export const ORPHAN_LOCK_MS = 30 * 60 * 1000;
/** How far a pull request found by its branch may predate the lock and still be this claim's (clock skew). */
const BRANCH_PR_SKEW_MS = 5 * 60 * 1000;

/** What finalizeIfMerged reports in `state`. `unchanged` means the listing was not being published. */
export const FINALIZE_STATE = Object.freeze({
  claimed: CLAIM_STATE.claimed,
  failed: CLAIM_STATE.claim_failed,
  publishing: CLAIM_STATE.publishing,
  unchanged: 'unchanged',
});

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const DETAIL_FIELDS = ['claimPendingFolder', 'claimPendingLogin'];

/** The listing with the claimant's folder and login recorded beside a freshly taken lock. */
export function withClaimDetails(rec, { folder, login = null } = {}) {
  return { ...rec, claimPendingFolder: folder ? String(folder) : null, claimPendingLogin: login ? String(login) : null };
}

/** The listing without the lock-time claimant details (removed, not nulled, so an unclaimed record keeps its shape). */
export function stripClaimDetails(rec) {
  if (!isPlainObject(rec) || !DETAIL_FIELDS.some((k) => k in rec)) return rec;
  const next = { ...rec };
  for (const k of DETAIL_FIELDS) delete next[k];
  return next;
}

/** The branch a claim of this listing by its lock holder commits to (`hosted/<id>/project-<slug>`), or null. */
export function claimBranchFor(listing) {
  return hostedBranchFor(String(listing?.claimPendingBy ?? ''), `project-${String(listing?.slug ?? '')}`);
}

/**
 * Release a claim: the listing's lock (and its lock-time details) and the invite's pending claim. The listing is
 * written first, because the lock is what keeps another claimant out; an invite whose clear fails is healed by the
 * next finalize (a pending claim on an invite whose listing is not locked is stale). Returns `{ ok, listing, invite }`.
 */
export async function releaseClaim(kv, { listing, invite = null, githubId = null } = {}) {
  const rl = releaseListingClaimLock(listing);
  const next = stripClaimDetails(rl.next);
  if (next !== listing && !(await writeListing(kv, next))) return { ok: false, listing, invite };
  let inv = invite;
  if (isPlainObject(invite)) {
    const ci = clearInviteClaimPending(invite, { githubId });
    if (ci.changed && (await writeInvite(kv, ci.next))) inv = ci.next;
  }
  return { ok: true, listing: next, invite: inv };
}

/**
 * Take the claim lock for `githubId` on the freshly read listing and mark the invite's claim pending, in that order.
 * `expectUpdatedAt` guards the copy the caller built its files from: a listing the superadmin edited in between is
 * refused as `changed`, so what is committed is always exactly what is stored. Returns `{ ok: true, listing, invite }`
 * or `{ ok: false, error }` with error 'unavailable' (a failed read or write, nothing left locked), 'changed',
 * 'claimed', 'locked' (another account holds it), 'publishing' (this account already holds it), 'revoked' or
 * 'inactive'.
 */
export async function takeClaim(kv, { listingId, code, githubId, details, expectUpdatedAt, now = new Date() } = {}) {
  const fresh = await readListing(kv, listingId);
  if (!fresh) return { ok: false, error: 'unavailable' };
  const st = listingState(fresh);
  if (st === LISTING_STATE.publishing) {
    return { ok: false, error: String(fresh.claimPendingBy ?? '') === String(githubId) ? 'publishing' : 'locked' };
  }
  if ((fresh.updatedAt ?? null) !== (expectUpdatedAt ?? null)) return { ok: false, error: 'changed' };
  const t = takeListingClaimLock(fresh, { githubId, now });
  if (!t.ok) return { ok: false, error: t.error === 'invalid' ? 'inactive' : t.error };
  const locked = withClaimDetails(t.next, details);
  if (!(await writeListing(kv, locked))) return { ok: false, error: 'unavailable' };

  const invite = await readInvite(kv, code);
  const mp = invite ? markInviteClaimPending(invite, { githubId, now }) : { next: invite, changed: false };
  const alreadyMine = invite && inviteState(invite, now) === INVITE_STATE.claim_pending && String(invite.claimPendingBy ?? '') === String(githubId);
  if (!invite || invite.listingId !== listingId || (!mp.changed && !alreadyMine)) {
    await releaseClaim(kv, { listing: locked, invite: null });
    return { ok: false, error: 'inactive' };
  }
  if (mp.changed && !(await writeInvite(kv, mp.next))) {
    await releaseClaim(kv, { listing: locked, invite: null });
    return { ok: false, error: 'unavailable' };
  }
  return { ok: true, listing: locked, invite: mp.changed ? mp.next : invite };
}

/**
 * Store the pull request number a claim opened, on the listing and on the invite. If a finalize released the lock in
 * the meantime (it can only do that when no pull request existed and the lock was ORPHAN_LOCK_MS old), the lock is
 * taken back for this claimant, because a pull request now exists and must be finalized. Returns true when the
 * listing now records the number. A false return is recoverable: finalize finds the number by the branch.
 */
export async function recordOpenedPr(kv, { listingId, code, githubId, prNumber, details, now = new Date() } = {}) {
  if (!Number.isInteger(prNumber) || prNumber < 1) return false;
  let rec = await readListing(kv, listingId);
  if (!rec) return false;
  if (listingState(rec) === LISTING_STATE.prepared) {
    const t = takeListingClaimLock(rec, { githubId, now });
    if (!t.ok) return false;
    rec = withClaimDetails(t.next, details);
  }
  const rp = recordListingClaimPr(rec, { githubId, prNumber });
  if (!rp.ok) return false;
  const wrote = await writeListing(kv, rp.next);
  const invite = await readInvite(kv, code);
  if (invite && invite.listingId === listingId) {
    const mp = markInviteClaimPending(invite, { githubId, pr: prNumber, now });
    if (mp.changed) await writeInvite(kv, mp.next);
  }
  return wrote;
}

function finalizeIo(env, deps = {}) {
  return {
    kv: deps.kv ?? env?.SIGNUP_KV,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    getToken: deps.getToken ?? getInstallationToken,
    upstream: deps.upstream ?? (env?.UPSTREAM_REPO || 'gbti-network/gbti.network'),
    siteBase: deps.siteBase ?? (env?.SITE_BASE_URL || 'https://gbti.network'),
    now: deps.now ?? new Date(),
  };
}

/** The claim's pull request on GitHub: `{ ok: true, pr }` (pr may be null: there is none) or `{ ok: false }`. */
async function claimPull(env, io, listing) {
  const branch = claimBranchFor(listing);
  if (!branch) return { ok: true, pr: null };
  let instToken;
  try { instToken = await io.getToken(env, { fetchImpl: io.fetchImpl, kv: io.kv }); } catch { return { ok: false }; }
  const gh = { fetchImpl: io.fetchImpl, instToken, upstream: io.upstream };
  if (Number.isInteger(listing.prNumber) && listing.prNumber > 0) {
    const r = await readPull({ ...gh, number: listing.prNumber });
    if (!r.ok) return { ok: false };
    if (r.pr && r.pr.headRef === branch) return { ok: true, pr: r.pr };
  }
  const f = await findPullByBranch({ ...gh, branch });
  if (!f.ok) return { ok: false };
  if (!f.pr || f.pr.state === 'open') return { ok: true, pr: f.pr };
  // A CLOSED pull request found by its branch may be an earlier attempt that was already released; it speaks for
  // this lock only if it was opened after the lock was taken.
  const opened = Date.parse(f.pr.createdAt ?? '');
  const locked = Date.parse(listing.claimPendingAt ?? '');
  const mine = Number.isFinite(opened) && Number.isFinite(locked) && opened >= locked - BRANCH_PR_SKEW_MS;
  return { ok: true, pr: mine ? f.pr : null };
}

/**
 * Bring one listing up to date with its claim's pull request. Never throws.
 *
 * @param env   the Worker env (SIGNUP_KV, UPSTREAM_REPO, SITE_BASE_URL, the GitHub App)
 * @param listing, invite  the stored records (the invite the listing's current code names; null when absent)
 * @param deps  `{ kv, fetchImpl, getToken, upstream, siteBase, now }`, all injectable
 * @returns `{ state, listing, invite, notify, projectUrl?, prNumber?, releasedFor? }` where state is one of
 *   FINALIZE_STATE: 'claimed' (merged; `notify` is a listingClaimedRecord ONLY when this call recorded the claim),
 *   'claim_failed' (closed unmerged, or an orphaned lock; `releasedFor` is the claimant released), 'publishing'
 *   (open, or GitHub could not answer), 'unchanged' (the listing was not being published). `listing`/`invite` are
 *   the records as they now stand.
 */
export async function finalizeIfMerged(env, { listing, invite = null } = {}, deps = {}) {
  const io = finalizeIo(env, deps);
  const { kv, now } = io;
  const out = (state, l = listing, i = invite, extra = {}) => ({ state, listing: l, invite: i, notify: null, ...extra });
  if (!kv || !isPlainObject(listing) || !isListingId(listing.id)) return out(FINALIZE_STATE.unchanged);
  const inv = isPlainObject(invite) && invite.listingId === listing.id ? invite : null;

  // Already claimed: the invite must agree, because the merge is a fact and a claimed invite never grants a year.
  if (listing.claimedAt) {
    if (inv && !inv.claimedAt && listing.claimedBy) {
      const m = markInviteClaimed(inv, { githubId: listing.claimedBy, pr: listing.prNumber, now });
      if (m.changed && (await writeInvite(kv, m.next))) return out(FINALIZE_STATE.claimed, listing, m.next, { projectUrl: projectUrl(io.siteBase, listing.slug) });
    }
    return out(FINALIZE_STATE.claimed, listing, invite, { projectUrl: projectUrl(io.siteBase, listing.slug) });
  }

  if (listingState(listing) !== LISTING_STATE.publishing) {
    // A pending claim left on the invite after its listing was released (the clear's write failed) is stale.
    if (inv && (inv.claimPendingAt || inv.claimPendingBy) && !inv.claimedAt) {
      const c = clearInviteClaimPending(inv);
      if (c.changed && (await writeInvite(kv, c.next))) return out(FINALIZE_STATE.unchanged, listing, c.next);
    }
    return out(FINALIZE_STATE.unchanged);
  }

  const claimant = String(listing.claimPendingBy ?? '');
  const found = await claimPull(env, io, listing);
  if (!found.ok) return out(FINALIZE_STATE.publishing); // GitHub could not say: change nothing
  const pr = found.pr;

  if (!pr) {
    const age = now.getTime() - Date.parse(listing.claimPendingAt ?? '');
    if (Number.isFinite(age) && age < ORPHAN_LOCK_MS) return out(FINALIZE_STATE.publishing);
    const rel = await releaseClaim(kv, { listing, invite: inv, githubId: claimant });
    if (!rel.ok) return out(FINALIZE_STATE.publishing);
    return out(FINALIZE_STATE.failed, rel.listing, rel.invite ?? invite, { releasedFor: claimant });
  }

  if (!pr.merged && pr.state === 'open') {
    if (listing.prNumber === pr.number) return out(FINALIZE_STATE.publishing, listing, invite, { prNumber: pr.number });
    // The claim could not store its number (the 422 path, or a failed write): store it now.
    let l = listing;
    let i = invite;
    const rp = recordListingClaimPr(listing, { githubId: claimant, prNumber: pr.number });
    if (rp.ok && rp.changed && (await writeListing(kv, rp.next))) l = rp.next;
    if (inv) {
      const mp = markInviteClaimPending(inv, { githubId: claimant, pr: pr.number, now });
      if (mp.changed && (await writeInvite(kv, mp.next))) i = mp.next;
    }
    return out(FINALIZE_STATE.publishing, l, i, { prNumber: pr.number });
  }

  if (!pr.merged) {
    const rel = await releaseClaim(kv, { listing, invite: inv, githubId: claimant });
    if (!rel.ok) return out(FINALIZE_STATE.publishing);
    return out(FINALIZE_STATE.failed, rel.listing, rel.invite ?? invite, { releasedFor: claimant, prNumber: pr.number });
  }

  // MERGED. The order makes every step safe to repeat: the invite first (a claimed invite never grants a year again),
  // then the images (a retry after a failed delete finds the listing still publishing and deletes them again), then
  // the listing, claimed and minimized, whose write is the step that makes this call the one that reports it.
  const folder = listing.claimPendingFolder ?? null;
  const login = listing.claimPendingLogin ?? null;
  let invNext = invite;
  if (inv) {
    const m = markInviteClaimed(inv, { githubId: claimant, pr: pr.number, now });
    if (m.changed) {
      if (!(await writeInvite(kv, m.next))) return out(FINALIZE_STATE.publishing);
      invNext = m.next;
    }
  }
  const images = await deleteListingImages(kv, listing.id);
  if (!images.ok) return out(FINALIZE_STATE.publishing, listing, invNext);
  const mc = markListingClaimed(listing, {
    githubId: claimant, login, folder, prNumber: pr.number, now,
    path: folder ? `members/${folder}/projects/${listing.slug}/index.md` : null,
  });
  if (!mc.changed) return out(FINALIZE_STATE.publishing, listing, invNext); // never minimize a record it did not claim
  const next = stripClaimDetails(minimizeClaimedListing(mc.next));
  if (!(await writeListing(kv, next))) return out(FINALIZE_STATE.publishing, listing, invNext);
  return {
    state: FINALIZE_STATE.claimed,
    listing: next,
    invite: invNext,
    notify: listingClaimedRecord(next, { siteBase: io.siteBase, upstream: io.upstream }),
    projectUrl: projectUrl(io.siteBase, next.slug),
    prNumber: pr.number,
  };
}

/** finalizeIfMerged for a listing id: reads the listing and the invite its code names first. Never throws. */
export async function finalizeListingById(env, listingId, deps = {}) {
  const kv = deps.kv ?? env?.SIGNUP_KV;
  const listing = await readListing(kv, listingId);
  if (!listing) return { state: FINALIZE_STATE.unchanged, listing: null, invite: null, notify: null };
  const invite = await readInvite(kv, listing.code);
  return finalizeIfMerged(env, { listing, invite }, { ...deps, kv });
}
