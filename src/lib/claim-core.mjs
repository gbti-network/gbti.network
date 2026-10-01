// sow-427: the pure half of the prepared-listing claim page (src/pages/claim/index.astro). Plain .mjs with no DOM
// globals and no node imports, so node --test imports it and the page's bundled script (src/lib/claim-page.ts)
// imports the same functions. Every sentence a visitor reads on the page is decided here, where the writing rules
// can be tested, and every URL the page puts in an href passes through safeHref first.
//
// WHAT THE PAGE IS. A person who is not a member yet opens /claim/?code=<CODE>. The signed-out read
// (GET /invite/listing) returns the project a superadmin prepared for them plus a greeting and a personal message;
// the page shows the project the way it will look once published, with a dialog over it. Signing in (the same
// Turnstile-gated /signup/start the invite landers use, carrying the invitation as the coupon and this page as the
// return path) grants the free year; back here, the claim status (GET /membership/claim) says what this account may
// do, and Publish (POST /membership/claim) sends only the code and the person's own note.
//
// THE TWO RULES THAT SHAPE THIS FILE.
//   1. The message and every frontmatter string are DATA. The message becomes text nodes and line breaks
//      (messageToNodes); only the markdown body renderer's output is ever parsed as HTML, and even that output has
//      its links and images re-checked by the page.
//   2. Fail closed. An unknown state, an unreadable answer or a malformed code is never shown as a claim the person
//      can make: it is the inactive panel or a retry.

import { normalizeGallery, hasCaptions, repoUrl, resolvePrimaryCta, railLinks, linkLabel, isLockedLink, resolveHero, iconForUrl } from './project-page.mjs';
import { embedUrl } from '../../client/src/video-embed.mjs';

/** An invitation code, after trimming and uppercasing: the coupon alphabet the Worker checks (COUPON_CODE_RE). */
export const CLAIM_CODE_RE = /^[A-Z0-9]{3,32}$/;
/** The claimant's note, as the Worker caps it (MAX_CLAIM_NOTE in membership/prepared-claim-files.mjs). */
export const NOTE_MAX = 2000;
/** The personal message, as the Worker caps it (MAX_MESSAGE in membership/prepared-listings.mjs). Display cap only. */
export const MESSAGE_MAX = 1000;
/** After this long waiting on a space being set up (or a publish), the page says the link keeps working. */
export const SETUP_PATIENCE_MS = 10 * 60 * 1000;
/** A page left open stops asking after this long and offers a button instead, so a forgotten tab is not a load. */
export const POLL_GIVE_UP_MS = 30 * 60 * 1000;
/** The poll schedule the plan fixes: 5, 10 and 15 seconds, then every 30. */
export const POLL_SCHEDULE_MS = Object.freeze([5000, 10000, 15000]);
export const POLL_MAX_MS = 30000;

/**
 * Every state the claim status route may answer (contract section 16.1). The page shows a claim control ONLY for a
 * state in this list; anything else the server says is treated as a failed read.
 */
export const SERVER_STATES = Object.freeze([
  'inactive', 'claimed', 'wrong_account', 'not_permitted', 'preview_only', 'publishing', 'redeem', 'year_used',
  'year_unavailable', 'pending_grant', 'pending_folder', 'ready', 'claim_failed',
]);
/** States the page adds of its own: before any answer, signed out, and the two ways a read can fail. */
export const PAGE_STATES = Object.freeze(['loading', 'checking', 'signin', 'error', 'rate_limited']);

/** The states that end the visit: nothing more happens on this page, so a new account is sent on to the welcome. */
export const TERMINAL_STATES = Object.freeze([
  'inactive', 'claimed', 'wrong_account', 'not_permitted', 'preview_only', 'year_used', 'year_unavailable',
]);
/** The states the page keeps asking about, because the server finishes them on its own. */
export const POLLING_STATES = Object.freeze(['publishing', 'pending_grant', 'pending_folder']);

