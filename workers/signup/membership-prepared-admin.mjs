// sow-427 B3: the SUPERADMIN routes for prepared project listings.
//
//   GET  /membership/admin/prepared                      -> { ok, listings: [summary] }       the manager's rows
//   GET  /membership/admin/prepared?id=<ID>              -> { ok, listing: adminView, link }  Edit loads this
//   GET  /membership/admin/prepared?id=<ID>&image=<name> -> { ok, name, dataBase64, contentType }
//   POST /membership/admin/prepared { op: 'save' | 'revoke' | 'resend' | 'delete', ... }
//
// SUPERADMIN ONLY (owner decision 10), through authorizeSuperadmin: identity from the verified token or the signed
// website session (CSRF enforced on the POST for a cookie caller), the role from the fresh overrides mirror, banned
// denied, fail closed. Admins keep issuing plain invites through membership-invites-admin.mjs, which now refuses
// to touch an invite that belongs to a listing and hides it from its list.
//
// A LISTING NEVER EXISTS WITHOUT ITS INVITATION, AND THE ORDER OF A SAVE IS THE WHOLE DESIGN (amendment 5).
// Everything that can refuse runs first and writes nothing: the campaign, the greeting and message, the project
// (validatePreparedDraft: schema, link schemes, image references, no members-only gating), the GitHub account for
// a binding, the image bytes, the size dry run (preparedSizeProblem), a permalink no project on the site or other
// listing uses, and the category and licence against the house lists. Only then: the images, the invite (no
// expiry, owner decision 8), the listing, and LAST the deletion of the superadmin's staged copies. A refusal at any
// check leaves the staged images in place so the retry finds them; a failed write undoes what came before it.
//
// THE STORED RECORD IS THE SUPERADMIN'S APPROVAL of a public project (the claim publishes it byte for byte, with
// only the claimant's note added), so every check here runs again at the claim.
//
// No logging anywhere in this module: the invitation code is a bearer secret, and the title, the greeting and the
// message are about a person who has not agreed to anything yet.

import { authorizeSuperadmin } from './membership-admin.mjs';
import { readInvite, writeInvite } from './invites-store.mjs';
import { readCouponsConfig } from './coupons.mjs';
import { mintUniqueInvite } from './membership-invites-admin.mjs';
import { githubUserByLogin } from './github-user-lookup.mjs';
import { getInstallationToken } from './github-app.mjs';
import { readContentTree } from './membership-network.mjs';
import { loadHouseYaml } from './membership-admin-author.mjs';
import {
  readListing, writeListing, deleteListing, listListings, readListingImage, deleteListingImages,
  deleteListingImageNames, collectListingImages, imageBytesOf, writeCollectedImages, deleteStagedCopies,
} from './prepared-store.mjs';
import { couponByCode, normalizeCouponCode } from '../../membership/coupons.mjs';
import { roleLoginsFromParsed } from '../../membership/overrides-core.mjs';
import { itemTokenOf } from '../../membership/draft-images.mjs';
import { newInvite, revokeInvite, setInviteBinding, inviteState, INVITE_STATE } from '../../membership/invites.mjs';
import {
  isListingId, isListingImageName, mintListingId, normalizeGithubLogin, validateInvitationText, validatePreparedDraft,
  newListing, listingState, LISTING_STATE, applyListingEdit, listingRevoke, listingResend, listingSummary,
  listingAdminView, claimLink,
} from '../../membership/prepared-listings.mjs';
import { listingHouseProblems, preparedSizeProblem } from '../../membership/prepared-claim-files.mjs';

export const TAXONOMY_PATH = 'house/taxonomy.yml';
export const LICENSES_PATH = 'house/licenses.yml';
/** At most this many "publishing" rows are finalized per manager load, when a finalize hook is supplied. */
export const FINALIZE_PER_LIST = 5;
const LISTING_ID_BYTES = 32;
const LISTING_ID_ATTEMPTS = 5;

const bad = (status, error, message, extra = {}) => ({ status, body: { ok: false, error, message, ...extra } });
const unavailable = (message = 'The edge store is not reachable right now. Try again shortly.') => bad(503, 'unavailable', message);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

