// sow-478: THE NEW MEMBER'S WELCOME EMAIL, and the one job it has: getting somebody into /welcome/.
//
// WHY IT EXISTS. Before this, onboarding depended on nobody closing a tab. The only automatic hand-off into the
// step wizard was a six second JavaScript redirect on the sign-in success panel (WELCOME_REDIRECT_MS,
// src/lib/claim-core.mjs), and /welcome/ is in no nav, no footer, no account page and no email. The wizard itself
// has been fully built since sow-343; only the way in was missing.
//
// PURE AND NODE-FREE, like membership/prepared-notify.mjs whose shape this copies, so what a member reads is
// unit-tested without a network. The Worker's sender (workers/signup/welcome-mail-send.mjs) is the only part that
// touches Resend, and it is fail-soft.
//
// THE SHAPE IS THE OWNER'S PICK (2026-10-26, design round .data/design/welcome-email-2026-10-26). B's receipt card
// opens it, A's step list closes it, and DISCORD IS PROMOTED OUT OF THE STEP LIST into its own block, because it
// is the product rather than a setting. The button says "Complete Onboarding" and not "Join the Discord": one
// label that is also true for a free account, which may not join Discord at all.
//
// THE STEP LIST IS NEVER WRITTEN DOWN HERE. It comes from onboardingStepsFor, the same function the wizard itself
// walks, over the same membership value, through the same two gates (discordJoinAllowed, canPublish). So this
// email cannot offer a step the wizard will not show, which is the one way a welcome email turns into a lie.
//
// FLUID, NOT THE DIGEST'S FIXED 600px TABLE (owner decision 5). A fixed table shrinks to about 65 percent on a
// phone, so 14px body lands near 9px and the button loses its tap target. The digest lives with that because it
// has years of client fixes riding on its table; a new short template has none to inherit.
//
// NO CLICK COUNTER AND NO OPEN PIXEL. This is transactional, like the other alerts, and `welcome-YYYY-MM-DD` is
// already the digest's own welcome issue id, so a campaign id here would land in the same counters as that issue.
//
// NO UNSUBSCRIBE LINK, deliberately. The digest's is a per-recipient token minted by the drain; this email is
// outside the drain, so there is no token to mint and a dead opt-out link is worse than none. The footer links to
// the real notification preferences page instead.

import { escapeHtml, safeUrl, PALETTES } from './mail-render.mjs';
import { onboardingStepsFor } from './onboarding.mjs';
import { discordJoinAllowed, PUBLISHED_STATUSES } from './discord-roles.mjs';
import { isListingImageName } from './prepared-listings-shared.mjs';

const str = (v) => (v === null || v === undefined ? '' : String(v));
const trim = (v) => str(v).trim();

/**
 * The public route for each type an invitation can carry. Its own map rather than prepared-listings' projectUrl,
 * which hardcodes `/projects/` and so addresses a claimed PROMPT as a project (an existing defect, in the same
 * family as the `Publish project:` commit title the owner deferred). A wrong link in a welcome email is the one
 * thing here that cannot be taken back, so this file resolves it from the type.
 *
 * test/welcome-mail.test.mjs reads PREPARABLE_TYPES and asserts every one of them has an entry, so a third
 * preparable type reds that test rather than quietly producing a dead link.
 */
export const ITEM_ROUTES = Object.freeze({ project: 'projects', prompt: 'prompts' });

/** The noun a member would use for each type, for the heading and the eyebrow. */
const ITEM_NOUNS = Object.freeze({ project: 'project', prompt: 'prompt' });

/**
 * Which frontmatter field holds the picture to put on the receipt, PER TYPE, in preference order.
 *
 * It is a map for the reason TYPE_IMAGE_FIELDS is one, and that reason was learned the hard way three weeks
 * before this: a prompt carries its lead image in `image` and a project carries its cover in `featuredImage`,
 * and a single project-shaped list looked perfectly healthy while collecting nothing for a prompt.
 *
 * test/welcome-mail.test.mjs asserts every type in TYPE_IMAGE_FIELDS has an entry here, and that every field
 * named here is one that map actually collects, so the receipt can only ever show a picture the claim committed.
 */