const isServerState = (s) => typeof s === 'string' && SERVER_STATES.includes(s);

/**
 * @typedef {{ kind: 'link'|'signout'|'retry'|'recheck', label: string, href?: string, primary: boolean }} ClaimAction
 * @typedef {{ state: string, surface: 'dialog'|'panel', title: string, text: string, tier: boolean,
 *   signin: { label: string } | null, note: boolean, poll: boolean, busy: boolean, actions: ClaimAction[],
 *   redirect: string|null }} ClaimView
 * @typedef {{ label: string, url: string, locked: boolean, icon: string|null }} ViewLink
 * @typedef {{ title: string, description: string, crumbs: { key: string, label: string }[],
 *   hero: { image: string, preset: string|null }, mark: string, barMark: string, version: string, pricing: string,
 *   repo: { label: string, url: string, icon: string|null } | null, primary: ViewLink|null, railLinks: ViewLink[],
 *   ctaSub: string, specs: [string, string][], tags: string[], gallery: { src: string, caption: string }[],
 *   captioned: boolean, video: string|null, side: 'left'|'right', body: string }} ListingModel
 * @typedef {{ state: string, projectUrl?: string|null, retryAfterSeconds?: number|null }
 *   | { transient: true, rateLimited?: boolean }} StatusAnswer
 */

// ---------------------------------------------------------------------------------------------------------------
// The code, the query and the sign-in link

/** The invitation code in its canonical form, or null when it could not be one (checked before any request). */
export function normalizeClaimCode(raw) {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return CLAIM_CODE_RE.test(s) ? s : null;
}

/**
 * The page's own query: the code, and whether the Worker marked this a brand-new account (`welcome=1`, appended by
 * signinLanding for a created account only). A forged marker only chooses a later hand-off to /welcome/.
 */
export function parseClaimQuery(search) {
  let q;
  try { q = new URLSearchParams(typeof search === 'string' ? search : ''); } catch { q = new URLSearchParams(''); }
  return { code: normalizeClaimCode(q.get('code') || ''), welcome: q.get('welcome') === '1' };
}

/**
 * The return path the sign-in carries. It must be EXACTLY `/claim/?code=<CODE>`: signinLanding matches that whole
 * string to let a new account see the claim before the welcome steps, and anything more in the query (a `welcome`
 * already present, a hash) sends the account to the welcome first.
 */
export function claimReturnPath(code) {
  const c = normalizeClaimCode(code);
  return c ? `/claim/?code=${c}` : null;
}

/**
 * The Turnstile-gated sign-in URL: the same /signup/start the invite landers build (InviteLander.astro), with the
 * invitation as the coupon so the free year is granted at sign-in, and this page as the return path. `ref`, `via`
 * and `sid` are the referral and touch cookies, forwarded when present exactly as the landers forward them.
 * Returns null when there is no token or no valid code, so a button can never send a half-built request.
 */
/**
 * @param {{ signupBase?: string, token?: string, code?: string|null, ref?: string, via?: string, sid?: string }} [opts]
 * @returns {string|null}
 */
