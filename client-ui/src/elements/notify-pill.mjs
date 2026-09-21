// sow-385: the notification-settings PILL, shared by <gbti-notifications-settings> and <gbti-notify-modal> so the two
// surfaces cannot drift: its markup (notifyPillHtml) and the BLOCKED Email pill's styles (BLOCKED_PILL_CSS). Email
// notifications are switched off for now (owner, 2026-09-21), and trying to turn one on shows a blocked cursor and a
// tooltip with the owner's wording (EMAIL_DISABLED_TIP, carried in data-tip). The markup is a pure function so node
// tests can pin it; the element modules and base.mjs guard the DOM, so this imports cleanly outside a browser.
import { esc } from '../base.mjs';
import { channelBlocked, EMAIL_DISABLED_TIP } from '../notify-matrix-core.mjs';

/**
 * One channel pill for one matrix row. A blocked channel (email, while switched off) renders focusable but inert:
 * aria-disabled rather than disabled, so the tooltip also shows on keyboard focus, and aria-pressed is always false
 * whatever was stored. The elements attach clicks only to pills WITHOUT aria-disabled, and their toggle handlers
 * refuse a blocked channel as well.
 */
export function notifyPillHtml({ rowKey, channel, label, on = false, disabled = false } = {}) {
  const cell = `${esc(rowKey)}:${esc(channel)}`;
  if (channelBlocked(channel)) {
    return `<button type="button" class="pill blocked" data-cell="${cell}" aria-pressed="false" aria-disabled="true" data-tip="${esc(EMAIL_DISABLED_TIP)}" aria-label="${esc(label)}. ${esc(EMAIL_DISABLED_TIP)}">${esc(label)}</button>`;
  }
  return `<button type="button" class="pill${on ? ' on' : ''}" data-cell="${cell}" aria-pressed="${!!on}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
}

// THREE THINGS THE BLOCKED STYLES HAVE TO BEAT, each measured in a browser rather than assumed:
//   - BASE_CSS gives every bare button `button:hover { background: var(--brand-dark) }`, which is why an unpressed
//     pill turns green on hover. `.pill.blocked` already outranks it (two classes beat one element and one pseudo);
//     the explicit :hover in the same rule also outranks any `.pill:hover` a later change adds, so a blocked pill can
//     never look clickable. (A mutation run showed the explicit :hover is defensive, not load-bearing, today.)
//   - The modal's read-only grid sets `.grid[data-locked] .pill { cursor: default }` (four selectors deep), which
//     would override a plain `.pill.blocked` cursor, so that case is named explicitly.
//   - BOTH containers clip their overflow (the settings card and the modal's grid are overflow:hidden), so a
//     tooltip opening above the top row or below the bottom row would be cut off. It opens to the LEFT of the pill,
//     level with it, which keeps it inside the row it belongs to.
//
// No opacity on the pill itself: a dimmed pill would dim its own tooltip with it (the modal's read-only grid did
// exactly that until it was changed to dim its parts instead). It reads as unavailable through a dashed border and
// muted text.
export const BLOCKED_PILL_CSS = `
  .pill.blocked, .pill.blocked:hover, .pill.blocked:focus-visible {
    background:transparent; border-style:dashed; border-color:var(--line); color:var(--muted); cursor:not-allowed; }
  .grid[data-locked] .pill.blocked { cursor:not-allowed; }
  .pill.blocked { position:relative; }
  .pill.blocked::after { content:attr(data-tip); position:absolute; right:calc(100% + 8px); top:50%; transform:translateY(-50%);
    z-index:5; white-space:nowrap; padding:6px 10px; border-radius:8px; background:var(--fg); color:var(--panel);
    font-size:12px; font-weight:600; line-height:1.3; letter-spacing:0; box-shadow:0 6px 18px rgba(0,0,0,.18);
    opacity:0; visibility:hidden; pointer-events:none; transition:opacity .12s ease, visibility .12s ease; }
  .pill.blocked:hover::after, .pill.blocked:focus-visible::after { opacity:1; visibility:visible; }
`;
