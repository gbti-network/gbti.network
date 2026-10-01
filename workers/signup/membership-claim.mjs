// sow-427 C2: CLAIMING A PREPARED PROJECT LISTING. A superadmin prepared a project for someone who is not a member
// yet (membership-prepared-admin.mjs); the person opens the invitation link, signs in, and claims it here.
//
//   GET  /membership/claim?code=<CODE>        -> { ok, state, projectUrl, retryAfterSeconds, ... }  (the page polls it)
//   POST /membership/claim { code, note }     -> { ok, state: 'publishing', number }                 (Publish)
//
// Signed in (bearer, or the website session cookie with the CSRF gate on the POST), not necessarily paying: the
// status tells a not-paying account whether signing in with the invitation grants a free year or not.
//
// THE CLAIM PUBLISHES EXACTLY WHAT WAS PREPARED. The POST reads `code` and `note` from the body and NOTHING else: the
// files are built from the stored record (membership/prepared-claim-files.mjs), into the claimant's own folder only
// (allowAnyFolder false). The stored record IS the superadmin's approval of a public project, so this route skips the
// sow-323 audience rule and the editorial queue on purpose, and re-checks what that approval depends on: the preparer
// is still a superadmin, the permalink is still free on the site, the category and licence are still in the house
// lists, and the record still validates.
//
// TRAP 2: THE MERGE GATE MUST SEE WHAT THE WORKER SEES. The gate reads effective status from the overrides mirror
// (scripts/pr-gate.mjs reads Stripe live and then applies the mirror), and learns about a brand-new free year only
// when reconcile folds it. A pull request opened in that gap is closed as not paid, and nothing re-gates it. So the
// claim commits only when BOTH hold, and otherwise answers a pending state and nudges reconcile:
//   - effective status is paid from a source the mirror already carries (`source !== 'coupon'`): else pending_grant
//     and a 'regate' dispatch (a targeted reconcile folds the grant AND enrolls the member);
//   - the members-index has a folder for this account number: else pending_folder and an 'enroll' dispatch.
// Each dispatch is limited to one per five minutes per member (the author route's one per hour is too slow for a
// page someone is watching), and the page polls with backoff.
//
// THE FOLDER IS THE MEMBERS-INDEX ENTRY for the verified account number (amendments 17 and 19), never the login and
// never the request. An unindexed claimant is pending_folder, with no fallback to the lowercased login.
//
// A CLAIM IS NOT DONE WHEN ITS PULL REQUEST OPENS. The listing stays locked and the invite claim_pending until the
// pull request merges (prepared-claim-finalize.mjs); the status poll, the superadmin manager and the scheduled sweep
// each finalize it, so a claimant who closes the tab is still finalized and the owner is still told.
//
// No logging anywhere in this module: the invitation code is a bearer secret, and the title, the greeting name, the
// message and the claimant's note are about a person.