const TYPE_COVER_FIELDS = Object.freeze({
  project: Object.freeze(['featuredImage', 'banner', 'icon']),
  prompt: Object.freeze(['image']),
});

/** The cover reference for a prepared item's frontmatter, or '' when it carries none. */
export function coverRef(type, frontmatter) {
  const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {};
  for (const field of TYPE_COVER_FIELDS[trim(type)] ?? []) {
    const v = trim(fm[field]);
    if (v) return v;
  }
  return '';
}

/**
 * The one line under each step title. Keyed by STEP KEY, so the titles still come from onboardingStepsFor and
 * only the why is written here. An unknown key falls back to the step's own `sub`, which means a step added to
 * the wizard renders with the wizard's own wording rather than nothing at all.
 */
const STEP_WHY = Object.freeze({
  subreddit: 'Where new work gets posted.',
  socials: 'So readers can find you off the network.',
  follow: 'Their work lands in your feed.',
  topics: 'Tunes what you see.',
});

const COUNT_WORDS = Object.freeze(['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']);
const countWord = (n) => COUNT_WORDS[n] ?? String(n);

/** What every welcome subject ends with: the one thing the email asks for. The bullet is U+2022, not a dash. */
export const SUBJECT_TASK = ' \u2022 COMPLETE ONBOARDING';
/** The receipt cover's cell. Near square, so a 16:10 cover is cropped to the middle rather than shrunk. */
const COVER_W = 120;
const COVER_H = 104;
/** Only an address made of these characters is placed inside url(''); coverUrl only ever builds such addresses. */
const COVER_URL_RE = /^https:\/\/[A-Za-z0-9._~\/@-]+$/;
/** The Discord tile (scripts/build-mail-discord-tile.mjs), served from the site. */
const DISCORD_TILE_PATH = '/brand/social/discord-tile.png';

const FONT = 'Arial,Helvetica,sans-serif';
const DISPLAY = "'Trebuchet MS',Verdana,sans-serif";
const MONO = "'Courier New',monospace";

/** A greeting first name. One token, so a full name in the Stripe customer does not head the email with all of it. */
export function greetingName(name) {
  const first = trim(name).split(/\s+/)[0] ?? '';
  return /^[^\s]{1,40}$/.test(first) ? first : '';
}

/**
 * The absolute page address for a claimed item, or '' when it cannot be built. Fails closed: an unknown type or a
 * slug outside the shape means no link, never a guess.
 */
export function itemUrl({ type, slug } = {}, siteBase = 'https://gbti.network') {
  const dir = ITEM_ROUTES[trim(type)];
  const s = trim(slug);
  if (!dir || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(s)) return '';
  return `${trim(siteBase).replace(/\/+$/, '')}/${dir}/${s}/`;
}

/**
 * The jsDelivr address of a claimed item's cover, or '' when it cannot be built.
 *
 * The content repository is PUBLIC and jsDelivr over GitHub is the house mechanism for media (project CLAUDE.md).
 * The claim commits the item's images co-located at `members/<folder>/<dir>/<slug>/images/<name>` in the same pull
 * request, so this address resolves the moment the merge lands. The Astro-processed path cannot be used: it is
 * content-hashed at build time and unknowable from a Worker, and it would not exist until the site redeploys.
 *
 * @param image a frontmatter image reference as stored, `./images/<name>` or `images/<name>`
 */
export function coverUrl({ type, slug, folder, image, upstream = 'gbti-network/gbti.network' } = {}) {
  const dir = ITEM_ROUTES[trim(type)];
  const s = trim(slug);
  const f = trim(folder);
  const name = trim(image).replace(/^\.?\//, '').replace(/^images\//, '');
  if (!dir || !s || !f) return '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(trim(upstream))) return '';
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(s) || !/^[A-Za-z0-9][\w.-]{0,80}$/.test(f)) return '';
  // The SAME gate the claim's uploader applies, not a second copy of it: a name this refuses is a name that
  // was never committed, so an address built from it would be a guaranteed broken image.
  if (!isListingImageName(name)) return '';
  return `https://cdn.jsdelivr.net/gh/${trim(upstream)}@main/members/${f}/${dir}/${s}/images/${name}`;
}