/** The preparing superadmin's login, from the roles section of the mirror the gate read. Best effort: null. */
function preparerLogin(auth) {
  try { return roleLoginsFromParsed(auth?.mirror?.roles).get(String(auth?.githubId)) ?? null; }
  catch { return null; }
}

/** The shared network dependencies, defaulted once so every op reads them the same way. */
function ioFrom(env, deps) {
  return {
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    getToken: deps.getToken ?? getInstallationToken,
    lookupUser: deps.lookupUser ?? githubUserByLogin,
    readTree: deps.readTree ?? readContentTree,
    loadHouse: deps.loadHouse ?? loadHouseYaml,
    upstream: deps.upstream ?? (env?.UPSTREAM_REPO || 'gbti-network/gbti.network'),
    siteBase: deps.siteBase ?? (env?.SITE_BASE_URL || 'https://gbti.network'),
  };
}

// ---- the checks that need the network -------------------------------------------------------------------------

/**
 * Resolve the GitHub account a save asks to tie the invitation to. Returns `{ ok: true, binding }` where binding is
 * undefined (leave it), null (untie) or `{ boundGithubId, boundLogin }`; or a refusal response.
 * On an edit, the login already stored is kept WITHOUT a lookup: the account number stored at preparation is the
 * binding, and re-resolving the same name could move it to whoever holds that name on GitHub today.
 */
async function resolveBinding(env, io, kv, rawLogin, current) {
  if (rawLogin === undefined) return { ok: true, binding: undefined };
  if (blank(rawLogin)) return { ok: true, binding: current ? null : undefined };
  const login = normalizeGithubLogin(String(rawLogin));
  if (!login) return { ok: false, res: bad(400, 'bad_github_login', 'That is not a GitHub account name. Use letters, digits and single hyphens.') };
  if (current?.boundGithubId && String(current.boundLogin ?? '').toLowerCase() === login.toLowerCase()) return { ok: true, binding: undefined };
  const who = await io.lookupUser(env, login, { fetchImpl: io.fetchImpl, getToken: io.getToken, kv });
  if (who?.ok) return { ok: true, binding: { boundGithubId: who.githubId, boundLogin: who.login } };
  if (who?.status === 404) return { ok: false, res: bad(400, 'unknown_github_login', who.message) };
  if (who?.status === 400) return { ok: false, res: bad(400, 'bad_github_login', who.message) };
  return { ok: false, res: bad(502, 'lookup_failed', who?.message || 'GitHub could not be reached. Try again shortly.') };
}

/**
 * Refuse a permalink another project already uses: any project on main (read uncached, because a stale minute is
 * exactly when two people pick the same name), or another prepared listing that has not been claimed.
 */
async function slugProblem(env, io, kv, slug, selfId) {
  let tree;
  try { tree = await io.readTree(env, { fetchImpl: io.fetchImpl, kv, upstream: io.upstream, getToken: io.getToken, useCache: false }); }
  catch { tree = null; }
  if (!tree || !Array.isArray(tree.content)) return bad(502, 'tree_unavailable', 'The site could not be read to check the permalink. Try again shortly.');
  if (tree.content.some((e) => e?.type === 'project' && e.slug === slug)) {
    return bad(409, 'slug_taken', `A project on the site already uses the permalink ${slug}. Choose another one.`);
  }
  const all = await listListings(kv);
  if (!all) return unavailable();
  if (all.some(({ id, rec }) => id !== selfId && rec && !rec.claimedAt && rec.slug === slug)) {
    return bad(409, 'slug_taken', `Another prepared listing already uses the permalink ${slug}. Choose another one.`);
  }
  return null;
}

/**
 * The category and licence checks against house/taxonomy.yml and house/licenses.yml, read from main with
 * loadHouseYaml (amendment 11). The lists are read only when the project names a category or a licence. A list that
 * cannot be read is passed on as null, and listingHouseProblems refuses rather than waving the value through; that
 * refusal is a 503, because it clears on a retry, while a genuinely wrong value is a 400.
 */
