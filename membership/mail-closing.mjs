// The digest's header line and its closing message. Owner copy, 2026-09-29.
//
// THE CLOSING HAS TWO AUDIENCES, and the choice is per RECIPIENT, not per issue. A paying member reads how to
// contribute and a reminder about the extension; everybody else (an email-only subscriber, a free account, the
// public web edition) reads the invitation to join. It cannot follow the members EDITION alone: that edition is
// only composed in a week that has members-only shares, so in any other week a paying member is sent the public
// issue and would be asked to join. The Worker decides the audience from the same entitlement list the members
// edition uses (membership/digest-entitlement.mjs) and passes it in as ctx.audience.
//
// FAIL TOWARDS THE INVITATION. Anything that is not a clear 'member' gets the guest copy: a member shown the
// invitation has lost nothing, where a non-member told to "visit your WorkBench" has been sent to a page they
// cannot use.
//
// EVERY LINK HERE IS A FIXED TARGET, registered in mail-click.mjs's FIXED_TARGETS from the CLOSING_TARGETS below.
// A tracked link the click counter cannot find in its candidate set bounces the reader to the site root, so the
// two must never be separate copies.
import { WEB_STORE_URL } from '../src/lib/extension-store.mjs';

/** The line under the weekly greeting. The welcome issue carries its own (mail-digest.mjs). */
export const WEEKLY_HEADER_LINE = 'Thanks for being a subscriber to the GBTI Digest. Inside you will find the latest projects, shares and agent skills created by our network community.';

/**
 * The sign-off: the last line before the social row, centred, italic and a little larger than the closing
 * (owner, 2026-09-29). It sits under the web edition's subscribe box, and in the email, which has no box, directly
 * under the closing.
 */
export const SIGN_OFF = 'Wishing you a great week ahead! 🙏 🙌';

export function signOffHtml(p, { esc }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" align="center" style="width:536px;padding:26px 28px 0;text-align:center">`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-style:italic;color:${p.inkSoft};mso-line-height-rule:exactly;line-height:22px">${esc(SIGN_OFF)}</div>`
    + `</td></tr></table>`;
}

/** Where each closing link points, keyed by its click placement. */
export const CLOSING_TARGETS = Object.freeze({
  'closing-membership': '/membership/',
  'closing-workbench': '/workbench/',
  'closing-extension': WEB_STORE_URL,
});

// The brand green, for the member blockquote rule: 3.4:1 on the light card and 4.4:1 on the dark one, over the
// 3:1 a non-text mark needs.
const BRAND_GREEN = '#1f9e5f';

const LEAD = 'Thanks everyone for paying attention! We share a digest like this one every week.';

// Each audience's copy as parts: plain text, or a link { text, placement }.
const COPY = Object.freeze({
  guest: [
    'If you are interested in joining and writing for the GBTI Network community, please visit our ',
    { text: 'memberships page', placement: 'closing-membership' },
    '.',
  ],
  member: [
    'To contribute to future digests, visit your ',
    { text: 'WorkBench', placement: 'closing-workbench' },
    ' inside your user account area. Also do not forget that we provide a ',
    { text: 'Chrome extension', placement: 'closing-extension' },
    ' for members to help bring them network and news based content daily! Thanks for paying attention and see you next week!',
  ],
});

/** 'member' only for an explicit member; everything else is the invitation. */
export const closingAudience = (audience) => (audience === 'member' ? 'member' : 'guest');

/**
 * The closing block. `track(url, placement)` is the renderer's own link builder, so these links are counted and
 * tagged exactly like every other link in the issue; `esc` is its html escaper.
 */
export function closingHtml(p, { audience, track, esc }) {
  const parts = COPY[closingAudience(audience)].map((part) => (typeof part === 'string'
    ? esc(part)
    : `<a href="${esc(track(CLOSING_TARGETS[part.placement], part.placement))}" style="color:${p.footerLink};text-decoration:underline">${esc(part.text)}</a>`)).join('');
  const para = (html, pad, extra = '', color = p.inkSoft) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;${extra}color:${color};mso-line-height-rule:exactly;line-height:19px;padding-top:${pad}px">${html}</div>`;
  // Owner, 2026-09-29: the member paragraph is set in italics and a lighter grey (p.mute, still AA); the invitation
  // stays upright in the standard text colour.
  const member = closingAudience(audience) === 'member';
  const italic = member ? 'font-style:italic;' : '';
  const color = member ? (p.mute || p.inkSoft) : p.inkSoft;
  // Owner, 2026-09-29: the member paragraph reads as a blockquote, a square brand-green rule down its left edge.
  // A table cell carries the border because Outlook's renderer drops borders and padding on a plain div.
  const quote = (html, pad) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:${pad}px">`
    + `<tr><td style="border-left:3px solid ${BRAND_GREEN};border-radius:0;padding:2px 0 2px 14px">${html}</td></tr></table>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:30px 28px 0">`
    + para(esc(LEAD), 0)
    + (member ? quote(para(parts, 0, italic, color), 10) : para(parts, 8, italic, color))
    + `</td></tr></table>`;
}

/** The same closing for the text part, each link written out after its words. */
export function closingText({ audience, track }) {
  const body = COPY[closingAudience(audience)].map((part) => (typeof part === 'string'
    ? part
    : `${part.text} (${track(CLOSING_TARGETS[part.placement], part.placement)})`)).join('');
  return `${LEAD}\n${body}`;
}
