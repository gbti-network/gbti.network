// sow-434: the pure half of the EXAMPLE PROFILE page (src/pages/claim/profile/index.astro). Plain .mjs with no DOM
// globals and no node imports, so node --test imports it and the page's bundled script (src/lib/claim-profile.ts)
// imports the same functions. Every sentence the script writes and every href it sets is decided here.
//
// WHAT THE PAGE IS. The invitation page (/claim/?code=<CODE>) shows a prepared project the way it will look once
// published, and its byline links here: /claim/profile/?code=<CODE>, the profile the person will have, laid out
// exactly like a published one (src/pages/members/[username].astro) with a banner saying it is an example. It reads
// the SAME signed-out listing the invitation page reads (GET /invite/listing, no credentials) and shows:
//   - the person's name (the recipient name the preparer typed) and, where the picture goes, its initial: the claim
//     writes the profile with no picture, and the published header draws the initial for exactly that,
//   - a placeholder bio, example links that go nowhere, and their real GitHub link when the invitation is tied to an
//     account (the public read carries that login, never the account number),
//   - the prepared project as a card, linking back to the invitation, with the author's blobatar (their own photo
//     once they are signed in as the person the listing is for, as /avatar/<folder> shows it on a published card).
//
// THE TWO RULES THAT SHAPE THIS FILE.
//   1. Reveal nothing on a dead code. A malformed code never reaches the network, and any answer that is not a
//      readable listing becomes the same plain panel the invitation page shows (claimView), with no name and no title.
//   2. Every string from the listing is data: the script puts it in textContent, and every href it sets is built here
//      from a normalized code, a checked login, or claim-core's safeHref.

import { normalizeClaimCode, listingImageName, safeHref, claimView } from './claim-core.mjs';
import { isGithubLogin } from './github-login.mjs';
import { isFolder, idAvatarUrl, memberAvatarUrl } from '../../membership/member-avatar.mjs';

/** The profile name cap, as the claim writes the profile (prepared-claim-files.mjs slices the displayName to 100). */
export const NAME_MAX = 100;
/**
 * The size the example asks GitHub for. The only photo on the page is the project card's small author picture (the
 * profile header shows the initial), so it asks for the size the invitation byline asks for (idAvatarUrl's default).
 */
export const PHOTO_SIZE = 128;

// ---------------------------------------------------------------------------------------------------------------
// The code and the addresses built from it

/** The page's own query: only the code, in canonical form, or null when it could not be one (checked before any request). */
export function parseProfileQuery(search) {
  let q;
  try { q = new URLSearchParams(typeof search === 'string' ? search : ''); } catch { q = new URLSearchParams(''); }
  return { code: normalizeClaimCode(q.get('code') || '') };
}

/** The invitation this example belongs to: `/claim/?code=<CODE>`, the exact return path claim-core builds. */
export function invitationHref(code) {
  const c = normalizeClaimCode(code);
  return c ? `/claim/?code=${c}` : null;
}

/** This page, for the same code (the card's author link points here, as a published card points to the profile). */
export function exampleProfileHref(code) {
  const c = normalizeClaimCode(code);
  return c ? `/claim/profile/?code=${c}` : null;
}

/**
 * The person's real GitHub page, from the login the public read carries for a TIED invitation. The Worker already
 * normalized it; this checks the shape again, so nothing but a well-formed login is ever put in an href.
 */
export function githubProfileUrl(login) {
  return isGithubLogin(login) ? `https://github.com/${login}` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the Worker's answer

/**
 * The signed-out read, as the page acts on it. The same rules as the invitation page's own read: a 429 is a rate
 * limit, a 404 or any other refusal is inactive, a 5xx is a failed read, and only `{ ok: true, listing: {...} }` is a
 * listing. A failed network call is `{ error: true }` (the script passes status 0).
 *
 * @param {number} status @param {any} body
 * @returns {{ listing: any } | { inactive: true } | { rateLimited: true } | { error: true }}
 */
export function readOutcome(status, body) {
  if (status === 429) return { rateLimited: true };
  if (status === 404) return { inactive: true };
  if (status >= 200 && status < 300 && body && body.ok === true && body.listing && typeof body.listing === 'object' && !Array.isArray(body.listing)) {
    return { listing: body.listing };
  }
  return status === 0 || status >= 500 ? { error: true } : { inactive: true };
}

/**
 * The panel for a state that shows no listing. `loading` is this page's own; every other state is the invitation
 * page's view word for word (claimView), so a dead link reads the same on both pages and reveals nothing. Anything
 * unrecognised is the failed-read panel.
 */
/** @param {string} state @returns {{ title: string, text: string, busy: boolean, actions: { kind: string, label: string, href?: string, primary: boolean }[] }} */
export function panelView(state) {
  if (state === 'loading') return { title: 'Opening the example profile', text: '', busy: true, actions: [] };
  const v = claimView(['inactive', 'rate_limited'].includes(state) ? state : 'error');
  return { title: v.title, text: v.text, busy: false, actions: v.actions.map((a) => ({ ...a })) };
}

// ---------------------------------------------------------------------------------------------------------------
// What the example shows

const clean = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '');

/**
 * The name on the example: the recipient name the preparer typed, cleaned and capped as the claim caps the profile
 * name. Without one, the tied login, and without that a plain placeholder.
 */