async function houseProblem(env, io, kv, frontmatter) {
  const fm = isPlainObject(frontmatter) ? frontmatter : {};
  const needsTaxonomy = Array.isArray(fm.categories) && fm.categories.length > 0;
  const needsLicenses = !blank(fm.license) || !blank(fm.licenseUrl);
  if (!needsTaxonomy && !needsLicenses) return null;
  let token = null;
  try { token = await io.getToken(env, { fetchImpl: io.fetchImpl, kv }); } catch { token = null; }
  const load = async (path) => {
    if (!token) return null;
    try { const r = await io.loadHouse(io.fetchImpl, token, io.upstream, path); return r?.ok ? r.parsed : null; }
    catch { return null; }
  };
  const [taxonomy, licenses] = await Promise.all([needsTaxonomy ? load(TAXONOMY_PATH) : null, needsLicenses ? load(LICENSES_PATH) : null]);
  const issues = listingHouseProblems(fm, { taxonomy, licenses });
  if (!issues.length) return null;
  const unread = (needsTaxonomy && !taxonomy) || (needsLicenses && !licenses);
  return unread
    ? bad(503, 'house_unavailable', issues.join(' '), { issues })
    : bad(400, 'invalid', issues.join(' '), { issues });
}

// ---- re-reading before a write ----------------------------------------------------------------------------------

const notEditable = () => bad(409, 'not_editable', 'This listing is being published or was already claimed, so it can no longer be edited.');
const listingChanged = () => bad(409, 'listing_changed', 'This listing changed while this was being saved. Reload it and try again.');

/**
 * Read the listing again right before a write that replaces or removes it (review F1). Every op here reads first and
 * writes later, sometimes after GitHub round trips, and a claim takes its lock in between by writing the listing.
 * Returns `{ rec }` when the listing is still prepared or revoked and has not been saved since `base` (its
 * `updatedAt` is unchanged; a claim lock does not move it, so the state check is what sees a claim). Otherwise
 * `{ res }`: 404 when it is gone, 409 `not_editable` when a claim holds it or it was claimed, 409 `listing_changed`
 * when another save, revoke or send again landed first.
 */
async function rereadListing(kv, id, base) {
  const rec = await readListing(kv, id);
  if (!rec) return { res: bad(404, 'not_found', 'No prepared listing has that id.') };
  const st = listingState(rec);
  if (st !== LISTING_STATE.prepared && st !== LISTING_STATE.revoked) return { res: notEditable() };
  if ((rec.updatedAt ?? null) !== (base?.updatedAt ?? null)) return { res: listingChanged() };
  return { rec };
}

/** Does a claim hold (or own) this invitation? Then nothing about its listing may change. */
function claimHoldsInvite(invite, now) {
  if (!invite) return false;
  const st = inviteState(invite, now);
  return st === INVITE_STATE.claim_pending || st === INVITE_STATE.claimed || !blank(invite.claimPendingBy);
}

/**
 * Put the invitation's tie back to the listing's, after an edit that moved it could not store the listing. A READ,
 * then a change to the tie alone: writing back the copy read before the edit would also erase whatever landed since
 * (a redemption, or a claim marking the invite pending). setInviteBinding leaves an invite that is no longer
 * issued, revoked or expired alone, so a claim or a redemption that got there first keeps the record it wrote.
 */
async function restoreInviteBinding(kv, code, listing, now) {
  const inv = await readInvite(kv, code);
  if (!inv) return;
  const b = setInviteBinding(inv, { boundGithubId: listing.boundGithubId ?? null, boundLogin: listing.boundLogin ?? null, now });
  if (b.changed) await writeInvite(kv, b.next);
}

// ---- save -----------------------------------------------------------------------------------------------------

/**
 * `{ op: 'save', id?, campaign, recipientName, message, githubLogin?, draft: { type, slug, frontmatter, body },
 *    stagedItem? }`. Without `id` it creates a listing and its invitation; with `id` it edits one that is prepared or
 * revoked. On an edit every field is optional (absent means unchanged); `githubLogin` of '' or null unties.
 */
