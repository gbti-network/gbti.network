// sow-383: the digest fragments that are not items. The social row (email and web), and the three pieces only the
// web edition carries: its subscribe box, its footer and its page head. Split out of mail-render.mjs so that file
// stays the one template for the ITEMS, which the email and the web edition must never render differently.
//
// Node-free and pure. Every link that points somewhere is passed through the caller's `track`, which is
// mail-render's trackUrl bound to the issue, so the social links are counted and campaign-tagged exactly like the
// rest of the mail (and the click route can resolve them: mail-click.mjs adds DIGEST_SOCIAL to its candidates).

import { DIGEST_SOCIAL, socialIconUrl, SOCIAL_HEADING } from './mail-social.mjs';
import { SUBSCRIBE_HEADING, SUBSCRIBE_BLURB } from '../src/lib/digest-subscribe-copy.mjs';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const esc = (v) => str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SANS = 'Arial,Helvetica,sans-serif';
const HEAD = "'Trebuchet MS',Verdana,sans-serif";

/**
 * Only a PUBLIC weekly issue has a web edition. A members edition carries member-only items, a welcome issue is
 * addressed to one new reader, and a test issue is a rehearsal, so none of them gets a public page or a link to
 * one. The id is also the route's whole input, so this pattern is the route's first guard.
 */
export const WEB_EDITION_ID_RE = /^weekly-\d{4}-\d{2}-\d{2}$/;