/**
 * The welcome record for a claimed prepared listing.
 *
 * BUILT BEFORE minimizeClaimedListing, and that is the whole reason it is a separate function rather than a read
 * of the claimed record: minimize nulls the frontmatter and the claim deletes the stored images, so the moment
 * after the merge is the LAST moment the item's cover is known. The claimed record keeps the type, the slug and
 * the title; it does not keep the picture.
 *
 * @param listing  the listing record as it stands at the merge, before minimize
 * @param githubId the claimant
 * @returns `{ githubId, name, item }`, or null when the listing cannot produce a usable receipt
 */
export function welcomeRecordFromListing(listing, { githubId } = {}) {
  const id = trim(githubId);
  const type = trim(listing?.type);
  if (!/^[0-9]{1,20}$/.test(id) || !ITEM_NOUNS[type]) return null;
  const fm = listing?.frontmatter && typeof listing.frontmatter === 'object' ? listing.frontmatter : {};
  return {
    githubId: id,
    name: trim(listing?.recipientName),
    // The invitation grants a free year, so a claimant reads as paid. The sender resolves it from the coupon
    // grant when this is absent; it is stated here because the grant is the thing the invitation IS.
    status: 'paid',
    item: {
      type,
      title: trim(listing?.title) || trim(fm.title),
      slug: trim(listing?.slug),
      folder: trim(listing?.claimPendingFolder),
      image: coverRef(type, fm),
      // sow-475: the preparer's contributor credit, only when the invitation was prepared with it.
      creditTo: listing?.creditPreparer === true ? trim(listing?.preparedByLogin) : '',
    },
  };
}

// ---- the html pieces ------------------------------------------------------------------------------------------

const eyebrow = (t, text) => `<div style="font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:.08em;`
  + `color:${t.meta};mso-line-height-rule:exactly;line-height:15px">${escapeHtml(text)}</div>`;

const para = (t, text, size = 13.5) => `<p style="margin:0;font-family:${FONT};font-size:${size}px;color:${t.inkSoft};`
  + `mso-line-height-rule:exactly;line-height:20px">${escapeHtml(text)}</p>`;

const cell = (inner, padding) => `<tr><td style="padding:${padding}">${inner}</td></tr>`;

/**
 * The heading with the GBTI mark to its left, centred on it in its own cell so a heading that wraps on a phone keeps
 * the mark beside it rather than above. Black on the light card; the white mark on the dark variant.
 */
function headingHtml(t, base, theme, heading) {
  const logo = `${base}/brand/logo/mark-${theme === 'dark' ? 'white' : 'ink'}-96.png`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%"><tr>`
    + `<td width="34" valign="middle" style="width:34px;padding-right:12px;line-height:0">`
    + `<img src="${escapeHtml(logo)}" width="34" height="34" alt="GBTI Network" style="display:block;border:0;width:34px;height:34px">`
    + `</td><td valign="middle">`
    + `<h1 style="margin:0;font-family:${DISPLAY};font-size:23px;font-weight:700;color:${t.ink};`
    + `mso-line-height-rule:exactly;line-height:29px">${escapeHtml(heading)}</h1>`
    + `</td></tr></table>`;
}