async function saveListing(body, { env, kv, auth, now, rand, io }) {
  const creating = blank(body?.id);
  const id = creating ? null : String(body.id);
  if (!creating && !isListingId(id)) return bad(400, 'bad_request', 'The listing id is not valid.');

  let current = null;
  if (!creating) {
    current = await readListing(kv, id);
    if (!current) return bad(404, 'not_found', 'No prepared listing has that id.');
    const st = listingState(current);
    if (st !== LISTING_STATE.prepared && st !== LISTING_STATE.revoked) return notEditable();
  }

  // The campaign: chosen at creation, where it must be redeemable right now (as a plain invite's must be); fixed
  // afterwards, because the invitation already out names it. Changing it is Revoke, then Send again.
  let campaign = current?.campaign ?? null;
  let config = null;
  if (creating) {
    config = await readCouponsConfig(kv, now);
    if (!config) return unavailable('The campaign registry is not readable right now. Try again shortly.');
    campaign = normalizeCouponCode(body?.campaign);
    if (!couponByCode(config, campaign, now)) return bad(400, 'unknown_campaign', 'Choose an active campaign for the free year.');
  } else if (!blank(body?.campaign) && normalizeCouponCode(body.campaign) !== current.campaign) {
    return bad(409, 'campaign_locked', 'The campaign cannot change while this invitation is out. Revoke it, then send it again with the new campaign.');
  }

  // The greeting and the message, both required whenever either is set.
  let text = null;
  if (creating || body?.recipientName !== undefined || body?.message !== undefined) {
    text = validateInvitationText({
      recipientName: body?.recipientName !== undefined ? body.recipientName : current?.recipientName,
      message: body?.message !== undefined ? body.message : current?.message,
    });
    if (!text.ok) return bad(400, text.error, text.message);
  }

  // The project.
  let draft = null;
  if (creating || body?.draft !== undefined) {
    const v = validatePreparedDraft(isPlainObject(body?.draft) ? body.draft : {});
    if (!v.ok) return bad(400, v.error, v.issues.join(' '), { issues: v.issues });
    draft = v.draft;
  }

  // The staged images belong to the item the editor staged them under, in the caller's own draft image store.
  let stagedItem = null;
  if (!blank(body?.stagedItem)) {
    stagedItem = itemTokenOf(body.stagedItem);
    if (!stagedItem || !stagedItem.startsWith('project:')) return bad(400, 'bad_request', 'stagedItem must be project:<permalink>.');
  }

  const bind = await resolveBinding(env, io, kv, body?.githubLogin, current);
  if (!bind.ok) return bind.res;

  // The image bytes, gathered without writing, then every remaining check. Only when the project itself is being
  // saved: an edit of the greeting alone must not pick up a staged upload and quietly replace a stored image.
  let collected = { ok: true, images: new Map() };
  if (draft) {
    collected = await collectListingImages(kv, {
      callerId: auth.githubId, stagedItem: stagedItem || `project:${draft.slug}`, id: creating ? null : id, names: draft.images,
    });
  }
  if (!collected.ok) {
    return collected.error === 'image_missing'
      ? bad(400, 'image_missing', `Upload these images again before saving: ${collected.missing.join(', ')}.`, { missing: collected.missing })
      : bad(400, 'image_too_large', `These images are over 1 MB: ${collected.names.join(', ')}.`, { names: collected.names });
  }
  if (draft) {
    const size = preparedSizeProblem({ listing: draft, images: imageBytesOf(collected.images) });
    if (size) return bad(size.status, size.error, size.message);
    const taken = await slugProblem(env, io, kv, draft.slug, id);
    if (taken) return taken;
    const house = await houseProblem(env, io, kv, draft.frontmatter);
    if (house) return house;
  }

  return creating
    ? createListing({ env, kv, auth, now, rand, io, config, campaign, text, draft, binding: bind.binding, collected })
    : updateListing({ kv, auth, now, io, id, readEarlier: current, text, draft, binding: bind.binding, collected });
}

