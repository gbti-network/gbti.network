// sow-427: PREPARED PROJECT LISTINGS, the pure core. A superadmin writes a project for someone who is not a member
// yet; it waits in KV (never the repository), and a personal invitation lets that person claim it under their own
// name with a free year. This module holds everything about that which can be decided without a network: the KV
// key shapes, the sanitizers for the greeting and the message, the validation of the prepared project, the record
// and its state machine, what a signed-out visitor may see, and the claim decision. Node-free, so the Worker, the
// website, the agent tools and the tests share one implementation.
//
// THE STORAGE BOUNDARY IS WHY THIS EXISTS AT ALL (owner decision 1). A project written about a named person who has
// not agreed to anything is per-person state, and a `status: draft` file would still be public on GitHub, forkable
// and in history forever. So the prepared copy lives here, keyed by a listing id, and only the claimed, consented
// project ever reaches git.
//
// THE CLAIM PUBLISHES EXACTLY WHAT WAS PREPARED. The stored record IS the superadmin's approval of a public project,
// so the claimant supplies only their own author note. Nothing in this module takes a frontmatter or a body from
// the claimant, and nothing here should ever start to. The record may carry a SUGGESTED note (sow-434), but that is
// only the text the claim dialog starts from: the note that is published is whatever the claimant submits.
//
// No logging anywhere in this module, and none may be added: the invitation code is a bearer secret, and the title,
// the greeting name, the message and the suggested note are about a person who has not agreed to anything yet.

import { INVITE_STATE, inviteState, bindingRefuses } from './invites.mjs';
import { normalizeCouponCode, COUPON_CODE_RE } from './coupons.mjs';
import { buildContentFile, ContentValidationError } from '../client/src/content-ops.mjs';
import { schemaFor } from '../client/src/schemas.mjs';

// The browser-safe half lives in its own module (see its header); everything there is re-exported from here, so
// a server-side caller keeps one import path.
export * from './prepared-listings-shared.mjs';
import { GITHUB_ID_RE, LISTING_STATE, PLACEHOLDER_FOLDER, PREPARED_MAX_IMAGES, PREPARED_SLUG_MAX, SLUG_RE, isListingId, listingImageRefs, normalizeGithubLogin, sanitizeMessage, sanitizeRecipientName, sanitizeSuggestedNote, validateSuggestedNote } from './prepared-listings-shared.mjs';

// ---- validating a prepared project ----------------------------------------------------------------------------

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Fields the server owns. They are dropped silently, because the editor sends several of them by default
// (status, visibility, publishedAt) and the claim sets them itself: published, public, dated at the claim.
const SERVER_FIELDS = Object.freeze(['type', 'author', 'status', 'visibility', 'publishedAt', 'updatedAt', 'contributors', 'redirectFrom']);
// Every field a project may carry: the client schema's keys plus `newsFeed`, which the site schema has and the
// client mirror does not. Anything else is refused rather than dropped, so an agent learns about a typo.
const PROJECT_KEYS = new Set([...Object.keys(schemaFor('project')?.shape ?? {}), 'newsFeed']);
const MEMBERS_MARKER = '<!-- members-only -->';

/** Why `v` is not an http or https URL, or null when it is one. */
function httpUrlProblem(v, { httpsOnly = false } = {}) {
  if (typeof v !== 'string' || !v.trim()) return 'must be a link';
  let u;
  try { u = new URL(v.trim()); } catch { return 'must be a full link starting with https://'; }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && !httpsOnly) return null;
  return httpsOnly ? 'must be an https link' : 'must be an http or https link';
}

/**
 * The frontmatter the claim builds the project file from: the prepared fields plus what the claim decides
 * (the slug, published, public, the claim date). `author` is forced to the claimant's folder by buildContentFile.
 * One function, used by the save-time dry run and by the claim, so the two build the same file.
 */
export function claimProjectInput(frontmatter, { slug, publishedAt } = {}) {
  const fm = isPlainObject(frontmatter) ? { ...frontmatter } : {};
  for (const k of SERVER_FIELDS) delete fm[k];
  return { ...fm, slug, status: 'published', visibility: 'public', publishedAt };
}