/** The receipt card: the published item, its cover when one resolves, and the link to it. */
function receiptHtml(t, item) {
  const noun = ITEM_NOUNS[item.type] ?? 'item';
  const credit = item.creditTo
    ? `Under your name, with ${item.creditTo} credited as a contributor.`
    : 'Published under your name.';
  const body = eyebrow(t, `${noun.toUpperCase()} · PUBLISHED`)
    + `<div style="padding-top:4px;font-family:${FONT};font-size:14px;font-weight:700;color:${t.ink};`
    + `mso-line-height-rule:exactly;line-height:19px">${escapeHtml(item.title || `(untitled ${noun})`)}</div>`
    + `<div style="padding-top:3px;font-family:${FONT};font-size:12px;color:${t.inkSoft};`
    + `mso-line-height-rule:exactly;line-height:17px">${escapeHtml(credit)}</div>`
    + (item.url
      ? `<div style="padding-top:6px"><a href="${escapeHtml(item.url)}" style="font-family:${FONT};font-size:12.5px;`
        + `font-weight:700;color:${t.accent};text-decoration:underline">View your page</a></div>`
      : '');
  // THE COVER RUNS THE CARD'S FULL HEIGHT (owner, 2026-10-27). A table row gives every cell the same height, so a
  // background image sized to `cover` on the first cell fills it from the card's top edge to its bottom edge,
  // cropped to fit, however tall the text beside it runs. Covers are 16:10 and the cell is near square, which is
  // exactly the crop an <img> cannot make in email: Gmail ignores object-fit.
  //
  // The bulletproof-background pattern, because support is uneven: the style for Apple Mail, Gmail, Outlook.com
  // and Yahoo; the `background` attribute for a Gmail that drops the style (caniemail lists its support as partial);
  // and a plain image inside an Outlook-only comment, since Outlook on Windows draws no CSS background at all. The
  // `height` attribute keeps a short card from squashing the picture. The URL is checked against a strict
  // character set before it goes inside url(''), so nothing in it can close the quotes.
  const cover = COVER_URL_RE.test(item.coverUrl || '') ? item.coverUrl : '';
  const textCell = `<td valign="middle" style="padding:12px 14px">${body}</td>`;
  const inner = cover
    ? `<td width="${COVER_W}" height="${COVER_H}" valign="top" background="${cover}" bgcolor="${t.hairline}"`
      + ` style="width:${COVER_W}px;min-width:${COVER_W}px;height:${COVER_H}px;background-color:${t.hairline};`
      + `background-image:url('${cover}');background-size:cover;background-position:center;`
      + `border-radius:7px 0 0 7px;line-height:0;font-size:0">`
      + `<!--[if mso]><img src="${cover}" width="${COVER_W}" alt="" style="display:block"><![endif]-->&nbsp;</td>`
      + textCell
    : textCell;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"`
    + ` style="width:100%;background-color:${t.panelBg};border:1px solid ${t.cardBorder};border-radius:8px">`
    + `<tr>${inner}</tr></table>`;
}

/** The free account's card, in the receipt's slot: what the account already carries, with nothing to unlock. */
function perksHtml(t, feedUrl) {
  const inner = eyebrow(t, 'FREE ACCOUNT')
    + `<div style="padding-top:4px;font-family:${FONT};font-size:14px;font-weight:700;color:${t.ink};`
    + `mso-line-height-rule:exactly;line-height:19px">Read everything, and keep what you like.</div>`
    + `<div style="padding-top:3px;font-family:${FONT};font-size:12px;color:${t.inkSoft};`
    + `mso-line-height-rule:exactly;line-height:17px">Follow members, channels and topics, save anything into a`
    + ` collection, and read the curated news feed. No card, and no expiry.</div>`
    + (feedUrl
      ? `<div style="padding-top:6px"><a href="${escapeHtml(feedUrl)}" style="font-family:${FONT};font-size:12.5px;`
        + `font-weight:700;color:${t.accent};text-decoration:underline">Open the feed</a></div>`
      : '');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"`
    + ` style="width:100%;background-color:${t.panelBg};border:1px solid ${t.cardBorder};border-radius:8px">`
    + `<tr><td style="padding:11px">${inner}</td></tr></table>`;
}

/** The Discord block: its own panel, and the one step that is the product rather than a setting. */
function discordHtml(t, base) {
  // A coloured left border never gets a border radius on that side (owner, 2026-10-23). The Discord tile sits to the
  // left of the words (owner, 2026-10-27), in its own cell so it never wraps under them.
  const tile = `${base}${DISCORD_TILE_PATH}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"`
    + ` style="width:100%;background-color:${t.pillBg};border:1px solid ${t.pillBorder};`
    + `border-left:3px solid ${t.accent};border-radius:0 8px 8px 0">`
    + `<tr><td width="40" valign="top" style="width:40px;padding:15px 0 14px 16px;line-height:0">`
    + `<img src="${escapeHtml(tile)}" width="40" height="40" alt="Discord" style="display:block;border:0;width:40px;height:40px">`
    + `</td><td valign="top" style="padding:14px 16px 14px 14px">`
    + `<div style="font-family:${DISPLAY};font-size:16px;font-weight:700;color:${t.accent};`
    + `mso-line-height-rule:exactly;line-height:21px">Join the Discord</div>`
    + `<p style="margin:6px 0 0 0;font-family:${FONT};font-size:13px;color:${t.inkSoft};`
    + `mso-line-height-rule:exactly;line-height:19px">${escapeHtml(DISCORD_COPY)}</p>`
    + `</td></tr></table>`;
}