import { resolveEffective, OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from './membership-content.mjs';
import { rateLimit } from './abuse.mjs';
import { kickDispatch } from './checkout.mjs';
import { getInstallationToken } from './github-app.mjs';
import { readContentTree } from './membership-network.mjs';
import { loadHouseYaml } from './membership-admin-author.mjs';
import { TAXONOMY_PATH, LICENSES_PATH } from './membership-prepared-admin.mjs';
import { couponRedemptionCheck } from './coupons.mjs';
import { readInvite } from './invites-store.mjs';
import { readListing, readListingImageMap } from './prepared-store.mjs';
import { githubUserById } from './github-user-lookup.mjs';
import { readMembersIndexFolder, readRepoText, commitHostedFiles, findPullByBranch } from './hosted-commit.mjs';
import {
  finalizeIfMerged, takeClaim, releaseClaim, recordOpenedPr, FINALIZE_STATE,
} from './prepared-claim-finalize.mjs';
import { sendListingClaimedAlert } from './listing-claimed-alert.mjs';
import { validateHostedRequest, hostedBranchFor } from '../../membership/hosted-author.mjs';
import { normalizeCouponCode, COUPON_CODE_RE } from '../../membership/coupons.mjs';
import {
  isListingId, listingState, LISTING_STATE, claimDecision, CLAIM_STATE, projectUrl,
} from '../../membership/prepared-listings.mjs';
import { buildClaimFiles, listingHouseProblems, sanitizeClaimNote } from '../../membership/prepared-claim-files.mjs';
import { rolesFromParsed, roleOf, bansFromParsed, isBanned } from '../../membership/overrides-core.mjs';

export { finalizeIfMerged } from './prepared-claim-finalize.mjs';

/** The rate limits (per member account number). */
export const CLAIM_STATUS_LIMIT = Object.freeze({ limit: 60, windowSeconds: 600, prefix: 'rl:claim-status:' });
export const CLAIM_POST_LIMIT = Object.freeze({ limit: 10, windowSeconds: 600, prefix: 'rl:claim:' });
export const CLAIM_REGATE_LIMIT = Object.freeze({ limit: 1, windowSeconds: 300, prefix: 'rl:claim-regate:' });
export const CLAIM_ENROLL_LIMIT = Object.freeze({ limit: 1, windowSeconds: 300, prefix: 'rl:claim-enroll:' });
/** What the status suggests the page wait before asking again, for the states that resolve on their own. */
export const RETRY_AFTER_SECONDS = 10;
const WAITING = new Set([CLAIM_STATE.pending_grant, CLAIM_STATE.pending_folder, CLAIM_STATE.publishing]);
// The states on the way to a claim: a listing whose preparer is no longer a superadmin must stop at every one.
const PREPARER_CHECKED = new Set([
  CLAIM_STATE.redeem, CLAIM_STATE.year_used, CLAIM_STATE.year_unavailable, CLAIM_STATE.pending_grant, CLAIM_STATE.ready,
]);

const bad = (status, error, message, extra = {}) => ({ status, body: { ok: false, error, message, ...extra } });
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The sentence a claimant reads for each state the POST refuses with. No dashes, no contractions, "free year".
const STATE_MESSAGE = Object.freeze({
  inactive: 'This invitation link is not active.',
  claimed: 'You already claimed this project.',
  wrong_account: 'This invitation is for a different GitHub account. Sign in with the account it was sent to.',
  not_permitted: 'This account cannot claim listings.',
  preview_only: 'You prepared this listing, so you can preview it but not claim it.',
  publishing: 'Your project is already being published.',
  redeem: 'Sign in with the invitation to start your free year, then claim the project.',
  year_used: 'This account already used its free year. Choose a paid plan to claim the project.',
  year_unavailable: 'The free year on this invitation is not available to this account right now. Choose a paid plan to claim the project.',
  pending_grant: 'Your membership is still being set up. This usually takes a few minutes.',
  pending_folder: 'Your member space is still being set up. This usually takes a few minutes.',
});
const REFUSAL_STATUS = Object.freeze({
  inactive: 404, claimed: 409, publishing: 409, pending_grant: 409, pending_folder: 409,
  wrong_account: 403, not_permitted: 403, preview_only: 403, redeem: 403, year_used: 403, year_unavailable: 403,
});

/** The injectable network dependencies, defaulted once. */
function ioFrom(env, deps = {}) {
  return {
    kv: deps.kv ?? env?.SIGNUP_KV,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    getToken: deps.getToken ?? getInstallationToken,
    limiter: deps.limiter ?? rateLimit,
    dispatch: deps.dispatch ?? kickDispatch,
    readTree: deps.readTree ?? readContentTree,
    loadHouse: deps.loadHouse ?? loadHouseYaml,
    lookupUserById: deps.lookupUserById ?? githubUserById,
    finalize: deps.finalize ?? finalizeIfMerged,
    resolve: deps.resolve ?? resolveEffective,
    upstream: deps.upstream ?? (env?.UPSTREAM_REPO || 'gbti-network/gbti.network'),
    siteBase: deps.siteBase ?? (env?.SITE_BASE_URL || 'https://gbti.network'),
    now: deps.now ?? new Date(),
  };
}

/**
 * Is the superadmin who prepared this listing still a superadmin (and not banned)? Read from the same fresh overrides
 * mirror the gates read. Anything unreadable, stale or malformed is false: a demoted preparer's approval is gone.
 */
export async function preparerStillSuperadmin(kv, preparedBy, now = new Date()) {
  const id = String(preparedBy ?? '');
  if (!/^\d{1,20}$/.test(id)) return false;
  let mirror = null;
  try { mirror = await kv?.get(OVERRIDES_KV_KEY, 'json'); } catch { mirror = null; }
  if (!mirror || !mirror.generatedAt) return false;
  const ageMs = now.getTime() - new Date(mirror.generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OVERRIDES_AGE_MS) return false;
  if (!isPlainObject(mirror.roles) || !isPlainObject(mirror.bans)) return false;
  if (isBanned(id, bansFromParsed(mirror.bans))) return false;
  return roleOf(id, rolesFromParsed(mirror.roles)) === 'superadmin';
}

/** Fire one repository_dispatch nudge, at most once per five minutes per member. Fail soft: false. */
async function nudge(env, io, eventType, githubId, limit) {
  try {
    const rl = await io.limiter({ kv: io.kv, id: githubId, ...limit });
    if (!rl?.allowed) return false;
    return Boolean(await io.dispatch({
      eventType, githubId, dispatchToken: env?.REGATE_DISPATCH_TOKEN, contentRepo: env?.GITHUB_CONTENT_REPO || io.upstream,
    }, io.fetchImpl));
  } catch {
    return false;
  }
}

/**
 * Everything the status and the POST decide before anything is written. Returns `{ res }` (a refusal to send as it
 * is) or `{ state, slug, invite, listing, notify, folder, instToken, grantPending, folderPending }`.
 *
 * Order: the code's shape (no KV read for a malformed one); the invite and its listing; a finalize when the listing
 * is being published or its records disagree (so a merge, a closed pull request or a stale lock is noticed before
 * deciding); the pure claimDecision (with the coupon check only for a not-paying account); the preparer's role for
 * every state on the way to a claim; and the readiness checks for pending_grant and ready.
 */
async function evaluateClaim(env, io, eff, rawCode) {
  const code = normalizeCouponCode(typeof rawCode === 'string' ? rawCode : '');
  if (!COUPON_CODE_RE.test(code)) return { state: CLAIM_STATE.inactive };
  let invite = await readInvite(io.kv, code);
  let listing = invite && isListingId(invite.listingId) ? await readListing(io.kv, invite.listingId) : null;

  let notify = null;
  if (listing) {
    const stale = listingState(listing) === LISTING_STATE.publishing
      || (listing.claimedAt && invite && !invite.claimedAt)
      || (!listing.claimedAt && invite && (invite.claimPendingAt || invite.claimPendingBy) && listingState(listing) !== LISTING_STATE.publishing);
    if (stale) {
      const f = await io.finalize(env, { listing, invite }, { kv: io.kv, fetchImpl: io.fetchImpl, getToken: io.getToken, upstream: io.upstream, siteBase: io.siteBase, now: io.now });
      listing = f.listing ?? listing;
      invite = f.invite ?? invite;
      notify = f.notify ?? null;
      if (f.state === FINALIZE_STATE.failed && String(f.releasedFor ?? '') === eff.githubId) {
        return { state: CLAIM_STATE.claim_failed, invite, listing, notify };
      }
    }
  }

  const effective = { status: eff.status, source: eff.source };
  let d = claimDecision({ invite, listing, claimantId: eff.githubId, effective, yearRefusal: undefined, now: io.now });
  if (d.state === CLAIM_STATE.year_unavailable && eff.status !== 'paid') {
    // Only a not-paying account reaches the year states, and only then is the coupon check worth its reads. It is
    // the SAME check redeemCoupon decides through, so "redeem" is never offered when signing in would grant nothing.
    const check = await couponRedemptionCheck({ kv: io.kv, code: invite?.code ?? code, githubId: eff.githubId, now: io.now, lockSecret: env?.COUPON_LOCK_KEY ?? null });
    d = claimDecision({ invite, listing, claimantId: eff.githubId, effective, yearRefusal: check.reason, now: io.now });
  }
  const base = { state: d.state, slug: d.slug ?? null, invite, listing, notify };

  if (PREPARER_CHECKED.has(d.state) && !(await preparerStillSuperadmin(io.kv, listing?.preparedBy, io.now))) {
    return { ...base, state: CLAIM_STATE.inactive, slug: null };
  }
  if (d.state !== CLAIM_STATE.pending_grant && d.state !== CLAIM_STATE.ready) return base;

  let instToken;
  try { instToken = await io.getToken(env, { fetchImpl: io.fetchImpl, kv: io.kv }); }
  catch { return { res: bad(500, 'misconfigured', 'The publishing app is not configured.') }; }
  let idx;
  try { idx = await readMembersIndexFolder({ fetchImpl: io.fetchImpl, instToken, upstream: io.upstream, githubId: eff.githubId }); }
  catch { idx = { ok: false }; }
  if (!idx.ok) return { res: bad(502, 'index_unavailable', 'The member list could not be read. Try again shortly.') };
  const grantPending = d.state === CLAIM_STATE.pending_grant;
  const folderPending = !idx.folder;
  if (grantPending) {
    await nudge(env, io, 'regate', eff.githubId, CLAIM_REGATE_LIMIT);
    return { ...base, instToken, grantPending, folderPending };
  }
  if (folderPending) {
    await nudge(env, io, 'enroll', eff.githubId, CLAIM_ENROLL_LIMIT);
    return { ...base, state: CLAIM_STATE.pending_folder, instToken, grantPending, folderPending };
  }
  return { ...base, folder: idx.folder, instToken, grantPending, folderPending };
}

/** Resolve the signed-in caller, then its per-member rate limit. Returns `{ eff }` or `{ res }`. */
async function signedIn(request, env, io, deps, limit) {
  const eff = await io.resolve(request, env, { ...deps, fetchImpl: io.fetchImpl, kv: io.kv, now: io.now, allowCookie: deps.allowCookie === true });
  if (!eff.ok) return { res: { status: eff.status, body: eff.body } };
  const githubId = String(eff.githubId ?? '');
  if (!/^\d{1,20}$/.test(githubId)) return { res: bad(401, 'unauthorized', 'The account could not be verified.') };
  const rl = await io.limiter({ kv: io.kv, id: githubId, ...limit });
  if (!rl?.allowed) return { res: bad(429, 'rate_limited', 'Too many requests. Wait a few minutes and try again.') };
  return { eff: { ...eff, githubId } };
}

/**
 * GET /membership/claim?code=<CODE>. The claim state for the signed-in account.
 * Returns `{ status, body, notify }`: `notify` (a listingClaimedRecord, or null) is for the route to send through
 * ctx.waitUntil when this call is the one that noticed the merge.
 */
export async function membershipClaimStatus(request, env, deps = {}) {
  const io = ioFrom(env, deps);
  if (!io.kv) return bad(503, 'unavailable', 'The edge store is not reachable right now. Try again shortly.');
  const who = await signedIn(request, env, io, deps, CLAIM_STATUS_LIMIT);
  if (who.res) return who.res;
  const r = await evaluateClaim(env, io, who.eff, new URL(request.url).searchParams.get('code'));
  if (r.res) return r.res;
  const body = {
    ok: true,
    state: r.state,
    projectUrl: r.state === CLAIM_STATE.claimed ? projectUrl(io.siteBase, r.slug) : null,
    retryAfterSeconds: WAITING.has(r.state) ? RETRY_AFTER_SECONDS : null,
  };
  if (r.state === CLAIM_STATE.pending_grant || r.state === CLAIM_STATE.pending_folder) {
    body.grantPending = r.grantPending === true;
    body.folderPending = r.folderPending === true;
  }
  return { status: 200, body, notify: r.notify ?? null };
}

/** The category and licence re-check at the claim (amendment 11: loadHouseYaml + listingHouseProblems). */
async function houseRefusal(io, instToken, frontmatter) {
  const fm = isPlainObject(frontmatter) ? frontmatter : {};
  const blank = (v) => v === undefined || v === null || v === '';
  const needsTaxonomy = Array.isArray(fm.categories) && fm.categories.length > 0;
  const needsLicenses = !blank(fm.license) || !blank(fm.licenseUrl);
  if (!needsTaxonomy && !needsLicenses) return null;
  const load = async (path) => {
    try { const r = await io.loadHouse(io.fetchImpl, instToken, io.upstream, path); return r?.ok ? r.parsed : null; }
    catch { return null; }
  };
  const [taxonomy, licenses] = await Promise.all([needsTaxonomy ? load(TAXONOMY_PATH) : null, needsLicenses ? load(LICENSES_PATH) : null]);
  const issues = listingHouseProblems(fm, { taxonomy, licenses });
  if (!issues.length) return null;
  const unread = (needsTaxonomy && !taxonomy) || (needsLicenses && !licenses);
  return unread
    ? bad(503, 'house_unavailable', 'The site settings could not be read. Try again shortly.')
    : bad(409, 'listing_invalid', 'This listing needs a change before it can be published. Tell the person who sent it.');
}

/** A refusal for a claim state that is not `ready`. */
function stateRefusal(r, io) {
  const state = r.state;
  const extra = { state };
  if (state === CLAIM_STATE.claimed) extra.projectUrl = projectUrl(io.siteBase, r.slug);
  if (state === CLAIM_STATE.pending_grant || state === CLAIM_STATE.pending_folder) {
    return bad(409, 'claim_not_ready', STATE_MESSAGE[state], {
      ...extra, grantPending: r.grantPending === true, folderPending: r.folderPending === true, retryAfterSeconds: RETRY_AFTER_SECONDS,
    });
  }
  if (state === CLAIM_STATE.publishing) extra.retryAfterSeconds = RETRY_AFTER_SECONDS;
  if (state === CLAIM_STATE.claim_failed) {
    return bad(409, 'claim_failed', 'The last attempt to publish did not go through. You can publish again.', extra);
  }
  return bad(REFUSAL_STATUS[state] ?? 404, state in REFUSAL_STATUS ? state : 'inactive', STATE_MESSAGE[state] ?? STATE_MESSAGE.inactive, extra);
}

/**
 * POST /membership/claim `{ code, note }`. Publishes the prepared project under the claimant's own folder, with their
 * note (and a basic profile when they have none), as ONE pull request. Returns `{ status, body, notify }`.
 */
export async function membershipClaimPost(request, env, deps = {}) {
  if (env?.MEMBERSHIP_AUTHOR_ENABLED !== 'true') {
    return bad(403, 'author_disabled', 'Publishing is not enabled right now.');
  }
  const io = ioFrom(env, deps);
  if (!io.kv) return bad(503, 'unavailable', 'The edge store is not reachable right now. Try again shortly.');
  const who = await signedIn(request, env, io, deps, CLAIM_POST_LIMIT);
  if (who.res) return who.res;
  const githubId = who.eff.githubId;

  let payload;
  try { payload = await request.json(); } catch { return bad(400, 'bad_request', 'A JSON body is required.'); }
  if (!isPlainObject(payload)) return bad(400, 'bad_request', 'A JSON body is required.');
  // THE BODY IS READ FOR THESE TWO FIELDS AND NOTHING ELSE. A frontmatter, body, files, slug or folder sent with it
  // is ignored: what is published is the stored record, which is the superadmin's approval.
  const { code, note: rawNote } = payload;

  const r = await evaluateClaim(env, io, who.eff, code);
  if (r.res) return r.res;
  if (r.state !== CLAIM_STATE.ready) return { ...stateRefusal(r, io), notify: r.notify ?? null };
  const { listing, folder, instToken } = r;
  const notify = r.notify ?? null;

  const note = sanitizeClaimNote(typeof rawNote === 'string' ? rawNote : '');
  if (!note) return { ...bad(400, 'note_required', 'Write a short note about the project in your own words.'), notify };

  // The approval is re-checked against the site as it is NOW: the permalink (uncached tree), then the house lists.
  let tree;
  try { tree = await io.readTree(env, { fetchImpl: io.fetchImpl, kv: io.kv, upstream: io.upstream, getToken: io.getToken, useCache: false }); }
  catch { tree = null; }
  if (!tree || !Array.isArray(tree.content)) return { ...bad(502, 'tree_unavailable', 'The site could not be read. Try again shortly.'), notify };
  if (tree.content.some((e) => e?.type === 'project' && e.slug === listing.slug)) {
    return { ...bad(409, 'slug_taken', 'A project on the site already uses this permalink. Tell the person who sent the invitation so they can rename it; the same link keeps working.'), notify };
  }
  const house = await houseRefusal(io, instToken, listing.frontmatter);
  if (house) return { ...house, notify };

  // A basic profile only when the member has none on main (owner decision 7). Unreadable is not "absent".
  const prof = await readRepoText({ fetchImpl: io.fetchImpl, instToken, upstream: io.upstream, path: `members/${folder}/profile.md` });
  if (!prof.ok) return { ...bad(502, 'profile_unavailable', 'Your member profile could not be read. Try again shortly.'), notify };
  // The account behind the VERIFIED number: its current login is the one recorded, and its name heads a new profile.
  const user = await io.lookupUserById(env, githubId, { fetchImpl: io.fetchImpl, getToken: io.getToken, kv: io.kv });
  if (!user?.ok || String(user.githubId) !== githubId) {
    return { ...bad(502, 'lookup_failed', 'Your GitHub account could not be read. Try again shortly.'), notify };
  }
  const profile = prof.text === null ? { displayName: user.name || user.login } : null;

  const imgs = await readListingImageMap(io.kv, listing.id, Array.isArray(listing.images) ? listing.images : []);
  if (!imgs.ok) return { ...bad(503, 'images_unavailable', 'The project images could not be read. Try again shortly.'), notify };
  const built = buildClaimFiles({ listing, folder, note, profile, images: imgs.images, now: io.now });
  if (!built.ok) {
    if (built.error === 'note_required') return { ...bad(400, 'note_required', built.message), notify };
    return { ...bad(409, 'listing_invalid', 'This listing needs a change before it can be published. Tell the person who sent it.'), notify };
  }
  const check = validateHostedRequest({ files: built.files, itemId: built.itemId, folder, allowAnyFolder: false });
  if (!check.ok) {
    return check.status === 413
      ? { ...bad(413, 'too_large', 'This listing is too large to publish. Tell the person who sent it.'), notify }
      : { ...bad(409, 'listing_invalid', 'This listing needs a change before it can be published. Tell the person who sent it.'), notify };
  }
  const branch = hostedBranchFor(githubId, built.itemId);
  if (!branch) return { ...bad(409, 'listing_invalid', 'This listing needs a change before it can be published. Tell the person who sent it.'), notify };

  // THE LOCK, on the copy the files were built from (a listing edited in between is refused), then the invite's
  // pending claim. From here every failure before the pull request opens releases both.
  const details = { folder, login: user.login };
  const lock = await takeClaim(io.kv, { listingId: listing.id, code: listing.code, githubId, details, expectUpdatedAt: listing.updatedAt ?? null, now: io.now });
  if (!lock.ok) {
    if (lock.error === 'unavailable') return { ...bad(503, 'unavailable', 'The edge store is not reachable right now. Try again shortly.'), notify };
    if (lock.error === 'changed') return { ...bad(409, 'listing_changed', 'This listing changed while you were publishing. Try again.'), notify };
    if (lock.error === 'publishing') return { ...stateRefusal({ state: CLAIM_STATE.publishing }, io), notify };
    return { ...stateRefusal({ state: CLAIM_STATE.inactive }, io), notify };
  }

  const title = `Publish project: ${built.title}`;
  // The folder is a GBTI name (sow-428), never written as an @mention, exactly as the author route writes it.
  const body = `Hosted authoring: published on behalf of ${folder} (github_id ${githubId}) via the GBTI publishing app. `
    + 'A project prepared for this member by a superadmin, claimed through their invitation, with their own author note.';
  let committed;
  try { committed = await commitHostedFiles({ fetchImpl: io.fetchImpl, instToken, upstream: io.upstream, branch, files: built.files, title, body }); }
  catch {
    // The request to GitHub failed part way, so a pull request MAY have opened. The lock stays: finalize finds a pull
    // request by its branch, and releases the lock itself if none exists once ORPHAN_LOCK_MS has passed.
    return { ...bad(502, 'git_failed', 'The project could not be published right now. Try again shortly.'), notify };
  }
  if (!committed.ok) {
    await releaseClaim(io.kv, { listing: lock.listing, invite: lock.invite, githubId });
    return { ...bad(committed.status || 502, committed.error || 'git_failed', 'The project could not be published right now. Try again shortly.'), notify };
  }

  let number = Number.isInteger(committed.number) ? committed.number : null;
  if (committed.already) {
    // A pull request for this branch is already open (an earlier attempt of this same claim): find its number by the
    // head branch, so it is recorded rather than lost. An unreadable answer leaves the lock: a pull request may be open.
    const found = await findPullByBranch({ fetchImpl: io.fetchImpl, instToken, upstream: io.upstream, branch });
    if (found.ok && found.pr?.state === 'open') number = found.pr.number;
    else if (found.ok) {
      await releaseClaim(io.kv, { listing: lock.listing, invite: lock.invite, githubId });
      return { ...bad(502, 'open_pr_failed', 'The project could not be published right now. Try again shortly.'), notify };
    }
  }
  if (number !== null) {
    await recordOpenedPr(io.kv, { listingId: listing.id, code: listing.code, githubId, prNumber: number, details, now: io.now });
  }
  return { status: 200, body: { ok: true, state: CLAIM_STATE.publishing, number, retryAfterSeconds: RETRY_AFTER_SECONDS }, notify };
}

/**
 * The superadmin manager's finalize hook (membershipPreparedGet's `finalize`): finalize one publishing row and send
 * its notice through `ctx.waitUntil`. Wired at the manager's route line as
 * `finalize: preparedFinalizeHook(env, ctx)`.
 */
export function preparedFinalizeHook(env, ctx, deps = {}) {
  const send = deps.sendAlert ?? sendListingClaimedAlert;
  const finalize = deps.finalize ?? finalizeIfMerged;
  return async ({ listing, invite }) => {
    const f = await finalize(env, { listing, invite }, deps);
    if (f?.notify) {
      const p = send(env, f.notify);
      if (ctx?.waitUntil) ctx.waitUntil(p); else await p;
    }
    return { listing: f?.listing, invite: f?.invite };
  };
}