/** The web edition's address for an issue, or '' when the issue has none or there is no base to build it on. */
export function webEditionUrl(webBase, issueId) {
  const base = str(webBase).trim().replace(/\/+$/, '');
  const id = str(issueId).trim();
  if (!/^https:\/\//i.test(base) || !WEB_EDITION_ID_RE.test(id)) return '';
  return `${base}/digest/${id}`;
}

/** The site's public Turnstile key (src/lib/membership.ts), pinned equal to it by test/mail-web-edition.test.mjs. */
export const TURNSTILE_SITE_KEY = '0x4AAAAAADg66MO1G3WyZDcL';

/** "View this issue on the web", the left cell of the email masthead row. */
export function webLinkCellHtml(p, url) {
  if (!url) return '';
  return `<td align="left" valign="middle" style="font-family:${SANS};font-size:11px;mso-line-height-rule:exactly;line-height:16px">`
    + `<a href="${esc(url)}" style="color:${p.meta};text-decoration:underline">View this issue on the web</a></td>`;
}

/**
 * "Follow the GBTI Network": the accounts centred under one heading, above the footer. The email draws small
 * PNGs (Gmail strips inline SVG) themed like the masthead mark, so a dark card never gets black icons; the web
 * edition draws the SVG paths themselves. Images are off by default in many inboxes, so each icon's alt text is
 * the network's name and the row still reads as a list of links.
 */
export function socialRowHtml(p, { siteUrl, track, web = false, theme = 'light' } = {}) {
  const t = typeof track === 'function' ? track : (u) => u;
  const iconFill = theme === 'dark' ? '#ffffff' : '#000000';
  const icons = DIGEST_SOCIAL.map((s) => {
    const href = esc(t(s.href, 'social'));
    if (web) {
      return `<a href="${href}" aria-label="${esc(s.label)}" title="${esc(s.label)}" style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px">`
        + `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="${esc(s.path)}" fill="${iconFill}"></path></svg></a>`;
    }
    const src = socialIconUrl(siteUrl, theme === 'dark' ? `${s.key}-white` : s.key);
    return `<td style="padding:0 9px"><a href="${href}" style="text-decoration:none">`
      + `<img src="${esc(src)}" width="20" height="20" alt="${esc(s.label)}" style="display:block;width:20px;height:20px;border:0;outline:none"></a></td>`;
  }).join('');
  const heading = `<div style="font-family:${HEAD};font-size:13.5px;font-weight:700;color:${p.ink};mso-line-height-rule:exactly;line-height:18px">${esc(SOCIAL_HEADING)}</div>`;
  const row = web
    ? `<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:6px;padding-top:12px">${icons}</div>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:12px auto 0"><tr>${icons}</tr></table>`;
  return `<!--social-->`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:30px 28px 0">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px">`
    + `<tr><td align="center" style="border-top:1px solid ${p.hairline};padding-top:22px">${heading}${row}</td></tr></table>`
    + `</td></tr></table>`
    + `<!--/social-->`;
}

/** The same row for the plain-text alternative: one line per account. */
export function socialText(track) {
  const t = typeof track === 'function' ? track : (u) => u;
  return `${SOCIAL_HEADING}\n${DIGEST_SOCIAL.map((s) => `${s.label}: ${t(s.href, 'social')}`).join('\n')}`;
}

/**
 * The web edition's subscribe box, directly under the intro, for a page that was shared around. A plain form
 * post to the Worker's own subscribe route, which answers a form navigation with a page of its own, so it works
 * with no script of ours. Turnstile renders itself into the form (implicit rendering) and stays invisible for
 * most visitors (interaction-only), exactly like the site's box.
 */
export function subscribeBoxHtml(p, { action = '/mail/subscribe', siteKey = TURNSTILE_SITE_KEY } = {}) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:20px 28px 4px">`
    + `<form action="${esc(action)}" method="post" style="margin:0;background-color:#f7f5f1;border:1px solid ${p.cardBorder};border-radius:8px;padding:18px 20px 20px">`
    + `<div style="font-family:${HEAD};font-size:15px;font-weight:700;color:${p.ink};line-height:20px">${esc(SUBSCRIBE_HEADING)}</div>`
    + `<p style="margin:6px 0 14px;font-family:${SANS};font-size:12.5px;color:${p.inkSoft};line-height:19px">${esc(SUBSCRIBE_BLURB)}</p>`
    + `<label for="dg-email" style="display:block;font-family:${SANS};font-size:11.5px;font-weight:700;color:${p.inkSoft};padding-bottom:6px">Email address</label>`
    + `<div class="dg-sub-row" style="display:flex;gap:10px">`
    + `<input id="dg-email" name="email" type="email" required autocomplete="email" spellcheck="false" placeholder="you@example.com" style="flex-grow:1;min-width:0;height:44px;box-sizing:border-box;padding:0 12px;font-family:${SANS};font-size:14px;color:${p.ink};background:#ffffff;border:1px solid #cfc9c0;border-radius:6px">`
    + `<button type="submit" style="height:44px;padding:0 20px;font-family:${SANS};font-size:14px;font-weight:700;color:#ffffff;background-color:${p.accent};border:0;border-radius:6px;cursor:pointer">Subscribe</button>`
    + `</div>`
    + `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-size="flexible" data-appearance="interaction-only" style="margin-top:10px"></div>`
    + `</form></td></tr></table>`;
}

/**
 * The web edition's footer. It cannot say "you get this because you are on the list", and it carries no
 * Unsubscribe, because nothing was mailed to whoever is reading it. It says what the page is instead. The day is
 * held to the compile cron by test/digest-send-day.test.mjs.
 */
export function webFooterHtml(p, { track } = {}) {
  const t = typeof track === 'function' ? track : (u) => u;
  const link = (href, label) => `<a href="${esc(href)}" style="color:${p.footerLink};text-decoration:underline">${esc(label)}</a>`;
  const line = (html, pad) => `<div style="font-family:${SANS};font-size:11.5px;color:${p.meta};line-height:18px;padding-top:${pad}px">${html}</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:28px 28px 24px">`
    + `<div style="height:1px;background-color:${p.hairline};font-size:0;line-height:0">&nbsp;</div>`
    + line('This is the web edition of the GBTI Network weekly digest. A new issue goes out every Monday.', 14)
    + line(`${link(t('/feeds/', 'footer-feed'), 'Open the feed')} &middot; ${link(t('/', 'footer-home'), 'gbti.network')}`, 9)
    + `</td></tr></table>`;
}

// THE EMAIL'S FIXED TABLES, MADE FLUID ON A PHONE WITHOUT TOUCHING THE EMAIL. The template is 600px tables with
// widths as attributes, which is right for an inbox and wrong for a phone browser, where a shared link mostly
// opens. Attribute selectors reach every one of them from a single style block, so the web edition renders the
// SAME markup as the email and only the page around it differs.
const WEB_CSS = 'body{margin:0}'
  + 'a:hover{opacity:.85}'
  + '@media (max-width:640px){'
  + 'table[width="600"]{width:100%!important}'
  + 'td[width="600"]{width:auto!important;padding:12px 10px 28px!important}'
  + 'table[width="536"],table[width="480"]{width:100%!important}'
  + 'td[width="536"],td[width="480"],td[width="368"]{width:auto!important}'
  + 'td[width="536"][style*="28px"]{padding-left:16px!important;padding-right:16px!important}'
  + 'td[width="96"],img[width="96"]{width:72px!important;max-width:72px!important}'
  + '}'
  + '@media (max-width:480px){.dg-sub-row{flex-direction:column}.dg-sub-row button{width:100%}}';

/** The web edition's head: what a shared link previews as, the phone styles, and the Turnstile loader. */
export function webHeadHtml({ title, description, url, image } = {}) {
  const meta = (prop, content, attr = 'property') => (content ? `<meta ${attr}="${prop}" content="${esc(content)}">` : '');
  return (url ? `<link rel="canonical" href="${esc(url)}">` : '')
    + meta('description', description, 'name')
    + meta('og:type', 'article')
    + meta('og:site_name', 'GBTI Network')
    + meta('og:title', title)
    + meta('og:description', description)
    + meta('og:url', url)
    + meta('og:image', image)
    + meta('twitter:card', 'summary_large_image', 'name')
    + `<style>${WEB_CSS}</style>`
    + `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;
}
