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
 * The sign-off: the last line before the social row, centred and italic (owner, 2026-09-29). Its face follows
 * the closing above it (the footer design the owner picked the same day): a member's panel closes on the sans
 * italic, a non-member's centred colophon on a serif italic a size up. On the web edition it sits under the
 * subscribe box; in the email, which has no box, directly under the closing.
 */
export const SIGN_OFF = 'Wishing you a great week ahead! 🙏 🙌';

export function signOffHtml(p, { esc, audience }) {
  const face = closingAudience(audience) === 'member'
    ? `font-family:${SANS};font-size:15px;font-style:italic`
    : `font-family:${SERIF};font-size:16px;font-style:italic`;
  const pad = closingAudience(audience) === 'member' ? '24px 28px 0' : '20px 48px 0';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" align="center" style="width:536px;padding:${pad};text-align:center">`
    + `<div style="${face};color:${p.inkSoft};mso-line-height-rule:exactly;line-height:22px">${esc(SIGN_OFF)}</div>`
    + `</td></tr></table>`;
}

/** Where each closing link points, keyed by its click placement. */
export const CLOSING_TARGETS = Object.freeze({
  'closing-membership': '/membership/',
  'closing-workbench': '/workbench/',
  'closing-extension': WEB_STORE_URL,
});

const SANS = 'Arial,Helvetica,sans-serif';
const HEAD = "'Trebuchet MS',Verdana,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

// The brand green, for the colophon's short rule: 3.4:1 on the light card and 4.4:1 on the dark one, over the
// 3:1 a non-text mark needs.
const BRAND_GREEN = '#1f9e5f';

/**
 * The closing's first line. On the web edition a non-member reads it at the end of the page's footer line instead
 * (owner, 2026-09-29), so the closing there opens on the invitation.
 */
export const CLOSING_LEAD = 'Thanks everyone for paying attention! We share a digest like this one every week.';

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

// OWNER, 2026-09-29, from the footer design canvas: the green blockquote rule is gone. A member reads the closing
// in a warm panel under a small "GBTI Digest" label ("B · Panel"); everybody else reads it as a centred colophon
// under a short green rule, the first line in a serif ("C · Colophon"). Table cells carry every box, because
// Outlook's renderer drops borders, backgrounds and padding on a plain div.
function panelHtml(p, body, esc) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:32px 28px 0">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${p.panelBg}" style="width:100%;background-color:${p.panelBg};border:1px solid ${p.cardBorder};border-radius:8px">`
    + `<tr><td style="padding:20px 22px 22px">`
    + `<div style="font-family:${HEAD};font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${p.accent};mso-line-height-rule:exactly;line-height:14px">GBTI Digest</div>`
    + `<div style="font-family:${HEAD};font-size:15px;font-weight:700;color:${p.ink};mso-line-height-rule:exactly;line-height:21px;padding-top:10px">${esc(CLOSING_LEAD)}</div>`
    + `<div style="font-family:${SANS};font-size:13px;color:${p.inkSoft};mso-line-height-rule:exactly;line-height:20px;padding-top:8px">${body}</div>`
    + `</td></tr></table>`
    + `</td></tr></table>`;
}

function colophonHtml(p, body, esc, { lead }) {
  const rule = `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">`
    + `<tr><td width="32" height="2" bgcolor="${BRAND_GREEN}" style="width:32px;height:2px;background-color:${BRAND_GREEN};font-size:0;line-height:0;mso-line-height-rule:exactly">&nbsp;</td></tr></table>`;
  const serif = (html) => `<div style="font-family:${SERIF};font-size:17px;color:${p.ink};mso-line-height-rule:exactly;line-height:25px;padding-top:20px">${html}</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" align="center" style="width:536px;padding:40px 48px 0;text-align:center">`
    + rule
    + (lead
      ? serif(esc(CLOSING_LEAD))
        + `<div style="font-family:${SANS};font-size:13px;color:${p.inkSoft};mso-line-height-rule:exactly;line-height:20px;padding-top:10px">${body}</div>`
      : serif(body))
    + `</td></tr></table>`;
}

/**
 * The closing block. `track(url, placement)` is the renderer's own link builder, so these links are counted and
 * tagged exactly like every other link in the issue; `esc` is its html escaper. `web` is the web edition, where a
 * non-member's lead line lives in the footer instead.
 */
export function closingHtml(p, { audience, track, esc, web = false }) {
  const parts = COPY[closingAudience(audience)].map((part) => (typeof part === 'string'
    ? esc(part)
    : `<a href="${esc(track(CLOSING_TARGETS[part.placement], part.placement))}" style="color:${p.ink};text-decoration:underline">${esc(part.text)}</a>`)).join('');
  return closingAudience(audience) === 'member'
    ? panelHtml(p, parts, esc)
    : colophonHtml(p, parts, esc, { lead: !web });
}

/** The same closing for the text part, each link written out after its words. */
export function closingText({ audience, track }) {
  const body = COPY[closingAudience(audience)].map((part) => (typeof part === 'string'
    ? part
    : `${part.text} (${track(CLOSING_TARGETS[part.placement], part.placement)})`)).join('');
  return `${CLOSING_LEAD}\n${body}`;
}