/** The Discord block's words, shared by the html and the text body so the two cannot say different things. */
// Owner's wording, 2026-10-27.
const DISCORD_COPY = 'Come join us inside the private Discord for all GBTI Network members. Complete onboarding below'
  + ' to claim your invite.';

/**
 * One numbered step row. `n` is its position in the WHOLE offered list, so the email and the wizard agree. The
 * number is one large digit (owner, 2026-10-27: "very large single digit steps", replacing the small 02, 03), in
 * black (owner, the same day), or the card's ink on the dark variant.
 */
function stepHtml(t, step, n) {
  const why = STEP_WHY[step.key] ?? trim(step.sub);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">`
    + `<tr><td width="40" valign="middle" style="width:40px;font-family:${DISPLAY};font-size:32px;font-weight:700;`
    + `color:${t === PALETTES.dark ? t.ink : '#000000'};mso-line-height-rule:exactly;line-height:36px">${String(n)}</td>`
    + `<td valign="middle" style="font-family:${FONT};font-size:13.5px;color:${t.ink};mso-line-height-rule:exactly;`
    + `line-height:19px"><strong style="font-weight:700">${escapeHtml(trim(step.title))}.</strong>`
    + (why ? ` ${escapeHtml(why)}` : '')
    + `</td></tr></table>`;
}

/**
 * The one button. Black with a 6px radius and 18px of height padding (owner, 2026-10-27), in the light palette the email ships with. The dark
 * variant inverts it, because a black button on the dark card would disappear.
 */
function buttonHtml(t, url, label) {
  const dark = t === PALETTES.dark;
  const bg = dark ? t.ink : '#000000';
  const fg = dark ? '#000000' : '#ffffff';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">`
    + `<tr><td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:6px">`
    + `<a href="${escapeHtml(url)}" style="display:block;padding:18px 20px;font-family:${FONT};font-size:15px;`
    + `font-weight:700;color:${fg};text-decoration:none;mso-line-height-rule:exactly;line-height:20px">`
    + `${escapeHtml(label)}</a></td></tr></table>`;
}

function footerHtml(t, prefsUrl, postalAddress) {
  const prefs = prefsUrl
    ? `<div style="padding-top:7px;font-family:${FONT};font-size:11px;mso-line-height-rule:exactly;line-height:17px">`
      + `<a href="${escapeHtml(prefsUrl)}" style="color:${t.footerLink};text-decoration:underline">Email settings</a>`
      + `</div>`
    : '';
  // The postal slot is the digest's: rendered ONLY from a supplied value, never defaulted and never hardcoded
  // here. Nothing supplies one today, which is the digest's own current state.
  const postal = trim(postalAddress)
    ? `<div style="padding-top:5px;font-family:${MONO};font-size:10px;color:${t.postalMeta};`
      + `mso-line-height-rule:exactly;line-height:16px">${escapeHtml(trim(postalAddress))}</div>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"`
    + ` style="width:100%;background-color:${t.panelBg};border-top:1px solid ${t.hairline}">`
    + `<tr><td style="padding:16px 26px 20px">`
    + `<div style="font-family:${FONT};font-size:11px;color:${t.postalMeta};mso-line-height-rule:exactly;`
    + `line-height:17px">You are receiving this because you joined GBTI Network.</div>`
    + prefs + postal
    + `</td></tr></table>`;
}

// ---- the email ------------------------------------------------------------------------------------------------

