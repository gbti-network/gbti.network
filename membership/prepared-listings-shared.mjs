// sow-427: the BROWSER-SAFE half of the prepared-listings core: ids and KV key shapes, the limits, the greeting,
// message and suggested-note sanitizers, image-name rules, the listing state names, and the two addresses (the claim
// link and the project page). It imports only small pure modules, so the shared UI, the extension and the agent tools
// can use it.
//
// WHY IT IS SPLIT OUT. prepared-listings.mjs validates a prepared project with the content builder and its schemas,
// which pull the whole schema library into any bundle that imports them. Importing these few helpers from there
// grew the shared UI bundle by more than half a megabyte for code the browser never runs. Anything that needs the
// validator or the record state machine imports prepared-listings.mjs, which re-exports everything here.
//
// No logging anywhere in this module, and none may be added: the invitation code is a bearer secret, and the
// greeting name, the message and the suggested note are about a person who has not agreed to anything yet.

import { alphabetSample } from './invites.mjs';
import { normalizeCouponCode } from './coupons.mjs';
import { SLUG_PATTERN } from './item-id.mjs';

// ---- keys and ids ---------------------------------------------------------------------------------------------

/**
 * `invite-listing:<ID>` holds one listing record. Deliberately NOT under `invite:`: the invite manager sweeps that
 * prefix with a literal startsWith, and a listing blob there would surface as a corrupt invite row.
 */
export const LISTING_KEY_PREFIX = 'invite-listing:';
/** `invite-listing-img:<ID>:<name>` holds one image, `{ dataBase64, contentType, bytes, at }`, like `draftimg:`. */
export const LISTING_IMG_PREFIX = 'invite-listing-img:';

/**
 * A listing id is 16 characters of the invite alphabet (about 78 bits). It is NOT the invitation code, because
 * "Send again" mints a new code for the same listing, and a code-keyed record would have to copy up to 4 MiB of
 * image bytes to a new key every time.
 */
export const LISTING_ID_LEN = 16;
const LISTING_ID_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{16}$/;
export const GITHUB_ID_RE = /^\d{1,20}$/;

/** True for a well-formed listing id. Check this before building a key from anything a request carried. */
export function isListingId(id) {
  return typeof id === 'string' && LISTING_ID_RE.test(id);
}

/** The KV key for one listing record. Throws on a malformed id, so a request value can never shape a key. */
export function listingKey(id) {
  if (!isListingId(id)) throw new Error('prepared-listings: invalid listing id');
  return `${LISTING_KEY_PREFIX}${id}`;
}

/** The KV prefix that lists one listing's images. */
export function listingImagePrefix(id) {
  if (!isListingId(id)) throw new Error('prepared-listings: invalid listing id');
  return `${LISTING_IMG_PREFIX}${id}:`;
}

/** The KV key for one listing image. The name must already be a canonical image name (isListingImageName). */
export function listingImageKey(id, name) {
  if (!isListingImageName(name)) throw new Error('prepared-listings: invalid image name');
  return `${listingImagePrefix(id)}${name}`;
}

/** Mint a listing id from caller-supplied random bytes (the Worker passes crypto.getRandomValues output). */
export function mintListingId(bytes) {
  const id = alphabetSample(bytes, LISTING_ID_LEN);
  if (!id) throw new Error('prepared-listings: not enough random bytes to mint a listing id');
  return id;
}

// ---- limits ---------------------------------------------------------------------------------------------------

/**
 * The slug cap is 64, not SLUG_MAX (120). The Worker's image-path gate (IMAGE_PATH_TAIL_RE in
 * membership/hosted-author.mjs) allows at most 64 characters for the item segment of
 * `projects/<slug>/images/<name>`, so a longer slug would prepare fine and then fail at every claim.
 */