async function createListing({ kv, auth, now, rand, io, config, campaign, text, draft, binding, collected }) {
  let id = null;
  for (let i = 0; i < LISTING_ID_ATTEMPTS && !id; i += 1) {
    let candidate;
    try { candidate = mintListingId(rand(LISTING_ID_BYTES)); } catch { break; }
    if (!(await readListing(kv, candidate))) id = candidate;
  }
  if (!id) return bad(503, 'mint_failed', 'Could not mint a listing id. Try again.');
  const minted = await mintUniqueInvite(kv, campaign, rand, { config, now });
  if (!minted.ok) return bad(minted.status, minted.error, minted.message);
  const code = minted.code;
  const bound = binding ?? null;
  const login = preparerLogin(auth);

  let inv;
  let rec;
  try {
    inv = newInvite({
      campaign, code, issuedBy: auth.githubId, issuedByLogin: login, note: '', expiresAt: null, now,
      listingId: id, boundGithubId: bound?.boundGithubId ?? null, boundLogin: bound?.boundLogin ?? null,
    });
    rec = newListing({
      id, draft, recipientName: text.recipientName, message: text.message, campaign, code,
      boundGithubId: bound?.boundGithubId ?? null, boundLogin: bound?.boundLogin ?? null,
      preparedBy: auth.githubId, preparedByLogin: login, now,
    });
  } catch {
    return bad(400, 'invalid', 'This listing could not be recorded as given.');
  }

  const images = await writeCollectedImages(kv, id, collected.images, { now });
  if (!images.ok) { await deleteListingImages(kv, id); return unavailable(); }
  if (!(await writeInvite(kv, inv))) { await deleteListingImages(kv, id); return unavailable(); }
  if (!(await writeListing(kv, rec))) {
    // The invitation must not outlive a listing that was never stored: revoke it, then clear the images.
    const r = revokeInvite(inv, { by: auth.githubId, now });
    if (r.changed) await writeInvite(kv, r.next);
    await deleteListingImages(kv, id);
    return unavailable();
  }
  await deleteStagedCopies(kv, collected.images);
  return { status: 200, body: { ok: true, created: true, changed: true, listing: listingSummary(rec, inv, now), code, link: claimLink(io.siteBase, code) } };
}

async function updateListing({ kv, auth, now, io, id, readEarlier, text, draft, binding, collected }) {
  // RE-READ BEFORE THE FIRST WRITE (review F1). saveListing read the listing and then waited on GitHub (the login
  // lookup, the uncached permalink check, the house lists), and a claim can take its lock in that gap. Writing the
  // copy read before it back would wipe the lock while the claim's pull request is open: nothing would ever finalize
  // it, the invitation could grant a year again, and a second account could open a second pull request for the same
  // permalink (amendment 10 forbids exactly that). So the edit applies to the records as they are NOW, and refuses
  // when a claim started or another save, revoke or send again landed first.
  const first = await rereadListing(kv, id, readEarlier);
  if (first.res) return first.res;
  const current = first.rec;
  const invite = await readInvite(kv, current.code);
  if (claimHoldsInvite(invite, now)) return notEditable();

  const edit = {};
  if (draft) edit.draft = draft;
  if (text) { edit.recipientName = text.recipientName; edit.message = text.message; }
  if (binding !== undefined) edit.binding = binding;
  const applied = applyListingEdit(current, edit, { now, invite });
  if (!applied.ok) {
    const status = applied.error === 'not_editable' || applied.error === 'binding_locked' ? 409 : 400;
    return bad(status, applied.error, applied.message);
  }
  const next = applied.next;

  // New or replaced image bytes first, so the record never names an image that is not stored.
  const images = await writeCollectedImages(kv, id, collected.images, { now });
  if (!images.ok) return unavailable();

  // The invite's binding follows the listing's, so the two can never disagree about who the invitation is for.
  let nextInvite = invite;
  const bindingMoved = (next.boundGithubId ?? null) !== (current.boundGithubId ?? null) || (next.boundLogin ?? null) !== (current.boundLogin ?? null);
  if (bindingMoved && invite) {
    const b = setInviteBinding(invite, { boundGithubId: next.boundGithubId ?? null, boundLogin: next.boundLogin ?? null, now });
    if (b.changed) {
      if (!(await writeInvite(kv, b.next))) return unavailable();
      nextInvite = b.next;
    }
  }
  if (applied.changed) {
    // And once more right before the one write that could erase a claim lock, so the window a claim can still slip
    // through is this single KV round trip (KV has no compare-and-set; api-contract section 18 records the residual).
    // takeClaim writes the listing lock BEFORE it marks the invite, so a lock taken now is already visible here.
    const again = await rereadListing(kv, id, current);
    if (again.res) {
      if (nextInvite !== invite) await restoreInviteBinding(kv, current.code, current, now);
      return again.res;
    }
    if (!(await writeListing(kv, next))) {
      if (nextInvite !== invite) await restoreInviteBinding(kv, current.code, current, now); // the old tie beside the old record
      return unavailable();
    }
  }
  if (applied.removedImages.length) await deleteListingImageNames(kv, id, applied.removedImages);
  await deleteStagedCopies(kv, collected.images);
  return {
    status: 200,
    body: {
      ok: true, created: false, changed: applied.changed || images.written.length > 0,
      listing: listingSummary(next, nextInvite, now), code: next.code, link: claimLink(io.siteBase, next.code),
    },
  };
}