export function buildClaimSigninUrl({ signupBase, token, code, ref = '', via = '', sid = '' } = {}) {
  const c = normalizeClaimCode(code);
  if (!c || typeof token !== 'string' || !token || typeof signupBase !== 'string' || !/^https?:\/\//.test(signupBase)) return null;
  let u;
  try { u = new URL(`${signupBase.replace(/\/+$/, '')}/signup/start`); } catch { return null; }
  u.searchParams.set('cf-turnstile-response', token);
  u.searchParams.set('coupon', c);
  u.searchParams.set('return_to', claimReturnPath(c));
  if (ref) u.searchParams.set('ref', String(ref));
  if (via) u.searchParams.set('via', String(via));
  if (sid) u.searchParams.set('sid', String(sid));
  return u.toString();
}

/** The claim status and claim routes on the Worker. */
export function claimStatusUrl(signupBase, code) {
  const c = normalizeClaimCode(code);
  return c ? `${String(signupBase || '').replace(/\/+$/, '')}/membership/claim?code=${encodeURIComponent(c)}` : null;
}

/** The signed-out read of the prepared listing (wildcard CORS, so a plain fetch with no credentials). */
export function listingReadUrl(signupBase, code) {
  const c = normalizeClaimCode(code);
  return c ? `${String(signupBase || '').replace(/\/+$/, '')}/invite/listing?code=${encodeURIComponent(c)}` : null;
}

/** One image of the prepared listing, by file name. */
export function listingImageUrl(signupBase, code, name) {
  const c = normalizeClaimCode(code);
  if (!c || !isImageName(name)) return null;
  return `${String(signupBase || '').replace(/\/+$/, '')}/invite/listing-image?code=${encodeURIComponent(c)}&name=${encodeURIComponent(name)}`;
}

/**
 * How long to wait before asking again: 5, 10 and 15 seconds, then every 30. `attempt` counts from 0. A server
 * `retryAfterSeconds` is a hint only (contract section 18), so it can lengthen a wait but never shorten one.
 */
/** @param {number} attempt @param {number|null} [retryAfterSeconds] @returns {number} */
export function pollDelayMs(attempt, retryAfterSeconds = null) {
  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
  const base = n < POLL_SCHEDULE_MS.length ? POLL_SCHEDULE_MS[n] : POLL_MAX_MS;
  const hint = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.min(retryAfterSeconds * 1000, POLL_MAX_MS) : 0;
  return Math.max(base, hint);
}

// ---------------------------------------------------------------------------------------------------------------
// The greeting and the personal message: text only

/** "Hi Sam," from the greeting name, or a plain "Hello," when there is none. One line, no markup. */
export function greetingLine(name) {
  const n = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return n ? `Hi ${n},` : 'Hello,';
}

/** Who prepared the listing, when the public read names them. */
export function preparedByLine(login) {
  const l = typeof login === 'string' ? login.trim().replace(/^@+/, '') : '';
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(l) ? `Prepared for you by @${l} at GBTI Network.` : 'Prepared for you by GBTI Network.';
}

/**
 * The message as paragraphs of lines, exactly as the person who wrote it laid it out. Markup stays literal text:
 * `<b>` in a message is four characters to read, never a tag.
 */
export function messageParagraphs(text) {
  const s = (typeof text === 'string' ? text : '').replace(/\r\n?/g, '\n').slice(0, MESSAGE_MAX).trim();
  if (!s) return [];
  return s.split(/\n{2,}/).map((p) => p.split('\n')).filter((lines) => lines.some((l) => l.trim()));
}

/**
 * The message as DOM nodes built from `doc` (the page passes `document`): one <p> per paragraph, whose children are
 * text nodes with a <br> between lines. Never innerHTML, so nothing in the message can become markup.
 */
export function messageToNodes(text, doc) {
  const out = [];
  for (const lines of messageParagraphs(text)) {
    const p = doc.createElement('p');
    lines.forEach((line, i) => {
      if (i > 0) p.appendChild(doc.createElement('br'));
      p.appendChild(doc.createTextNode(line));
    });
    out.push(p);
  }
  return out;
}

/**
 * The one line about the free year, from the tier registry (`tiers` is the build-time `{ member, creator }` map of
 * `{ label, priceAnnual }` the dialog serializes from tierDisplay). An unknown tier, or terms the Worker could not
 * read, omit the line rather than guess at an offer.
 */
/**
 * @param {{ tier?: string|null, freeDays?: number|null }} [terms]
 * @param {Record<string, { label: string, priceAnnual: number }>} [tiers]
 * @returns {string|null}
 */
export function tierLine({ tier, freeDays } = {}, tiers = {}) {
  const t = typeof tier === 'string' && tiers && Object.prototype.hasOwnProperty.call(tiers, tier) ? tiers[tier] : null;
  if (!t || typeof t.label !== 'string' || !t.label.trim()) return null;
  if (!Number.isInteger(freeDays) || freeDays <= 0) return null;
  const length = freeDays >= 365 && freeDays <= 366 ? 'a free year' : `${freeDays} free days`;
  const price = Number.isFinite(t.priceAnnual) && t.priceAnnual > 0 ? `, normally $${t.priceAnnual} a year` : '';
  return `The invitation comes with ${length} at the ${t.label.trim()} tier${price}. No card is needed, and nothing bills automatically.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Links and images: http(s) only, and the listing's own image store

/**
 * An href the page may render: an absolute http or https URL, normalized. Everything else (javascript:, data:,
 * vbscript:, a relative path, a protocol-relative `//host`, anything the URL parser refuses) is null, and the page
 * renders the label without a link. The Worker already refuses these at save (amendment 8); this is the second wall.
 */
export function safeHref(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || /[\u0000-\u001f\u007f]/.test(s) || !/^https?:\/\//i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
}

/** A listing image file name, as the Worker stores it (isListingImageName). */
export function isImageName(name) {
  return typeof name === 'string' && name.length <= 128 && /^[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp|gif)$/.test(name);
}

/** The file name a `./images/<name>` reference points at, or null for any other shape. */
export function listingImageName(ref) {
  if (typeof ref !== 'string') return null;
  const m = /^\.\/images\/([^/]+)$/.exec(ref.trim());
  return m && isImageName(m[1]) ? m[1] : null;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TYPE_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/**
 * One image answer made safe to show as a data: URL: base64 only, and an image type from a short list (the file
 * extension decides when the stored type is missing or anything else). Null when there is nothing usable.
 */
export function safeImagePayload(img, name = '') {
  const b64 = typeof img?.dataBase64 === 'string' ? img.dataBase64.replace(/\s+/g, '') : '';
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const stated = typeof img?.contentType === 'string' ? img.contentType.toLowerCase().split(';')[0].trim() : '';
  const ext = (/\.([a-z]+)$/.exec(String(name || '')) || [])[1] || '';
  const contentType = IMAGE_TYPES.has(stated) ? stated : TYPE_BY_EXT[ext] || null;
  return contentType ? { dataBase64: b64, contentType } : null;
}

/** The data: URL for a safe payload. */
export function imageDataUrl(payload) {
  return payload ? `data:${payload.contentType};base64,${payload.dataBase64}` : '';
}

/** The names the page asks the image route for: the listing's own list, well formed and without repeats. */
export function listingImageNames(listing) {
  const names = Array.isArray(listing?.images) ? listing.images : [];
  return [...new Set(names.filter(isImageName))];
}

/**
 * Where a body <img> may load from: a listing image (by its `./images/` reference) when its bytes arrived, or an
 * absolute http(s) URL. Anything else is dropped rather than resolved against this page.
 */
export function bodyImageSrc(src, images = {}) {
  const name = listingImageName(src);
  if (name) return images[name] || null;
  return safeHref(src);
}

/**
 * The iframe src for a video, through the SOW-092 /embed relay on THIS page's own origin. The claim page sends no
 * Referer (public/_headers), and YouTube refuses a player with none (its error 153); the relay is an https page of
 * ours that frames the provider itself. Its own origin rather than gbti.network, because the relay may only be framed
 * by its own origin and the preview site is a different one. Null for anything embedUrl does not recognise.
 */
export function relayFrameSrc(videoUrl, origin) {
  const u = safeHref(videoUrl);
  const o = safeHref(origin);
  if (!u || !o || !embedUrl(u)) return null;
  return `${new URL(o).origin}/embed/?u=${encodeURIComponent(u)}`;
}

/**
 * A body <iframe> src the page keeps: only the markdown renderer's own /embed relay frame, moved onto this page's
 * origin (see relayFrameSrc). Every other frame is dropped.
 */
export function bodyFrameSrc(src, origin) {
  const s = safeHref(src);
  if (!s) return null;
  const u = new URL(s);
  if (u.pathname !== '/embed/' || !/(^|\.)gbti\.network$/.test(u.hostname)) return null;
  return relayFrameSrc(u.searchParams.get('u') || '', origin);
}

/** Where a body <a> may point: an in-page anchor, or an absolute http(s) URL. Null drops the href. */
export function bodyLinkHref(href) {
  if (typeof href !== 'string') return null;
  const s = href.trim();
  if (/^#[A-Za-z0-9_:.-]+$/.test(s)) return s;
  return safeHref(s);
}

// ---------------------------------------------------------------------------------------------------------------
// The read-only listing view

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Everything the listing view renders, decided once and in plain data. `labels` is the build-time category label
 * map; `images` maps a file name to its data: URL. Image fields resolve ONLY to the listing's own images (a remote
 * URL in an image field is refused at save, and is not loaded here either). Every href is safeHref-checked, and a
 * link that fails keeps its label and loses its address.
 */
/**
 * @param {any} listing
 * @param {{ labels?: Record<string, string>, images?: Record<string, string> }} [opts]
 * @returns {ListingModel}
 */
export function listingModel(listing, { labels = {}, images = {} } = {}) {
  const fm = listing && typeof listing.frontmatter === 'object' && listing.frontmatter ? listing.frontmatter : {};
  const slug = str(listing?.slug);
  const title = str(fm.title) || slug || 'Untitled project';
  const img = (ref) => { const n = listingImageName(ref); return n ? images[n] || '' : ''; };

  const heroPick = resolveHero(fm.banner, fm.bannerPreset, fm.featuredImage);
  const hero = { image: heroPick.image ? img(heroPick.image) : '', preset: heroPick.preset || null };
  if (heroPick.image && !hero.image) hero.preset = 'ink'; // an image that did not arrive: the default band, not a hole

  const cats = Array.isArray(fm.categories) ? fm.categories.filter((c) => typeof c === 'string' && c) : [];
  const crumbs = cats.map((c) => ({ key: c, label: typeof labels[c] === 'string' && labels[c] ? labels[c] : c }));

  // The same split the published page makes: the repository earns its own button, one link earns the green one,
  // and the rest go to the rail. Links are filtered to http(s) FIRST, so a bad one can never be the install button.
  const links = (Array.isArray(fm.links) ? fm.links : [])
    .filter((l) => l && typeof l === 'object')
    .map((l) => ({ ...l, url: safeHref(l.url) }))
    .filter((l) => l.url);
  const pricingUrl = safeHref(fm.pricingUrl);
  const repo = repoUrl(links);
  const primaryLink = resolvePrimaryCta(links, pricingUrl);
  const rail = railLinks(links, primaryLink, pricingUrl, fm.pricing);
  const asLink = (l) => (l ? { label: String(linkLabel(l) || 'Link'), url: l.url, locked: isLockedLink(l), icon: iconForUrl(l.url) } : null);

  const specs = [];
  if (str(fm.version)) specs.push(['Version', str(fm.version)]);
  if (str(fm.requires)) specs.push(['Requires', str(fm.requires)]);
  const platforms = Array.isArray(fm.platforms) ? fm.platforms.filter((p) => typeof p === 'string' && p.trim()) : [];
  if (platforms.length) specs.push(['Works with', platforms.join(', ')]);
  if (str(fm.license)) specs.push(['License', str(fm.license)]);

  const shots = normalizeGallery(fm.gallery)
    .map((s) => ({ src: typeof s.src === 'string' ? img(s.src) : '', caption: typeof s.caption === 'string' ? s.caption : '' }))
    .filter((s) => s.src);

  // The video stays the author's URL; the page frames it through the /embed relay (relayFrameSrc), as the body does.
  const videoUrl = safeHref(fm.video);
  const video = videoUrl && embedUrl(videoUrl) ? videoUrl : null;

  const pricing = str(fm.pricing);
  return {
    title,
    description: str(fm.shortDescription),
    crumbs,
    hero,
    mark: img(fm.iconLarge) || img(fm.icon),
    barMark: img(fm.icon),
    version: str(fm.version) ? `v${str(fm.version)}` : '',
    pricing: pricing ? cap(pricing) : '',
    repo: repo ? { label: 'View on GitHub', url: repo, icon: iconForUrl(repo) } : null,
    primary: asLink(primaryLink),
    railLinks: rail.map(asLink).filter(Boolean),
    ctaSub: [pricing ? cap(pricing) : null, str(fm.requires) || null].filter(Boolean).join(' · '),
    specs,
    tags: (Array.isArray(fm.tags) ? fm.tags : []).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()),
    gallery: shots,
    captioned: hasCaptions(shots),
    video,
    side: fm.sidebarPosition === 'left' ? 'left' : 'right',
    body: typeof listing?.body === 'string' ? listing.body : '',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the Worker's answers

/**
 * The claim status answer, as the page acts on it. `{ state }` for an answer to show (signed out is `signin`),
 * or `{ transient:true }` for one to ask again about later (a 5xx, a network failure, an unknown state, a 429). A
 * state the server did not name is never shown as something the person can do.
 */
/** @param {number} status @param {any} body @returns {StatusAnswer} */
export function statusFromResponse(status, body) {
  if (status === 401) return { state: 'signin' };
  if (status === 429) return { transient: true, rateLimited: true };
  if (status === 200 && body && body.ok === true && isServerState(body.state)) {
    return {
      state: body.state,
      projectUrl: body.state === 'claimed' ? safeHref(body.projectUrl) : null,
      retryAfterSeconds: Number.isFinite(body.retryAfterSeconds) ? body.retryAfterSeconds : null,
    };
  }
  return { transient: true };
}

/** What a Publish answer means for the page: a new state, and for a refusal the reason to show under the note. */
/** @param {number} status @param {any} body @returns {{ state: string, projectUrl?: string|null, error?: string }} */
export function postOutcome(status, body) {
  if (status === 200 && body && body.ok === true) return { state: 'publishing' };
  if (status === 401) return { state: 'signin' };
  if (body && isServerState(body.state)) {
    return { state: body.state, projectUrl: body.state === 'claimed' ? safeHref(body.projectUrl) : null };
  }
  const error = body && typeof body.error === 'string' ? body.error : status === 429 ? 'rate_limited' : 'unavailable';
  return { state: 'ready', error: error === 'forbidden' ? 'session' : error };
}

const POST_ERRORS = {
  note_required: 'Write a note before publishing.',
  slug_taken: 'Another project on the network already uses the web address of this listing, so it cannot be published yet. Let the person who sent you the link know. Once they rename it, this same link works.',
  listing_invalid: 'This listing needs a correction before it can be published. Let the person who sent you the link know. Once they fix it, this same link works.',
  too_large: 'This listing is too large to publish as it was prepared. Let the person who sent you the link know. Once they trim it, this same link works.',
  listing_changed: 'The listing was updated while you were publishing. Look it over, then press Publish again.',
  author_disabled: 'Publishing is paused on the network right now. Your link keeps working, so try again later.',
  rate_limited: 'That was a lot of attempts in a short time. Wait a few minutes, then try again.',
  session: 'Your session could not be confirmed. Reload this page, then try again.',
};
const POST_ERROR_FALLBACK = 'The network could not publish the listing just now. Nothing was lost, so try again in a moment.';

/** The sentence shown under the note for a refused Publish. */
export function postErrorMessage(error) {
  return (typeof error === 'string' && Object.prototype.hasOwnProperty.call(POST_ERRORS, error)) ? POST_ERRORS[error] : POST_ERROR_FALLBACK;
}

// ---------------------------------------------------------------------------------------------------------------
// The views

/**
 * Where a new account goes once this page is done: the welcome steps, carrying the published project as the place
 * to continue to when the address is one of ours. `/welcome/` accepts same-site paths only (safeNext).
 */
/** @param {string|null|undefined} projectUrl @returns {string} */
export function welcomeHref(projectUrl) {
  const u = safeHref(projectUrl);
  if (u) {
    try {
      const p = new URL(u).pathname;
      if (/^\/projects\/[a-z0-9][a-z0-9-]*\/$/.test(p)) return `/welcome/?next=${encodeURIComponent(p)}`;
    } catch { /* fall through to the plain welcome */ }
  }
  return '/welcome/';
}

/** A new account is sent on to the welcome steps this long after the success panel appears. */
export const WELCOME_REDIRECT_MS = 6000;

const MEMBERSHIP = { kind: 'link', label: 'See membership', href: '/membership/', primary: true };
const HOME = { kind: 'link', label: 'Visit GBTI Network', href: '/', primary: false };

/**
 * The view for a state: its words, which controls show, whether the page keeps asking, and its actions. `surface`
 * is `dialog` (over the listing) or `panel` (the page alone, with nothing of the listing on it: inactive, claimed,
 * a failed read). `waitedMs` is how long the page has been waiting on a polling state; past SETUP_PATIENCE_MS the
 * words change to say the link keeps working. `welcome` adds the hand-off to the welcome steps to every state
 * that ends the visit. Unknown states fall back to the failed-read view, never to a claim.
 */
/**
 * @param {string} state
 * @param {{ welcome?: boolean, waitedMs?: number, projectUrl?: string|null, gaveUp?: boolean }} [opts]
 * @returns {ClaimView}
 */
export function claimView(state, { welcome = false, waitedMs = 0, projectUrl = null, gaveUp = false } = {}) {
  const s = SERVER_STATES.includes(state) || PAGE_STATES.includes(state) ? state : 'error';
  const patient = Number.isFinite(waitedMs) && waitedMs >= SETUP_PATIENCE_MS;
  /** @type {ClaimView} */
  const v = {
    state: s, surface: 'dialog', title: '', text: '', tier: false, signin: null, note: false, poll: false, busy: false,
    actions: [], redirect: null,
  };
  switch (s) {
    case 'loading':
      Object.assign(v, { surface: 'panel', title: 'Opening your invitation', busy: true });
      break;
    case 'checking':
      Object.assign(v, { title: 'Checking your account', busy: true });
      break;
    case 'signin':
      Object.assign(v, {
        title: 'Claim this listing',
        text: 'Sign in with GitHub to accept the invitation. Then add a short note in your own words, and the listing goes live under your name.',
        tier: true, signin: { label: 'Sign in with GitHub to claim this listing' },
      });
      break;
    case 'redeem':
      Object.assign(v, {
        title: 'Accept your free year',
        text: 'You are signed in, and this invitation includes a free year for this account. Sign in with GitHub once more to accept it, then publish the listing.',
        tier: true, signin: { label: 'Accept the free year' },
      });
      break;
    case 'ready':
      Object.assign(v, {
        title: 'Add your note and publish',
        text: 'Every project on the network carries a short note from its author. Write it in your own words: what the project is for, or what you would like readers to know. It goes live with the listing, under your name.',
        note: true,
      });
      break;
    case 'claim_failed':
      Object.assign(v, {
        title: 'That attempt did not go through',
        text: 'The listing was not published. Nothing is lost, and you can publish it again now.',
        note: true,
      });
      break;
    case 'publishing':
      Object.assign(v, {
        title: 'Publishing your listing',
        text: patient
          ? 'This is taking longer than usual. You can close this page: the listing keeps publishing, and opening your link again shows the result.'
          : 'Your listing is on its way to the network. This usually takes a minute or two, and this page updates on its own.',
        busy: true, poll: true,
      });
      break;
    case 'pending_grant':
    case 'pending_folder':
      Object.assign(v, {
        title: 'Your space is being set up',
        text: patient
          ? 'Setting up is taking longer than usual. Your link keeps working, so you can close this page and open the link again later.'
          : 'The network is preparing your membership and your folder. This usually takes a few minutes, and this page checks again on its own.',
        busy: true, poll: true,
      });
      break;
    case 'claimed':
      Object.assign(v, {
        surface: 'panel',
        title: 'Your listing is published',
        text: 'It is live under your name. The page can take a few minutes to appear on the site while it builds.',
      });
      {
        const url = safeHref(projectUrl);
        if (url) v.actions.push({ kind: 'link', label: 'View your project', href: url, primary: !welcome });
        v.actions.push({ kind: 'link', label: 'Open your WorkBench', href: '/workbench/', primary: false });
      }
      break;
    case 'wrong_account':
      Object.assign(v, {
        title: 'This invitation is for another account',
        text: 'It was prepared for a different GitHub account than the one you are signed in with. Sign out, switch GitHub to the account it was sent to, and open this link again.',
      });
      v.actions.push({ kind: 'signout', label: 'Sign out', primary: !welcome });
      break;
    case 'not_permitted':
      Object.assign(v, {
        title: 'This account cannot claim listings',
        text: 'Publishing is not available to this account, so it cannot claim this listing.',
      });
      break;
    case 'preview_only':
      Object.assign(v, {
        title: 'This is your preview',
        text: 'You prepared this listing, so you are seeing it the way the person you invite will. Only they can publish it, so send them the link.',
      });
      break;
    case 'year_used':
      Object.assign(v, {
        title: 'Your free year has been used',
        text: 'This account has already had its free year, so the invitation cannot add another. Become a member to publish this listing. It stays prepared for you, and this link works once you are a member.',
      });
      v.actions.push({ ...MEMBERSHIP, primary: !welcome });
      break;
    case 'year_unavailable':
      Object.assign(v, {
        title: 'The free year is not available',
        text: 'The free year on this invitation cannot be added to this account right now. Become a member to publish this listing. It stays prepared for you, and this link works once you are a member.',
      });
      v.actions.push({ ...MEMBERSHIP, primary: !welcome });
      break;
    case 'inactive':
      Object.assign(v, {
        surface: 'panel',
        title: 'This invitation is no longer active',
        text: 'The link may have been replaced or withdrawn, or the listing may already be claimed. If you expected it to work, ask the person who sent it for a new link.',
      });
      v.actions.push({ ...HOME, primary: !welcome });
      break;
    case 'rate_limited':
      Object.assign(v, {
        surface: 'panel',
        title: 'Too many attempts from this connection',
        text: 'Wait a few minutes, then reload this page. Your link keeps working.',
      });
      v.actions.push({ kind: 'retry', label: 'Reload', primary: true });
      break;
    default: // 'error' and anything unrecognised
      Object.assign(v, {
        surface: 'panel',
        title: 'The network did not answer',
        text: 'Something went wrong while opening this invitation. Your link is fine, so try again in a moment.',
      });
      v.actions.push({ kind: 'retry', label: 'Try again', primary: true });
      break;
  }
  if (v.poll && gaveUp) {
    // A tab left open this long stops asking on its own; the person can ask once more by hand.
    v.busy = false;
    v.poll = false;
    v.actions.push({ kind: 'recheck', label: 'Check again', primary: true });
  }
  if (welcome && TERMINAL_STATES.includes(s)) {
    v.actions.unshift({ kind: 'link', label: 'Continue to the welcome steps', href: welcomeHref(projectUrl), primary: true });
    if (s === 'claimed') v.redirect = welcomeHref(projectUrl);
  }
  return v;
}