export const PREPARED_SLUG_MAX = 64;
export const SLUG_RE = new RegExp(`^${SLUG_PATTERN}$`);
/** Twelve images plus the project, the note and the profile is 15 files, under the hosted 20-file cap. */
export const PREPARED_MAX_IMAGES = 12;
export const MAX_MESSAGE = 1000;
export const MAX_RECIPIENT_NAME = 60;
/**
 * sow-434: the longest suggested note. It is the claim note's own cap (MAX_CLAIM_NOTE in prepared-claim-files.mjs,
 * NOTE_MAX in src/lib/claim-core.mjs), because the suggestion pre-fills that box; a test holds the three together.
 */
export const MAX_SUGGESTED_NOTE = 2000;
/** The folder a size or schema dry run builds into. Never a real member folder, never committed. */
export const PLACEHOLDER_FOLDER = 'prepared-listing';

// ---- sanitizers -----------------------------------------------------------------------------------------------

// Bidirectional overrides and isolates, plus the line and paragraph separators. They can make a line render in an
// order other than the stored one, which is the kind of spoofing a personal message on a public page must not allow.
const INVISIBLE_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;

/**
 * The personal message, stored as PLAIN TEXT. Line breaks are kept (a message has paragraphs); a tab becomes a
 * space; every other control character and the bidirectional controls are removed; runs of blank lines collapse
 * to one; the whole is trimmed and capped at MAX_MESSAGE. Markup is NOT stripped or escaped here: it is stored
 * verbatim and made safe where it is rendered (text nodes and line breaks, never innerHTML), because escaping at
 * store time would show a reader literal entities.
 */
export function sanitizeMessage(s) {
  return plainText(s, MAX_MESSAGE);
}

// The plain-text rule sanitizeMessage describes, with the cap as a parameter, so the suggested note is cleaned by the
// very same steps rather than by a copy that could drift.
function plainText(s, max) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .replace(INVISIBLE_RE, '')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
    .trim();
}

/**
 * sow-434: the SUGGESTED NOTE, an optional starting point for the claimant's own author note. Plain text, cleaned
 * exactly like the message (line breaks kept, every other control and the bidirectional controls removed, blank runs
 * collapsed), capped at MAX_SUGGESTED_NOTE. '' means there is none. It is never published as it stands: the claim
 * dialog pre-fills its note box with it, and the note that goes live is the one the claimant edits or keeps and
 * submits themselves. Like the message, markup is stored verbatim and made safe where it is rendered.
 */
export function sanitizeSuggestedNote(s) {
  return plainText(s, MAX_SUGGESTED_NOTE);
}

/**
 * The suggested note a save carries, checked: `{ ok: true, suggestedNote }`, where an absent, null or blank value is
 * '' (none), or `{ ok: false, error: 'invalid' | 'suggested_note_too_long', message }`. A note over the cap is REFUSED
 * rather than cut, so nobody is handed a pre-filled note that stops mid-sentence.
 */
export function validateSuggestedNote(raw) {
  if (raw === undefined || raw === null) return { ok: true, suggestedNote: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'invalid', message: 'The suggested note must be plain text.' };
  if (plainText(raw, Infinity).length > MAX_SUGGESTED_NOTE) {
    return { ok: false, error: 'suggested_note_too_long', message: `The suggested note is longer than ${MAX_SUGGESTED_NOTE} characters. Shorten it and save again.` };
  }
  return { ok: true, suggestedNote: sanitizeSuggestedNote(raw) };
}