// ---- revoke, send again, delete -------------------------------------------------------------------------------

async function loadForOp(kv, body) {
  const id = String(body?.id ?? '');
  if (!isListingId(id)) return { res: bad(400, 'bad_request', 'The listing id is not valid.') };
  const rec = await readListing(kv, id);
  if (!rec) return { res: bad(404, 'not_found', 'No prepared listing has that id.') };
  return { id, rec };
}

/**
 * `{ op: 'revoke', id }`. The invitation is revoked FIRST, so a failure between the two writes leaves a dead link
 * rather than a free year anybody holding the link could still redeem; the listing is then marked revoked, which
 * is what the public read and the claim check. A redeemed invite cannot be revoked (its year is already live) and is
 * left as it is: the revoked listing alone stops the claim.
 */
async function revokeListingOp(body, { kv, auth, now }) {
  const { id, rec, res } = await loadForOp(kv, body);
  if (res) return res;
  const r = listingRevoke(rec, { by: auth.githubId, now });
  if (!r.ok) return bad(409, r.error, r.message);
  let invite = await readInvite(kv, rec.code);
  if (invite && invite.listingId === id) {
    const ri = revokeInvite(invite, { by: auth.githubId, now });
    if (ri.changed) {
      if (!(await writeInvite(kv, ri.next))) return unavailable();
      invite = ri.next;
    }
  }
  if (!r.changed) return { status: 200, body: { ok: true, changed: false, listing: listingSummary(r.next, invite, now) } };
  // Re-read before marking the listing (review F1): a claim may have taken its lock while the invite was revoked, and
  // writing the copy read before would erase that lock. A claim that got there first keeps its lock (its own invite
  // write then fails on the revoked invite, and it releases the lock itself); a send again that moved the listing to a
  // new code is refused, because this revoke never touched the new invitation.
  const again = await readListing(kv, id);
  if (!again) return bad(404, 'not_found', 'No prepared listing has that id.');
  if (again.code !== rec.code) return listingChanged();
  const r2 = listingRevoke(again, { by: auth.githubId, now });
  if (!r2.ok) return bad(409, r2.error, r2.message);
  if (r2.changed && !(await writeListing(kv, r2.next))) return unavailable();
  return { status: 200, body: { ok: true, changed: r2.changed, listing: listingSummary(r2.next, invite, now) } };
}

/**
 * `{ op: 'resend', id, campaign? }`. Only after a revoke: the same listing under a newly minted invitation, with the
 * same binding and no expiry. The old code joins `priorCodes`, and every old link stays inactive because the public
 * read requires the listing's current code. An old invite still issued (a revoke whose invite write failed) is
 * revoked here first, so no old link can grant a year.
 */
