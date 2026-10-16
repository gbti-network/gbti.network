// sow-457: THE PURE HALF OF THE ON-PAGE INVITATION CLAIM, the dialog that opens over a campaign's destination
// page (src/components/invite/InviteClaim.astro, wired by src/lib/invite-claim.ts).
//
// WHY A DIALOG ON A REAL PAGE RATHER THAN A LANDING PAGE. Owner, 2026-10-15, on the YouTube creator invitations:
// the link should open the article the creator was featured in, with a claim popup over it, the way a prepared
// project listing opens at /claim/. A creator told they were ranked on a list should land on the list. An
// audience-neutral lander cannot name the list or link to their own entry, and a second page describing the same
// offer is a second place for the terms to go stale.
//
// WHAT THIS FILE HOLDS: the copy for each campaign that has a destination, and the decisions a page makes about
// whether to show the dialog at all. Node-free (no fs, no DOM), so the unit tests exercise exactly what the page
// runs. WHERE each campaign's links land is in membership/invites.mjs (DESTINATION_BY_CAMPAIGN), beside the
// lander map, because that is where somebody looking for "where does this campaign go" will look.
//
// THE TERMS ARE NOT WRITTEN HERE. The one line about the free year comes from tierLine() in
// src/lib/claim-core.mjs, over the build-time tier registry, which is the same function and the same registry
// the project claim dialog uses. A sentence promising a year at a price is the exact claim sow-243 found shipped
// wrong on a lander, and the fix was to make the page unable to write it. The same rule applies here: the
// `message` below says why the invitation exists and nothing about what the tier costs or includes.

import { DESTINATION_BY_CAMPAIGN } from '../../membership/invites.mjs';
import { CLAIM_CODE_RE, normalizeClaimCode } from './claim-core.mjs';

/**
 * Per-campaign copy for the dialog. Keyed by the campaign id, which is the id in house/campaigns.yml and the
 * key DESTINATION_BY_CAMPAIGN uses, so a campaign cannot have copy here and a destination somewhere else under
 * another name.
 *
 * `freeDays` is stated so the dialog can render the terms line at build time with no network call. It must agree
 * with the campaign's own freeDays in the coupon registry; test/invite-claim.test.mjs holds them together against
 * the manifest's tier, and the registry itself is the authority at redemption.
 */
export const INVITE_CLAIM_COPY = Object.freeze({
  YOUTUBE2026: Object.freeze({
    tier: 'member',
    freeDays: 365,
    kicker: 'An invitation to GBTI Network',
    heading: 'Congrats on recent placement!',
    message: 'Your channel is one of the hundred in this article. As a thank you, your first year of membership '
      + 'is on us, and no card is collected.',
    // The strip that is left behind when the dialog is dismissed, so the offer is recoverable rather than gone.
    stripNote: 'You are on this list, and your first year is on us.',
    openLabel: 'Claim your free year',
    signinLabel: 'Sign in with GitHub',
    laterLabel: 'Read the article first',
  }),
});

/** A path compared without its trailing slash, so `/x/` and `/x` are one page. Empty string stays empty. */
export function normalizeInvitePath(pathname) {
  if (typeof pathname !== 'string' || !pathname) return '';
  const p = pathname.split('?')[0].split('#')[0];
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/**
 * The campaign whose invitations land on `pathname`, with its copy, or null for every other page.
 *
 * Returns null rather than a default: the dialog must not appear on a page no campaign points at, because the
 * copy would be about a list the reader is not on. BaseLayout calls this at build time, so the markup is only
 * ever rendered into the destination page.
 */
export function campaignForPath(pathname) {
  const want = normalizeInvitePath(pathname);
  if (!want) return null;
  for (const [id, dest] of Object.entries(DESTINATION_BY_CAMPAIGN)) {
    if (normalizeInvitePath(dest) !== want) continue;
    const copy = INVITE_CLAIM_COPY[id];
    if (!copy) return null; // a destination with no copy renders nothing rather than an empty dialog
    return { id, path: dest, ...copy };
  }
  return null;
}

/**
 * The coupon in a query string, normalized, or '' when there is none or it is unusable.
 *
 * '' is what keeps the dialog shut and keeps the Turnstile script unfetched, which is the whole reason this is a
 * separate decision: the destination is a published article with ordinary readers, and they must not pay for a
 * third-party script, or meet a popup, because an invitation mechanism lives on their page.
 */
export function couponFromSearch(search) {
  if (typeof search !== 'string' || search === '') return '';
  let raw = null;
  try { raw = new URLSearchParams(search).get('coupon'); } catch { return ''; }
  const code = normalizeClaimCode(raw);
  return CLAIM_CODE_RE.test(code) ? code : '';
}

/**
 * The invitation link for one code: the campaign's destination, the coupon as a plain visible parameter, and an
 * optional fragment so a recipient lands on their own entry.
 *
 * The QUERY GOES BEFORE THE FRAGMENT, which is the whole reason this is a function rather than string
 * concatenation at three call sites: a fragment before the query makes the coupon part of the fragment, the page
 * never sees it, and the link silently stops being an invitation while still looking like one.
 *
 * `fragment` is a RAW anchor and is percent-encoded here, because three of these entries carry accents
 * (la-maquina-del-branding is not how that heading is spelled) and a raw non-ASCII URL in an email is at the
 * mercy of whatever rewrites it on the way. Pass the anchor as it appears in the page, never pre-encoded.
 */
export function inviteDestinationUrl({ siteBase = '', path = '', code = '', fragment = '' } = {}) {
  const c = normalizeClaimCode(code);
  if (!path || !CLAIM_CODE_RE.test(c)) return null;
  const base = String(siteBase || '').replace(/\/+$/, '');
  const raw = typeof fragment === 'string' ? fragment.replace(/^#/, '') : '';
  const frag = raw ? `#${encodeURIComponent(raw)}` : '';
  return `${base}${path}?coupon=${encodeURIComponent(c)}${frag}`;
}