export function profileName(listing) {
  const name = clean(listing?.recipientName).slice(0, NAME_MAX);
  if (name) return name;
  return isGithubLogin(listing?.githubLogin) ? listing.githubLogin : 'Your name';
}

/**
 * What the example draws where the profile picture goes: the first character of the name, exactly as the published
 * ProfileHeader draws it (`d.displayName.charAt(0)`) for a profile with no avatar, which is what the claim writes
 * (membership/prepared-claim-files.mjs builds the profile from the name alone).
 */
export function profileInitial(name) {
  return String(name ?? '').charAt(0);
}

/**
 * The author line on the card. A published card prints the author's GBTI folder (authorDisplay in src/lib/authors.ts),
 * and a new member's folder is their GitHub login in lower case, so the example prints that whenever it is known: the
 * viewer's own folder when they are the person invited (viewerPicture's seed), else the tied login. With neither, the
 * name.
 */
export function cardAuthor(listing, viewerFolder = null) {
  if (isFolder(viewerFolder)) return String(viewerFolder).toLowerCase();
  if (isGithubLogin(listing?.githubLogin)) return listing.githubLogin.toLowerCase();
  return profileName(listing);
}

/** The heading over the projects, as the published profile writes it for a member. */
export function projectsHeading(name) {
  return `Projects by ${clean(name) || 'you'}`;
}

/**
 * The prepared project as the published card shows it (src/components/projects/ProjectCard.astro): the title, the
 * short description, the leaf category label, the Paid and Members chips, the public repository link, and the file
 * name of the icon to ask the image route for. `labels` is the build-time category label map.
 *
 * @param {any} listing @param {Record<string, string>} [labels]
 * @returns {{ title: string, description: string, category: string, paid: boolean, membersLinks: boolean,
 *   repo: string|null, iconName: string|null }}
 */
export function projectCard(listing, labels = {}) {
  const fm = listing && typeof listing.frontmatter === 'object' && listing.frontmatter ? listing.frontmatter : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const cats = Array.isArray(fm.categories) ? fm.categories.filter((c) => typeof c === 'string' && c) : [];
  const leaf = cats.length ? cats[cats.length - 1] : '';
  const links = (Array.isArray(fm.links) ? fm.links : []).filter((l) => l && typeof l === 'object');
  const repo = links.find((l) => l.type === 'repository' && l.visibility !== 'members');
  const pricing = str(fm.pricing);
  return {
    title: str(fm.title) || str(listing?.slug) || 'Untitled project',
    description: str(fm.shortDescription),
    category: leaf ? (typeof labels[leaf] === 'string' && labels[leaf] ? labels[leaf] : leaf) : '',
    paid: Boolean(pricing) && pricing !== 'free',
    membersLinks: links.some((l) => l.visibility === 'members'),
    repo: repo ? safeHref(repo.url) : null,
    iconName: listingImageName(fm.icon) || listingImageName(fm.iconLarge),
  };
}

/**
 * The project card's author picture for a signed-in viewer, or null to keep the blobatar of the name. Only the person the listing is for
 * gets their own photo: never the superadmin who prepared it (they open this page to check it before sending), and
 * on a tied invitation never anyone but the tied account. Presentation only, like the member signal it reads.
 *
 * Their photo by account number at the size this picture needs, then the `/avatar/<folder>` route (the same picture,
 * at the size the published pages use). The blobatar under it is seeded by their GBTI folder once they have one, as
 * every published avatar is.
 *
 * @param {{ login?: string|null, username?: string|null, githubId?: string|null } | null} signal
 * @param {any} listing
 * @returns {{ seed: string|null, photos: string[] } | null}
 */
export function viewerPicture(signal, listing) {
  const login = isGithubLogin(signal?.login) ? signal.login.toLowerCase() : '';
  if (!login) return null;
  const preparer = typeof listing?.preparedByLogin === 'string' ? listing.preparedByLogin.trim().replace(/^@+/, '').toLowerCase() : '';
  if (preparer && login === preparer) return null;
  const tied = isGithubLogin(listing?.githubLogin) ? listing.githubLogin.toLowerCase() : '';
  if (tied && login !== tied) return null;
  // Case-folded first, as memberAvatarUrl does: the signal carries the folder in the login's shape.
  const lower = typeof signal?.username === 'string' ? signal.username.toLowerCase() : '';
  const folder = isFolder(lower) ? lower : '';
  const photos = [idAvatarUrl(signal?.githubId, PHOTO_SIZE), folder ? memberAvatarUrl(folder, { site: '' }) : ''].filter(Boolean);
  return photos.length ? { seed: folder || null, photos } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The words on the page, kept here so the writing-rules test reads them

export const BANNER_LEAD = 'Example profile.';
// The banner promised "your name and picture" until the sow-434 review: the claim writes no picture, so the profile
// starts with the name alone, and the picture is one of the things the person adds.
export const BANNER_TEXT = 'This page is not published. It is set up to show how your profile will look on GBTI Network. When you claim your listing, your profile starts with your name, and you fill in the rest yourself, including your picture.';
export const BIO_PLACEHOLDER = 'Your bio goes here: a few lines about you and your work, in your own words. You write it after you claim the listing.';
export const INERT_TOOLTIP = 'Available once published';