async function resendListingOp(body, { kv, auth, now, rand, io }) {
  const { id, rec, res } = await loadForOp(kv, body);
  if (res) return res;
  if (listingState(rec) !== LISTING_STATE.revoked) return bad(409, 'not_revoked', 'Revoke the current invitation before sending it again.');
  const config = await readCouponsConfig(kv, now);
  if (!config) return unavailable('The campaign registry is not readable right now. Try again shortly.');
  const campaign = blank(body?.campaign) ? rec.campaign : normalizeCouponCode(body.campaign);
  if (!couponByCode(config, campaign, now)) return bad(400, 'unknown_campaign', 'Choose an active campaign for the free year.');

  const old = await readInvite(kv, rec.code);
  if (old && inviteState(old, now) === INVITE_STATE.issued) {
    const ro = revokeInvite(old, { by: auth.githubId, now });
    if (ro.changed && !(await writeInvite(kv, ro.next))) return unavailable();
  }

  const minted = await mintUniqueInvite(kv, campaign, rand, { config, now });
  if (!minted.ok) return bad(minted.status, minted.error, minted.message);
  const r = listingResend(rec, { code: minted.code, campaign, now });
  if (!r.ok) return bad(r.error === 'not_revoked' ? 409 : 400, r.error, r.message);
  let inv;
  try {
    inv = newInvite({
      campaign, code: minted.code, issuedBy: auth.githubId, issuedByLogin: preparerLogin(auth), note: '', expiresAt: null, now,
      listingId: id, boundGithubId: rec.boundGithubId ?? null, boundLogin: rec.boundLogin ?? null,
    });
  } catch {
    return bad(400, 'invalid', 'The stored binding could not be read. Edit the listing and set the GitHub account again.');
  }
  if (!(await writeInvite(kv, inv))) return unavailable();
  if (!(await writeListing(kv, r.next))) {
    const rv = revokeInvite(inv, { by: auth.githubId, now });
    if (rv.changed) await writeInvite(kv, rv.next);
    return unavailable();
  }
  return { status: 200, body: { ok: true, listing: listingSummary(r.next, inv, now), code: minted.code, link: claimLink(io.siteBase, minted.code) } };
}

const publishingRefusal = () => bad(409, 'publishing', 'A claim for this listing is being published. Wait for its pull request to merge or close.');

/**
 * `{ op: 'delete', id }`. Removes the listing and its images, revoking its invitation first (an issued invite whose
 * listing is gone would still grant a free year to anybody holding the link). Refused while a claim is being
 * published. Images go before the record, so a failed image delete leaves the record for the retry to finish.
 */
async function deleteListingOp(body, { kv, auth, now }) {
  const { id, rec, res } = await loadForOp(kv, body);
  if (res) return res;
  if (listingState(rec) === LISTING_STATE.publishing) return publishingRefusal();
  const codes = [rec.code, ...(Array.isArray(rec.priorCodes) ? rec.priorCodes : [])].filter(Boolean);
  for (const code of codes) {
    const inv = await readInvite(kv, code);
    if (!inv || inv.listingId !== id) continue;
    const r = revokeInvite(inv, { by: auth.githubId, now });
    if (r.changed && !(await writeInvite(kv, r.next))) return unavailable();
  }
  // Re-read before removing anything (review F1). A claim that took its lock meanwhile keeps its listing; a send
  // again that minted a new code, or any other save, is refused, because the loop above never revoked a new
  // invitation and deleting the listing would leave it able to grant a year. A CLAIMED listing may still be deleted
  // (the manager offers it: the record is all that is left).
  const again = await readListing(kv, id);
  if (!again) return bad(404, 'not_found', 'No prepared listing has that id.');
  if (listingState(again) === LISTING_STATE.publishing) return publishingRefusal();
  if (again.code !== rec.code || (again.updatedAt ?? null) !== (rec.updatedAt ?? null)) return listingChanged();
  const images = await deleteListingImages(kv, id);
  if (!images.ok) return unavailable();
  if (!(await deleteListing(kv, id))) return unavailable();
  return { status: 200, body: { ok: true, deleted: true, id } };
}

// ---- the routes -----------------------------------------------------------------------------------------------

/**
 * GET /membership/admin/prepared. `finalize` (optional) is `async ({ listing, invite }) => ({ listing, invite })`,
 * the claim module's check of a publishing row's pull request; when supplied, up to FINALIZE_PER_LIST such rows (the
 * newest claims first) are brought up to date before the list is answered. A finalize that throws leaves its row as
 * it was.
 */