/**
 * Validate a project a superadmin prepared, before anything is stored.
 *
 * @param {{ type, slug, frontmatter, body }} draft
 * @returns `{ ok: true, draft: { type: 'project', slug, frontmatter, body, images } }`, with server fields stripped
 *          and `images` the referenced file names; or `{ ok: false, error, issues: [string] }`, where error is
 *          'unsupported_type', 'bad_slug' or 'invalid'.
 *
 * Checks, all of which also run again at the claim:
 *   - projects only (owner decision 9), and a slug of at most PREPARED_SLUG_MAX in the slug alphabet;
 *   - no member-only gating of any kind (encryptedBody, publicStub, the members-only marker, an encrypted link),
 *     because the claim publishes public and a gated body would publish its plaintext;
 *   - every link field is http or https, and newsFeed is https (a `javascript:` link passes the schema's url()
 *     check, and this page is public);
 *   - every image reference is `./images/<lowercase name>`, at most PREPARED_MAX_IMAGES of them;
 *   - a non-blank title, and the project schema itself, by building the file for a placeholder folder.
 * Taxonomy and licence need the house lists, so they are checked by listingHouseProblems in
 * membership/prepared-claim-files.mjs, and the size limits by preparedSizeProblem beside it.
 */
export function validatePreparedDraft({ type, slug, frontmatter, body = '' } = {}) {
  if (type !== 'project') return { ok: false, error: 'unsupported_type', issues: ['Only a project can be prepared for someone.'] };
  if (!isPlainObject(frontmatter)) return { ok: false, error: 'invalid', issues: ['The project fields are missing.'] };
  if (body !== undefined && body !== null && typeof body !== 'string') return { ok: false, error: 'invalid', issues: ['The body must be text.'] };
  const given = slug !== undefined && slug !== null && slug !== '' ? slug : frontmatter.slug;
  const s = String(given ?? '').trim();
  if (frontmatter.slug !== undefined && frontmatter.slug !== null && frontmatter.slug !== '' && String(frontmatter.slug) !== s) {
    return { ok: false, error: 'bad_slug', issues: ['The permalink in the fields does not match the permalink given.'] };
  }
  if (!SLUG_RE.test(s) || s.length > PREPARED_SLUG_MAX) {
    return { ok: false, error: 'bad_slug', issues: [`The permalink must be lowercase letters, digits and hyphens, at most ${PREPARED_SLUG_MAX} characters.`] };
  }
  const text = typeof body === 'string' ? body : '';

  const issues = [];
  const fm = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (SERVER_FIELDS.includes(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    if (k === 'publicStub') { if (v === true) issues.push('A prepared project is published to everyone, so it cannot have a members-only stub.'); continue; }
    if (k === 'encryptedBody') { issues.push('A prepared project cannot carry a members-only body.'); continue; }
    if (!PROJECT_KEYS.has(k)) { issues.push(`"${k}" is not a project field.`); continue; }
    fm[k] = v;
  }
  fm.slug = s;
  if (text.includes(MEMBERS_MARKER)) issues.push('The body has a members-only section, and a prepared project is published to everyone.');

  if (fm.links !== undefined) {
    if (!Array.isArray(fm.links)) issues.push('links must be a list.');
    else {
      fm.links.forEach((l, i) => {
        if (!isPlainObject(l)) { issues.push(`links[${i}] must be an object with a url.`); return; }
        if (l.encrypted === true) issues.push(`links[${i}] is encrypted, and a prepared project is published to everyone.`);
        const p = httpUrlProblem(l.url);
        if (p) issues.push(`links[${i}].url ${p}.`);
      });
    }
  }
  for (const k of ['pricingUrl', 'licenseUrl', 'video']) {
    if (fm[k] === undefined) continue;
    const p = httpUrlProblem(fm[k]);
    if (p) issues.push(`${k} ${p}.`);
  }
  if (fm.newsFeed !== undefined) {
    const p = httpUrlProblem(fm.newsFeed, { httpsOnly: true });
    if (p) issues.push(`newsFeed ${p}.`);
  }

  if (typeof fm.title !== 'string' || !fm.title.trim()) issues.push('The title must not be blank.');

  const refs = listingImageRefs(fm, text);
  for (const b of refs.bad) issues.push(`The image ${JSON.stringify(b)} must be a lowercase png, jpg, webp or gif chosen in the editor (./images/<name>).`);
  if (refs.names.length > PREPARED_MAX_IMAGES) issues.push(`A prepared project may use at most ${PREPARED_MAX_IMAGES} images; this one uses ${refs.names.length}.`);

  try {
    buildContentFile({ type: 'project', username: PLACEHOLDER_FOLDER, input: claimProjectInput(fm, { slug: s, publishedAt: '2026-01-01T00:00:00.000Z' }), body: text });
  } catch (e) {
    if (e instanceof ContentValidationError) {
      for (const i of e.issues) issues.push(`${(i.path || []).join('.') || 'project'}: ${i.message}`);
    } else {
      issues.push('The project could not be built from these fields.');
    }
  }

  if (issues.length) return { ok: false, error: 'invalid', issues: [...new Set(issues)] };
  return { ok: true, draft: { type: 'project', slug: s, frontmatter: fm, body: text, images: refs.names } };
}

// ---- the record -----------------------------------------------------------------------------------------------


const iso = (now) => (now instanceof Date ? now : new Date(now)).toISOString();

function boundFields(boundGithubId, boundLogin) {
  const bound = boundGithubId === null || boundGithubId === undefined || boundGithubId === '' ? null : String(boundGithubId);
  if (bound !== null && !GITHUB_ID_RE.test(bound)) throw new Error('prepared-listings: invalid bound account number');
  return { boundGithubId: bound, boundLogin: bound ? (normalizeGithubLogin(String(boundLogin ?? '')) || null) : null };
}

/**
 * A new listing record from a VALIDATED draft (validatePreparedDraft's `draft`). Throws on anything malformed:
 * the route validates first, so a throw here is a programming error, never a user one. `suggestedNote` is optional
 * (sow-434) and stored as '' when there is none; the route checks its length with validateSuggestedNote first.
 */
export function newListing({
  id, draft, recipientName, message, suggestedNote = '', campaign, code,
  boundGithubId = null, boundLogin = null, preparedBy, preparedByLogin = null, now = new Date(),
} = {}) {
  if (!isListingId(id)) throw new Error('prepared-listings: invalid listing id');
  if (!draft || draft.type !== 'project' || !isPlainObject(draft.frontmatter) || !SLUG_RE.test(String(draft.slug ?? ''))) {
    throw new Error('prepared-listings: a validated project draft is required');
  }
  const c = normalizeCouponCode(code);
  const camp = normalizeCouponCode(campaign);
  if (!COUPON_CODE_RE.test(c)) throw new Error('prepared-listings: invalid invitation code');
  if (!COUPON_CODE_RE.test(camp)) throw new Error('prepared-listings: invalid campaign code');
  if (!GITHUB_ID_RE.test(String(preparedBy ?? ''))) throw new Error('prepared-listings: invalid preparer account number');
  const at = iso(now);
  return {
    v: 1,
    id,
    type: 'project',
    slug: draft.slug,
    title: String(draft.frontmatter.title ?? ''),
    frontmatter: draft.frontmatter,
    body: typeof draft.body === 'string' ? draft.body : '',
    images: Array.isArray(draft.images) ? [...draft.images] : [],
    recipientName: sanitizeRecipientName(recipientName),
    message: sanitizeMessage(message),
    suggestedNote: sanitizeSuggestedNote(suggestedNote),
    campaign: camp,
    code: c,
    priorCodes: [],
    ...boundFields(boundGithubId, boundLogin),
    preparedBy: String(preparedBy),
    preparedByLogin: preparedByLogin ? String(preparedByLogin) : null,
    createdAt: at,
    updatedAt: at,
    revokedAt: null,
    revokedBy: null,
    claimPendingAt: null,
    claimPendingBy: null,
    prNumber: null,
    claimedAt: null,
    claimedBy: null,
    claimedLogin: null,
    claimedFolder: null,
    claimedPath: null,
  };
}

/** The listing's own state: claimed, then publishing (a claim lock or pull request), then revoked, then prepared. */
export function listingState(rec) {
  if (!isPlainObject(rec) || !isListingId(rec.id)) return LISTING_STATE.unknown;
  if (rec.claimedAt) return LISTING_STATE.claimed;
  if (rec.claimPendingAt || rec.claimPendingBy) return LISTING_STATE.publishing;
  if (rec.revokedAt) return LISTING_STATE.revoked;
  return LISTING_STATE.prepared;
}

/**
 * Apply an edit from the superadmin. Allowed only while the listing is prepared or revoked. Returns
 * `{ ok: true, next, changed, removedImages }` or `{ ok: false, error, message }`.
 *
 * @param edit `{ draft?, recipientName?, message?, suggestedNote?, binding? }`. `draft` is a validated draft;
 *             `suggestedNote` of '' or null clears it (it is optional); `binding` is `{ boundGithubId, boundLogin }`,
 *             or null to untie it, or undefined to leave it.
 * @param invite the listing's current invite, used to refuse a binding change once the invitation is redeemed or
 *             claimed: the year already went to one account, and moving the tie would hand the project to another.
 * `removedImages` names the stored images the new draft no longer references, for the route to delete.
 * The campaign and the code are not editable here; "Send again" (listingResend) is how the code changes.
 */
export function applyListingEdit(rec, edit = {}, { now = new Date(), invite = null } = {}) {
  const st = listingState(rec);
  if (st !== LISTING_STATE.prepared && st !== LISTING_STATE.revoked) {
    return { ok: false, error: 'not_editable', message: 'This listing is being published or was already claimed, so it can no longer be edited.' };
  }
  const next = { ...rec };
  let removedImages = [];
  if (edit.draft !== undefined) {
    const d = edit.draft;
    if (!d || d.type !== 'project' || !isPlainObject(d.frontmatter) || !SLUG_RE.test(String(d.slug ?? ''))) {
      return { ok: false, error: 'invalid', message: 'The project fields are missing.' };
    }
    const images = Array.isArray(d.images) ? [...d.images] : [];
    removedImages = (rec.images || []).filter((n) => !images.includes(n));
    Object.assign(next, { slug: d.slug, title: String(d.frontmatter.title ?? ''), frontmatter: d.frontmatter, body: typeof d.body === 'string' ? d.body : '', images });
  }
  if (edit.recipientName !== undefined) {
    const name = sanitizeRecipientName(edit.recipientName);
    if (!name) return { ok: false, error: 'recipient_required', message: 'Enter the name the invitation should greet them by.' };
    next.recipientName = name;
  }
  if (edit.message !== undefined) {
    const text = sanitizeMessage(edit.message);
    if (!text) return { ok: false, error: 'message_required', message: 'Write the personal message the invitation shows them.' };
    next.message = text;
  }
  if (edit.suggestedNote !== undefined) {
    const v = validateSuggestedNote(edit.suggestedNote);
    if (!v.ok) return { ok: false, error: v.error, message: v.message };
    // Compared with what the record holds (a listing saved before sow-434 has no field at all), so saving an
    // untouched form is still no change and does not move updatedAt.
    if (v.suggestedNote !== (typeof rec.suggestedNote === 'string' ? rec.suggestedNote : '')) next.suggestedNote = v.suggestedNote;
  }
  if (edit.binding !== undefined) {
    let b;
    try { b = boundFields(edit.binding?.boundGithubId ?? null, edit.binding?.boundLogin ?? null); }
    catch { return { ok: false, error: 'invalid', message: 'The GitHub account could not be read.' }; }
    if (b.boundGithubId !== (rec.boundGithubId ?? null)) {
      const ist = invite ? inviteState(invite, now) : INVITE_STATE.unknown;
      if (ist !== INVITE_STATE.issued && ist !== INVITE_STATE.revoked && ist !== INVITE_STATE.expired) {
        return { ok: false, error: 'binding_locked', message: 'The invitation was already used, so the GitHub account it is tied to can no longer change.' };
      }
    }
    Object.assign(next, b);
  }
  const changed = JSON.stringify(next) !== JSON.stringify(rec);
  if (changed) next.updatedAt = iso(now);
  return { ok: true, next: changed ? next : rec, changed, removedImages };
}

/** Revoke a prepared listing (the route also revokes its invite). Idempotent; refused once publishing or claimed. */
export function listingRevoke(rec, { by = null, now = new Date() } = {}) {
  const st = listingState(rec);
  if (st === LISTING_STATE.revoked) return { ok: true, next: rec, changed: false };
  if (st !== LISTING_STATE.prepared) return { ok: false, error: 'not_revocable', message: 'This listing is being published or was already claimed.' };
  return { ok: true, next: { ...rec, revokedAt: iso(now), revokedBy: by === null ? null : String(by), updatedAt: iso(now) }, changed: true };
}

/**
 * "Send again" after a revoke: the same listing under a newly minted invitation code (and optionally a new
 * campaign). The old code moves to `priorCodes`, so the record still explains every link it was ever sent under,
 * and every one of those old links stays inactive because publicReadable requires `listing.code === invite.code`.
 */
export function listingResend(rec, { code, campaign = null, now = new Date() } = {}) {
  if (listingState(rec) !== LISTING_STATE.revoked) return { ok: false, error: 'not_revoked', message: 'Revoke the current invitation before sending it again.' };
  const c = normalizeCouponCode(code);
  if (!COUPON_CODE_RE.test(c)) return { ok: false, error: 'invalid', message: 'The new invitation code is not valid.' };
  const camp = campaign ? normalizeCouponCode(campaign) : rec.campaign;
  if (!COUPON_CODE_RE.test(camp)) return { ok: false, error: 'invalid', message: 'The campaign is not valid.' };
  const priorCodes = [...(Array.isArray(rec.priorCodes) ? rec.priorCodes : []), rec.code].filter(Boolean);
  return { ok: true, next: { ...rec, code: c, campaign: camp, priorCodes, revokedAt: null, revokedBy: null, updatedAt: iso(now) } };
}

// ---- the claim lock -------------------------------------------------------------------------------------------

/**
 * Take the claim lock for `githubId`. Returns `{ ok: true, next, changed }` or `{ ok: false, error }` where error
 * is 'claimed', 'revoked', 'locked' (another account holds it) or 'invalid'.
 *
 * THE LOCK HAS NO EXPIRY (amendment 10). It lasts while the stored pull request is OPEN, because a second claimant
 * let in after a timeout would open a second pull request with the same slug into a different folder. Only a pull
 * request that CLOSED without merging releases it, and the route checks that on GitHub and calls
 * releaseListingClaimLock first. The same claimant taking it again is accepted and keeps the stored number.
 */
export function takeListingClaimLock(rec, { githubId, now = new Date() } = {}) {
  const id = String(githubId ?? '');
  if (!GITHUB_ID_RE.test(id)) return { ok: false, error: 'invalid' };
  const st = listingState(rec);
  if (st === LISTING_STATE.claimed) return { ok: false, error: 'claimed' };
  if (st === LISTING_STATE.revoked) return { ok: false, error: 'revoked' };
  if (st === LISTING_STATE.publishing) {
    if (String(rec.claimPendingBy ?? '') !== id) return { ok: false, error: 'locked' };
    return { ok: true, next: rec, changed: false };
  }
  if (st !== LISTING_STATE.prepared) return { ok: false, error: 'invalid' };
  return { ok: true, next: { ...rec, claimPendingAt: iso(now), claimPendingBy: id, prNumber: null }, changed: true };
}

/** Store the claim pull request number under the lock `githubId` holds. `{ ok, next, changed }` or `{ ok: false }`. */
export function recordListingClaimPr(rec, { githubId, prNumber } = {}) {
  if (listingState(rec) !== LISTING_STATE.publishing || String(rec.claimPendingBy ?? '') !== String(githubId ?? '')) return { ok: false, error: 'not_locked' };
  if (!Number.isInteger(prNumber) || prNumber < 1) return { ok: false, error: 'invalid' };
  if (rec.prNumber === prNumber) return { ok: true, next: rec, changed: false };
  return { ok: true, next: { ...rec, prNumber }, changed: true };
}

/** Release the lock: the pull request closed without merging, or the claim failed before opening one. */
export function releaseListingClaimLock(rec) {
  if (!isPlainObject(rec) || rec.claimedAt) return { next: rec, changed: false };
  if (!rec.claimPendingAt && !rec.claimPendingBy && !rec.prNumber) return { next: rec, changed: false };
  return { next: { ...rec, claimPendingAt: null, claimPendingBy: null, prNumber: null }, changed: true };
}

/**
 * Mark the listing claimed once its pull request MERGED. Idempotent on `claimedAt`. Follow it with
 * minimizeClaimedListing before writing, so the project copy, the message and the images do not outlive the claim.
 */
export function markListingClaimed(rec, { githubId, login = null, folder, path, prNumber = null, now = new Date() } = {}) {
  if (!isPlainObject(rec) || !isListingId(rec.id)) return { next: rec, changed: false };
  if (rec.claimedAt) return { next: rec, changed: false };
  const id = String(githubId ?? '');
  if (!GITHUB_ID_RE.test(id)) return { next: rec, changed: false };
  const pr = Number.isInteger(prNumber) && prNumber > 0 ? prNumber : (rec.prNumber ?? null);
  return {
    next: {
      ...rec, claimedAt: iso(now), claimedBy: id, claimedLogin: login ? String(login) : null,
      claimedFolder: folder ? String(folder) : null, claimedPath: path ? String(path) : null,
      prNumber: pr, claimPendingAt: null, claimPendingBy: null, updatedAt: iso(now),
    },
    changed: true,
  };
}

/**
 * The record that stays after a claim, so the manager keeps saying "prepared for Sam, claimed 2 Oct". The project
 * copy, the body, the image list, the personal message and the suggested note go: the project now lives in the
 * repository under the claimant's name, the note that went live is the one they submitted, and text written to or for
 * someone before they joined has no reason to outlive the claim.
 */
export function minimizeClaimedListing(rec) {
  if (!isPlainObject(rec)) return rec;
  return { ...rec, frontmatter: null, body: null, message: null, suggestedNote: null, images: [], claimPendingAt: null, claimPendingBy: null };
}

// ---- views ----------------------------------------------------------------------------------------------------



/**
 * The superadmin manager's row. Never carries the personal message, the suggested note or the project body (Edit
 * loads those through listingAdminView). `inviteState` is the invitation's own state beside the listing's.
 */
export function listingSummary(rec, invite = null, now = new Date()) {
  if (!isPlainObject(rec)) return null;
  return {
    id: rec.id ?? null,
    type: rec.type ?? 'project',
    slug: rec.slug ?? null,
    title: rec.title ?? (rec.frontmatter?.title ?? null),
    recipientName: rec.recipientName ?? '',
    bound: Boolean(rec.boundGithubId),
    boundLogin: rec.boundLogin ?? null,
    campaign: rec.campaign ?? null,
    code: rec.code ?? null,
    priorCodes: Array.isArray(rec.priorCodes) ? [...rec.priorCodes] : [],
    state: listingState(rec),
    inviteState: invite ? inviteState(invite, now) : INVITE_STATE.unknown,
    redeemedByLogin: invite?.redeemedByLogin ?? null,
    preparedByLogin: rec.preparedByLogin ?? null,
    createdAt: rec.createdAt ?? null,
    updatedAt: rec.updatedAt ?? null,
    revokedAt: rec.revokedAt ?? null,
    claimPendingAt: rec.claimPendingAt ?? null,
    prNumber: rec.prNumber ?? null,
    claimedAt: rec.claimedAt ?? null,
    claimedLogin: rec.claimedLogin ?? null,
    claimedPath: rec.claimedPath ?? null,
    imageCount: Array.isArray(rec.images) ? rec.images.length : 0,
  };
}

/** The superadmin's full view, for Edit: the summary plus the fields the editor loads. Superadmin routes only. */
export function listingAdminView(rec, invite = null, now = new Date()) {
  const s = listingSummary(rec, invite, now);
  if (!s) return null;
  return {
    ...s,
    boundGithubId: rec.boundGithubId ?? null,
    message: rec.message ?? '',
    suggestedNote: typeof rec.suggestedNote === 'string' ? rec.suggestedNote : '',
    frontmatter: rec.frontmatter ?? null,
    body: rec.body ?? '',
    images: Array.isArray(rec.images) ? [...rec.images] : [],
  };
}

/**
 * What a signed-out visitor holding the link may see. NEVER the administration note (that is on the invite and is
 * not read here), never an account number, never the code. `terms` is the campaign entry (`{ tier, freeDays }`) read
 * WITHOUT the active gate, so a retired campaign does not void a sent link.
 *
 * sow-434 adds two fields for the preview that looks published. `suggestedNote` ('' when none) fills the pinned
 * "From the author" card and pre-fills the claim dialog's note box. `githubLogin` is the login of a TIED listing, so
 * the example profile can link their real GitHub page; it is null for an untied listing, and the account number the
 * tie is stored by never leaves (boundGithubId is read only to decide that a tie exists).
 */
export function publicListingView(rec, terms = null) {
  const tied = rec?.boundGithubId !== null && rec?.boundGithubId !== undefined && rec?.boundGithubId !== '';
  return {
    type: rec?.type ?? 'project',
    slug: rec?.slug ?? null,
    frontmatter: isPlainObject(rec?.frontmatter) ? rec.frontmatter : {},
    body: typeof rec?.body === 'string' ? rec.body : '',
    images: Array.isArray(rec?.images) ? [...rec.images] : [],
    recipientName: rec?.recipientName ?? '',
    message: rec?.message ?? '',
    suggestedNote: typeof rec?.suggestedNote === 'string' ? rec.suggestedNote : '',
    githubLogin: tied ? normalizeGithubLogin(String(rec.boundLogin ?? '')) : null,
    preparedByLogin: rec?.preparedByLogin ?? null,
    tier: terms?.tier ?? null,
    freeDays: Number.isInteger(terms?.freeDays) ? terms.freeDays : null,
  };
}

/**
 * True only when a signed-out visitor may see this listing through this invite: the invite is issued, redeemed or
 * has a claim pending (never revoked, expired, claimed or unreadable); the listing exists, is the one the invite
 * names, is under this very code (so a code replaced by "Send again" is dead), and is neither revoked nor claimed.
 * Every other case must produce the SAME inactive answer, with nothing about the project in it.
 */
export function publicReadable(invite, listing, now = new Date()) {
  const st = inviteState(invite, now);
  if (st !== INVITE_STATE.issued && st !== INVITE_STATE.redeemed && st !== INVITE_STATE.claim_pending) return false;
  if (!isPlainObject(listing) || !isListingId(listing.id) || invite.listingId !== listing.id) return false;
  if (normalizeCouponCode(listing.code) !== normalizeCouponCode(invite.code)) return false;
  if (listing.type !== 'project' || !isPlainObject(listing.frontmatter)) return false;
  if (listing.revokedAt || listing.claimedAt || invite.claimedAt) return false;
  return true;
}

// ---- the claim decision ---------------------------------------------------------------------------------------

/** Every state the claim status route reports. `pending_folder` and `claim_failed` are decided by the route. */
export const CLAIM_STATE = Object.freeze({
  inactive: 'inactive', // not claimable through this link by this account, and nothing more is said
  claimed: 'claimed', // this account already claimed it (a reload after publishing)
  wrong_account: 'wrong_account', // the invitation is tied to another GitHub account (owner decision 3)
  not_permitted: 'not_permitted', // a banned account
  preview_only: 'preview_only', // the superadmin who prepared it, testing their own link
  publishing: 'publishing', // this account's claim pull request is open
  redeem: 'redeem', // not paying, and signing in with the invitation would grant the free year
  year_used: 'year_used', // not paying, and this account already used its one free year (owner decision 5)
  year_unavailable: 'year_unavailable', // not paying, and the year cannot be granted for any other reason
  pending_grant: 'pending_grant', // paying through a free year the merge gate cannot see yet (trap 2)
  pending_folder: 'pending_folder', // route: paying, but no members-index folder yet (trap 2)
  ready: 'ready', // write the note and publish
  claim_failed: 'claim_failed', // route: the pull request closed without merging; the lock is released
});

// The coupon refusal reasons (workers/signup/coupons.mjs COUPON_REFUSAL) that mean "this account already had its
// one free year". Kept as literals so this node-free core does not import Worker code; a test holds the two lists
// together, so a new refusal reason cannot land without being placed.
const YEAR_USED_REASONS = new Set(['grant_expired', 'locked']);

/**
 * Map the coupon refusal reason for a not-paying account to the claim state. null (a redemption would grant a
 * year) is `redeem` only while the invite is still issued; `undefined` (nobody asked) fails closed.
 */
export function yearStateFor(yearRefusal, inviteStateNow = INVITE_STATE.issued) {
  if (yearRefusal === null) return inviteStateNow === INVITE_STATE.issued ? CLAIM_STATE.redeem : CLAIM_STATE.year_unavailable;
  if (YEAR_USED_REASONS.has(yearRefusal)) return CLAIM_STATE.year_used;
  return CLAIM_STATE.year_unavailable;
}

/**
 * The claim decision for a signed-in account, as a pure function of the stored records and the account's
 * effective membership. Returns `{ state }`, plus `slug` when the state is `claimed`.
 *
 * @param invite      the `invite:<CODE>` record the link names
 * @param listing     the `invite-listing:<ID>` record that invite names (or null)
 * @param claimantId  the verified GitHub account number of the caller
 * @param effective   resolveEffective's `{ status, source }` for the caller
 * @param yearRefusal couponRedemptionCheck's `reason` for (this code, this account): null when a redemption would
 *                    grant a year, a COUPON_REFUSAL value otherwise. Required for a not-paying account; leaving it
 *                    undefined reads as "the year cannot be granted", never as "redeem".
 *
 * Checked in this order, first match wins:
 *   0. no account number: inactive
 *   1. this account already claimed it: claimed (before anything else, so a reload after publishing succeeds)
 *   2. not publicReadable, or redeemed by another account, or a claim pending for another account: inactive
 *   3. tied to another account, unless the caller prepared it: wrong_account
 *   4. banned, or no effective status: not_permitted
 *   5. the superadmin who prepared it: preview_only (every other staff or grandfathered account claims normally)
 *   6. this account's claim is pending: publishing
 *   7. not paying: redeem, year_used or year_unavailable (yearStateFor)
 *   8. paying through a free year the merge gate cannot see yet (source coupon): pending_grant
 *   9. otherwise: ready
 */
export function claimDecision({ invite, listing, claimantId, effective, yearRefusal, now = new Date() } = {}) {
  const id = claimantId === null || claimantId === undefined ? '' : String(claimantId);
  if (!GITHUB_ID_RE.test(id)) return { state: CLAIM_STATE.inactive };

  const listingMatches = isPlainObject(listing) && isPlainObject(invite) && invite.listingId === listing.id;
  if (String(invite?.claimedBy ?? '') === id || (isPlainObject(listing) && String(listing.claimedBy ?? '') === id)) {
    const slug = (listingMatches || String(listing?.claimedBy ?? '') === id) ? (listing?.slug ?? null) : null;
    return { state: CLAIM_STATE.claimed, slug };
  }

  if (!publicReadable(invite, listing, now)) return { state: CLAIM_STATE.inactive };
  const st = inviteState(invite, now);
  if (invite.redeemedAt && String(invite.redeemedBy ?? '') !== id) return { state: CLAIM_STATE.inactive };
  const pendingIds = [invite.claimPendingBy, listing.claimPendingBy].filter((v) => v !== null && v !== undefined && v !== '').map(String);
  const pending = st === INVITE_STATE.claim_pending || Boolean(listing.claimPendingAt) || pendingIds.length > 0;
  if (pending && (pendingIds.length === 0 || pendingIds.some((p) => p !== id))) return { state: CLAIM_STATE.inactive };

  // The superadmin who prepared a TIED listing is not "another account": they opened their own link to test it (the
  // editor's Open button says so), and a wrong_account answer would greet them with a primary Sign out button. They
  // still pass the ban check below and then get preview_only, which never publishes.
  const isPreparer = String(listing.preparedBy ?? '') === id;
  const listingBoundElsewhere = listing.boundGithubId !== null && listing.boundGithubId !== undefined && listing.boundGithubId !== ''
    && String(listing.boundGithubId) !== id;
  if (!isPreparer && (bindingRefuses(invite, id) || listingBoundElsewhere)) return { state: CLAIM_STATE.wrong_account };

  if (!isPlainObject(effective) || effective.status === 'banned') return { state: CLAIM_STATE.not_permitted };
  if (isPreparer) return { state: CLAIM_STATE.preview_only };
  if (pending) return { state: CLAIM_STATE.publishing };

  if (effective.status !== 'paid') return { state: yearStateFor(yearRefusal, st) };
  if (effective.source === 'coupon') return { state: CLAIM_STATE.pending_grant };
  return { state: CLAIM_STATE.ready };
}