/**
 * The record one welcome email is built from. A plain projection, so the Worker's two triggers hand this the same
 * shape and the tests build it by hand.
 *
 * @param r.name      the member's greeting name, as the identity gave it ('' when unknown)
 * @param r.status    their EFFECTIVE membership status. The two step gates read it, so a wrong value here shows
 *                    the wrong list; 'unknown' is deliberately treated as paid by onboardingStepsFor, because
 *                    hiding a step on a failed read is the direction that loses a paying member work.
 * @param r.item      `{ type, title, slug, folder, image, creditTo }` for an invitation claimer, or null. Null is
 *                    not an error: it is the ordinary sign-in, who published nothing.
 * @param r.siteBase  the public site origin
 * @param r.upstream  the content repository, for the cover address
 * @param r.postalAddress the postal line, when one is configured
 * @param r.theme     'light' (the shipping variant) or 'dark'
 * @returns `{ subject, text, html }`. The text body carries the same facts in the same order.
 */
export function welcomeMail({
  name = '', status = 'unknown', item = null, siteBase = 'https://gbti.network',
  upstream = 'gbti-network/gbti.network', postalAddress = '', theme = 'light',
} = {}) {
  const t = PALETTES[theme] ?? PALETTES.light;
  const base = trim(siteBase).replace(/\/+$/, '');
  const first = greetingName(name);
  // AN UNREAD MEMBERSHIP IS OFFERED THE WHOLE LIST, exactly as the wizard does (`unread ? STEPS : ...` in
  // client-ui/src/elements/gbti-welcome.mjs). Hiding a step on a failed read is the one direction that loses a
  // paying member work they still have to do.
  const unread = !trim(status) || trim(status) === 'unknown';
  const discord = unread ? true : discordJoinAllowed(status);
  // PUBLISHED_STATUSES rather than client/src/membership.mjs canPublish, which is the same test written as
  // `=== 'paid'` but reaches js-yaml through its own imports and so cannot enter the Worker bundle for three
  // words. test/welcome-mail.test.mjs asserts the two agree on every status, so they cannot drift.
  const steps = onboardingStepsFor({ discordAvailable: discord, canPublish: unread ? true : PUBLISHED_STATUSES.has(status) });
  // Discord is shown as its own block, so it is taken OUT of the numbered list and keeps its number. The rest are
  // numbered from where it leaves them, which is how the email and the wizard agree about the order.
  const listed = steps.filter((s) => s.key !== 'discord');
  const offset = steps.length - listed.length;

  const welcomeUrl = `${base}/welcome/`;
  const prefsUrl = safeUrl(`${base}/account/notifications/`);
  const feedUrl = safeUrl(`${base}/feeds/`);
  const membershipUrl = safeUrl(`${base}/membership/`);

  const published = item && ITEM_NOUNS[trim(item.type)]
    ? {
      type: trim(item.type),
      title: trim(item.title),
      creditTo: trim(item.creditTo),
      url: safeUrl(itemUrl(item, base)),
      coverUrl: safeUrl(coverUrl({ ...item, upstream })),
    }
    : null;
  const noun = published ? ITEM_NOUNS[published.type] : '';

  // The subject names the task as well as the news (owner, 2026-10-27).
  const subject = `${published ? `Your ${noun} is live on GBTI Network` : 'Welcome to GBTI Network'}${SUBJECT_TASK}`;
  const heading = published
    ? (first ? `Your ${noun} is live, ${first}.` : `Your ${noun} is live.`)
    : (first ? `Welcome, ${first}. Here is what you can do.` : 'Welcome. Here is what you can do.');
  const preheader = published
    ? (discord ? 'Published under your name. Next, join the Discord.' : 'Published under your name. Two minutes of setup left.')
    : `${countWord(listed.length).replace(/^./, (c) => c.toUpperCase())} short steps and your feed starts showing you work you care about.`;
  const stepsLead = discord
    ? `Then ${countWord(listed.length)} short ones, about two minutes in total:`
    : `${countWord(listed.length).replace(/^./, (c) => c.toUpperCase())} short steps, about two minutes in total:`;
  const ownership = 'Edit it, add to it, or take it down whenever you like. It is yours now.';
  const paidLine = 'The Discord community and publishing your own work come with a paid membership.';
  const ctaNote = `Opens your setup on step one. Or go to ${base.replace(/^https?:\/\//, '')}/welcome in any browser.`;

  const rows = [
    // No masthead (owner, 2026-10-27): the logo and the "GBTI NETWORK" eyebrow ABOVE the heading were removed, and
    // the black mark then came back BESIDE it, vertically centred on the heading, with no eyebrow (owner, same day).
    cell(headingHtml(t, base, theme, heading), '26px 26px 14px'),
    cell(published ? receiptHtml(t, published) : perksHtml(t, feedUrl), '0 26px'),
    published ? cell(para(t, ownership), '16px 26px 0') : '',
    cell(`<div style="height:1px;background-color:${t.hairline};font-size:0;line-height:0">&nbsp;</div>`, '20px 26px 0'),
    cell(eyebrow(t, discord ? 'NEXT, FINISH YOUR SETUP' : 'NEXT, SET UP YOUR FEED'), '18px 26px 0'),
    discord ? cell(discordHtml(t, base), '12px 26px 0') : '',
    cell(`<div style="font-family:${FONT};font-size:12.5px;color:${t.inkSoft};mso-line-height-rule:exactly;`
      + `line-height:19px">${escapeHtml(stepsLead)}</div>`, '16px 26px 0'),
    ...listed.map((s, i) => cell(stepHtml(t, s, offset + i + 1), '8px 26px 0')),
    cell(buttonHtml(t, welcomeUrl, 'Complete Onboarding'), '20px 26px 0'),
    cell(`<div style="font-family:${FONT};font-size:11.5px;color:${t.meta};text-align:center;`
      + `mso-line-height-rule:exactly;line-height:17px">${escapeHtml(ctaNote)}</div>`, '9px 26px 0'),
    discord ? '' : cell(`<div style="font-family:${FONT};font-size:12px;color:${t.meta};mso-line-height-rule:exactly;`
      + `line-height:18px">${escapeHtml(paidLine)}`
      + (membershipUrl ? ` <a href="${escapeHtml(membershipUrl)}" style="color:${t.accent};text-decoration:underline">See what it costs</a>.` : '')
      + `</div>`, '18px 26px 0'),
    cell('&nbsp;', '10px 26px 0'),
    `<tr><td style="padding:0">${footerHtml(t, prefsUrl, postalAddress)}</td></tr>`,
  ].filter(Boolean);

  // Fluid-hybrid: the width ATTRIBUTE pins 600px for Outlook, which honours no max-width, and the inline
  // max-width lets every other client shrink the card instead of scaling the text down with it.
  const html = `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background-color:${t.pageBg}">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"`
    + ` style="width:100%;background-color:${t.pageBg}"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"`
    + ` style="width:100%;max-width:600px;background-color:${t.cardBg};border:1px solid ${t.cardBorder};`
    + `border-radius:10px;overflow:hidden">`
    + rows.join('')
    + `</table></td></tr></table></body></html>`;

  const text = [
    heading,
    '',
    ...(published
      ? [
        `${noun.toUpperCase()} PUBLISHED: ${published.title || `(untitled ${noun})`}`,
        published.creditTo ? `Under your name, with ${published.creditTo} credited as a contributor.` : 'Published under your name.',
        published.url ? `Your page: ${published.url}` : null,
        '',
        ownership,
      ]
      : [
        'FREE ACCOUNT: read everything, and keep what you like.',
        'Follow members, channels and topics, save anything into a collection, and read the curated news feed. No card, and no expiry.',
        feedUrl ? `The feed: ${feedUrl}` : null,
      ]),
    '',
    ...(discord
      ? [
        'JOIN THE DISCORD',
        DISCORD_COPY,
        '',
      ]
      : []),
    stepsLead,
    ...listed.map((s, i) => `${offset + i + 1}. ${trim(s.title)}. ${STEP_WHY[s.key] ?? trim(s.sub)}`),
    '',
    `Complete onboarding: ${welcomeUrl}`,
    '',
    ...(discord ? [] : [paidLine, membershipUrl ? `What it costs: ${membershipUrl}` : null, '']),
    'You are receiving this because you joined GBTI Network.',
    prefsUrl ? `Email settings: ${prefsUrl}` : null,
    trim(postalAddress) || null,
  ]
    // `null` is an absent line and `''` is a deliberate blank. Filtering both alike is how the first draft of
    // this ran every paragraph together; the collapse then stops two absent lines leaving a double gap.
    .filter((line) => line !== null && line !== undefined)
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .trim();

  return { subject, text, html };
}