export async function membershipPreparedGet(request, env, { authorize = authorizeSuperadmin, now = new Date(), finalize = null, siteBase = null, ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env?.SIGNUP_KV;
  if (!kv) return unavailable();
  const base = siteBase || env?.SITE_BASE_URL || 'https://gbti.network';
  const params = new URL(request.url).searchParams;
  const id = params.get('id');

  if (blank(id)) {
    const all = await listListings(kv);
    if (!all) return unavailable();
    const rows = [];
    // Which publishing rows to bring up to date: the NEWEST claims first, not the first rows in key order. Listing
    // ids are random, so key order is fixed but arbitrary, and five claims stuck open would otherwise take every
    // load. The newest are the ones a superadmin most likely just heard about; the scheduled sweep rotates through
    // the rest (prepared-claim-sweep.mjs), so nothing depends on the manager reaching them.
    const toFinalize = new Set(typeof finalize !== 'function' ? [] : all
      .map(({ rec }) => rec)
      .filter((rec) => rec && listingState(rec) === LISTING_STATE.publishing && rec.prNumber)
      .sort((a, b) => String(b.claimPendingAt ?? '').localeCompare(String(a.claimPendingAt ?? '')))
      .slice(0, FINALIZE_PER_LIST));
    for (const { id: key, rec } of all) {
      if (!rec) { rows.push({ id: key, key, state: LISTING_STATE.unknown, corrupt: true }); continue; }
      let listing = rec;
      let invite = await readInvite(kv, rec.code);
      if (toFinalize.has(rec)) {
        try {
          const f = await finalize({ listing, invite });
          if (isPlainObject(f?.listing)) listing = f.listing;
          if (isPlainObject(f?.invite)) invite = f.invite;
        } catch { /* the row stays as it was; the scheduled sweep finalizes it */ }
      }
      const s = listingSummary(listing, invite, now);
      rows.push(s.state === LISTING_STATE.unknown || s.id !== key ? { ...s, id: s.id || key, key, corrupt: true } : s);
    }
    rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    return { status: 200, body: { ok: true, listings: rows } };
  }

  if (!isListingId(id)) return bad(400, 'bad_request', 'The listing id is not valid.');
  const image = params.get('image');
  if (image !== null) {
    if (!isListingImageName(image)) return bad(400, 'bad_request', 'A valid image name is required.');
    const img = await readListingImage(kv, id, image);
    if (!img) return bad(404, 'not_found', 'That image is not stored for this listing.');
    return { status: 200, body: { ok: true, name: image, dataBase64: img.dataBase64, contentType: img.contentType } };
  }
  const rec = await readListing(kv, id);
  if (!rec) return bad(404, 'not_found', 'No prepared listing has that id.');
  const invite = await readInvite(kv, rec.code);
  return { status: 200, body: { ok: true, listing: listingAdminView(rec, invite, now), link: claimLink(base, rec.code) } };
}

/**
 * POST /membership/admin/prepared `{ op, ... }`. Injectable for tests: `authorize`, `now`, `randomBytes`
 * (`(n) => Uint8Array`), `lookupUser`, `readTree`, `loadHouse`, `getToken`, `fetchImpl`, `upstream`, `siteBase`.
 * Everything else in `deps` (allowCookie, fetchUser, verifyCookie) goes to the superadmin gate.
 */
export async function membershipPreparedPost(request, env, {
  authorize = authorizeSuperadmin, now = new Date(), randomBytes = null,
  lookupUser, readTree, loadHouse, getToken, fetchImpl, upstream, siteBase, ...deps
} = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env?.SIGNUP_KV;
  if (!kv) return unavailable();

  let body;
  try { body = await request.json(); } catch { return bad(400, 'bad_request', 'A JSON body is required.'); }
  if (!isPlainObject(body)) return bad(400, 'bad_request', 'A JSON body is required.');

  const rand = typeof randomBytes === 'function' ? randomBytes : (n) => crypto.getRandomValues(new Uint8Array(n));
  const io = ioFrom(env, { lookupUser, readTree, loadHouse, getToken, fetchImpl, upstream, siteBase });
  const ctx = { env, kv, auth, now, rand, io };
  switch (body.op) {
    case 'save': return saveListing(body, ctx);
    case 'revoke': return revokeListingOp(body, ctx);
    case 'resend': return resendListingOp(body, ctx);
    case 'delete': return deleteListingOp(body, ctx);
    default: return bad(400, 'bad_request', "op must be 'save', 'revoke', 'resend' or 'delete'.");
  }
}
