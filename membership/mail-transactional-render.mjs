// sow-270: the double opt-in confirmation email.
//
// It is the ONE message a subscriber receives that skipped every template we have. The digest arrives in the
// branded shell, a follow notification arrives in its own branded shell, and the email deciding whether either
// of them ever arrives was a bare paragraph stack with a system font. A confirmation is the first thing a new
// subscriber sees from us, and the one most likely to be mistaken for a phishing attempt, so looking like the
// sender it claims to be is the whole job.
//
// PURE and node-free, like membership/mail-render.mjs and membership/mail-notify-render.mjs: no Date.now, no
// environment, no IO. It takes a confirm url and returns { subject, html, text }.
//
// WHY THIS CARRIES ITS OWN SHELL RATHER THAN CALLING THE DIGEST'S. renderIssue (mail-render.mjs:545) takes an
// ISSUE of sections and items and carries ten CAN-SPAM sentinel guards that read invisible markers it emits. A
// confirmation has no sections and no items, so there is nothing to pass it, and reshaping it to be callable
// would put those guards at risk for a message that does not need them. mail-notify-render.mjs already answered
// this question for the notification email and recorded the binding condition: a second message kind ships its
// own lean shell, and shared logic is NOT hoisted into a helper both call.
//
// THE PALETTE IS COPIED, NOT IMPORTED, for the same recorded reason. A palette is data rather than shared
// logic, and a small local copy keeps this module independent of the digest renderer's PALETTES structure. The
// values match the light variant the other two ship, because light is what every mail client actually gets:
// the dark palette is a server-side pick that production never makes.
//
// THE ONE IMPORT IS THE ESCAPING, and that is deliberate rather than inconsistent. escapeHtml and safeUrl ARE
// the injection and href-safety guard, so re-implementing them here would risk a divergent, weaker escaper,
// which is the opposite of keeping a guard intact.
//
// NO UNSUBSCRIBE LINK, AND THAT IS NOT AN OVERSIGHT. Nothing is subscribed at this point. The whole purpose of
// the message is that the address is enrolled only if the person acts, so the opt-out is to do nothing, which
// the body says in as many words. An unsubscribe link here would offer to cancel a subscription that does not
// exist, and clicking it would suppress an address that never consented to anything.
//
// NO POSTAL ADDRESS. The digest and the notification render one only when the drain supplies it, and a street
// address is never defaulted or hardcoded in a committed file. This message has no such supply and adds none.

import { escapeHtml, safeUrl } from './mail-render.mjs';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// The light palette, matching the other two renderers' shipping variant. See the note above on why it is a copy.
const P = {
  pageBg: '#efece7', cardBg: '#ffffff', cardBorder: '#e0dbd3', hairline: '#eae6df',
  ink: '#232029', inkSoft: '#4a4653', meta: '#7c7784', accent: '#187a4b', button: '#1f9e5f',
};

const SUBJECT = 'Confirm your GBTI Network digest subscription';

/** How long a confirm link stays good, stated in the body. Kept in step with OPTIN_TTL_SECONDS by a test. */
export const CONFIRM_WINDOW_HOURS = 48;

/**
 * Render the double opt-in confirmation email.
 *
 * @param {object} a
 * @param {string} a.confirmUrl  the link from the pending opt-in record. An unsafe value fails closed to ''.
 * @param {string} [a.siteUrl]   the public site, for the footer line only.
 * @returns {{subject: string, html: string, text: string}|null}  null when there is no usable confirm link,
 *   so a caller can decline to send rather than deliver a message whose only purpose is a link it does not have.
 */
export function renderConfirmationEmail({ confirmUrl, siteUrl } = {}) {
  const url = safeUrl(str(confirmUrl).trim());
  if (!url) return null;
  const site = safeUrl(str(siteUrl).trim()) || 'https://gbti.network';
  const safe = escapeHtml(url);

  const preheaderText = escapeHtml('One click and the weekly digest starts arriving on Tuesday mornings.');
  const preheader = `<span style="display:none;font-size:1px;color:${P.pageBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheaderText}</span>`;

  const header = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:24px 28px 0">`
    + `<div style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:18px;font-weight:700;color:${P.ink};mso-line-height-rule:exactly;line-height:22px">GBTI <span style="color:${P.accent}">Network</span></div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:${P.inkSoft};mso-line-height-rule:exactly;line-height:19px;padding-top:10px">Confirm your subscription</div>`
    + `</td></tr></table>`;

  const card = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:16px 28px 4px">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px;background-color:${P.cardBg};border:1px solid ${P.cardBorder};border-radius:8px">`
    + `<tr><td style="padding:24px 22px">`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:${P.ink};mso-line-height-rule:exactly;line-height:22px">One click and you are on the list</div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13.5px;color:${P.inkSoft};mso-line-height-rule:exactly;line-height:21px;padding-top:10px">Somebody asked for the GBTI Network weekly digest at this address. Confirm it and the digest starts arriving on Tuesday mornings.</div>`
    + `<div style="padding-top:18px"><a href="${safe}" style="display:inline-block;background-color:${P.button};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:6px">Confirm subscription</a></div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${P.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:16px">If the button does not work, paste this address into your browser:</div>`
    + `<div style="font-family:'Courier New',monospace;font-size:11px;color:${P.inkSoft};mso-line-height-rule:exactly;line-height:17px;padding-top:6px;word-break:break-all"><a href="${safe}" style="color:${P.inkSoft};text-decoration:underline">${safe}</a></div>`
    + `</td></tr></table>`
    + `</td></tr></table>`;

  const footer = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:26px 28px 24px">`
    + `<div style="height:1px;background-color:${P.hairline};font-size:0;line-height:0">&nbsp;</div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${P.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:14px">This link works for ${CONFIRM_WINDOW_HOURS} hours. If you did not ask for the digest, ignore this email: nothing is sent to this address unless the link is followed.</div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${P.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:9px"><a href="${escapeHtml(site)}" style="color:${P.inkSoft};text-decoration:underline">gbti.network</a></div>`
    + `</td></tr></table>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(SUBJECT)}</title></head>`
    + `<body style="margin:0;padding:0;background-color:${P.pageBg}">`
    + preheader
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center" style="width:600px;background-color:${P.pageBg}">`
    + `<tr><td width="600" align="center" style="width:600px;padding:24px 0 40px">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:0">`
    + header + card + footer
    + `</td></tr></table>`
    + `</td></tr></table>`
    + `</body></html>`;

  // The plain-text alternative says everything the HTML says, in the same order, with the same link. A reader
  // on a text-only client has to be able to confirm, so the url is on its own line and unwrapped.
  const text = 'CONFIRM YOUR GBTI NETWORK DIGEST SUBSCRIPTION\n\n'
    + 'Somebody asked for the GBTI Network weekly digest at this address. Confirm it and the digest\n'
    + 'starts arriving on Tuesday mornings.\n\n'
    + `${url}\n\n`
    + `This link works for ${CONFIRM_WINDOW_HOURS} hours. If you did not ask for the digest, ignore this email:\n`
    + 'nothing is sent to this address unless the link is followed.\n\n'
    + `----\n${site}\n`;

  return { subject: SUBJECT, html, text };
}