/** The greeting name ("Hi Sam,"): one line, controls collapsed to a space, trimmed, capped at MAX_RECIPIENT_NAME. */
export function sanitizeRecipientName(s) {
  if (typeof s !== 'string') return '';
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(INVISIBLE_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RECIPIENT_NAME)
    .trim();
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * A GitHub login as typed by a superadmin ("@Sam-Dev", " sam-dev "), or null when it cannot be one. GitHub's own
 * rule: 1 to 39 letters, digits and single hyphens, not starting or ending with a hyphen. Case is kept; the Worker
 * resolves it to the immutable account number, which is what the binding stores and compares.
 */
export function normalizeGithubLogin(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim().replace(/^@/, '');
  return LOGIN_RE.test(v) ? v : null;
}

/**
 * The greeting and the message, both required. Returns `{ ok: true, recipientName, message }` or
 * `{ ok: false, error: 'recipient_required' | 'message_required', message }` (the last is a sentence for the person).
 */
export function validateInvitationText({ recipientName, message } = {}) {
  const name = sanitizeRecipientName(recipientName);
  if (!name) return { ok: false, error: 'recipient_required', message: 'Enter the name the invitation should greet them by.' };
  const text = sanitizeMessage(message);
  if (!text) return { ok: false, error: 'message_required', message: 'Write the personal message the invitation shows them.' };
  return { ok: true, recipientName: name, message: text };
}

// ---- image references -----------------------------------------------------------------------------------------

/** The image()-typed project fields, from src/content.config.ts projectShape. `gallery` is handled separately. */
export const PROJECT_IMAGE_FIELDS = Object.freeze(['icon', 'iconLarge', 'banner', 'featuredImage']);
const IMAGE_NAME_RE = /^[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp|gif)$/;
const IMAGE_VALUE_RE = /^\.\/images\/([^/\\]+)$/;
// The markdown reference form Astro resolves, `](./images/NAME` with an optional title after it. Mirrors
// BODY_IMAGE_REF_RE in scripts/validate-content.mjs, so what this checks is what the merge-time check reads.
const BODY_IMAGE_RE = /\]\(\s*\.\/images\/([^)\s]+)/g;

/** True for a lowercase web-image file name, the only shape the Worker's image gate accepts. */
export function isListingImageName(name) {
  return typeof name === 'string' && name.length <= 128 && IMAGE_NAME_RE.test(name);
}

/**
 * Every image the prepared project references, from its image fields, its gallery and its body. Returns
 * `{ names, bad }`: `names` are the distinct canonical file names (`./images/<lowercase name>`), in first-seen
 * order; `bad` are the raw values that are not in that shape (a flat path, an uppercase name, an svg, a remote URL
 * in an image field). A bad reference is refused at preparation, because at claim time it would either be refused
 * by the Worker's lowercase image gate or merge a page the site build cannot resolve.
 */
export function listingImageRefs(frontmatter, body = '') {
  const names = [];
  const bad = [];
  const seen = new Set();
  const take = (raw) => {
    if (raw === undefined || raw === null || raw === '') return;
    const m = typeof raw === 'string' ? IMAGE_VALUE_RE.exec(raw.trim()) : null;
    if (!m || !isListingImageName(m[1])) { bad.push(typeof raw === 'string' ? raw : JSON.stringify(raw)); return; }
    if (!seen.has(m[1])) { seen.add(m[1]); names.push(m[1]); }
  };
  const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {};
  for (const k of PROJECT_IMAGE_FIELDS) take(fm[k]);
  if (Array.isArray(fm.gallery)) {
    for (const row of fm.gallery) take(typeof row === 'string' ? row : (row && typeof row === 'object' ? row.src : row));
  } else if (fm.gallery !== undefined && fm.gallery !== null) {
    bad.push('gallery');
  }
  if (typeof body === 'string') {
    for (const m of body.matchAll(BODY_IMAGE_RE)) take(`./images/${m[1]}`);
  }
  return { names, bad };
}

// ---- the record state names, and the two addresses ----------------------------------------------------------

export const LISTING_STATE = Object.freeze({
  prepared: 'prepared',
  revoked: 'revoked',
  publishing: 'publishing',
  claimed: 'claimed',
  unknown: 'unknown',
});

/** The claim page address. `/claim/` sits outside every `*-invite` lander directory on purpose. */
export function claimLink(siteBase, code) {
  const base = String(siteBase || '').replace(/\/+$/, '');
  return `${base}/claim/?code=${encodeURIComponent(normalizeCouponCode(code))}`;
}

/** The public project page for a slug, or null when there is no usable slug. */
export function projectUrl(siteBase, slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
  const base = String(siteBase || '').replace(/\/+$/, '');
  return `${base}/projects/${slug}/`;
}
