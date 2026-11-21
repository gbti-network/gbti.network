// sow-498: the Community list page's right sidebar (design round 4b, option L1 "Now and next"). Live now, the next
// Shop Talk with its calendar link, and for a superadmin what is waiting on them, with New entry. It is built from
// the entries the page already loaded, so it costs no request of its own.
//
// The call's time comes from house/shoptalk.yml at build time (the page passes it in, the zone label derived from the
// IANA zone); the date is the next Saturday on the viewer's own calendar. With no time passed, the card is left out
// rather than guessed.
import { esc } from '../base.mjs';
import { KIND_ICON } from './community-css.mjs';
import { KIND_LABEL, listOverview, liveCountLine, nextShoptalk, entryHref, plural } from '../community-core.mjs';

export const LIST_SIDE_CSS = `
  .side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .sc { padding: 18px; display: flex; flex-direction: column; gap: 6px; }
  .sh { font-family: var(--f-mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-mute); font-weight: 500; }
  .sc .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; }
  .open-n { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--green-700); }
  .open-n::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--green); }
  .sl { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--line); text-decoration: none; color: var(--fg); }
  .sl:first-of-type { border-top: 0; }
  .sl:hover strong { color: var(--green-700); text-decoration: underline; text-underline-offset: 3px; }
  .sl .cm-badge { padding: 5px 7px; }
  .sl span.t { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .sl strong { font-size: 15px; line-height: 1.35; overflow-wrap: anywhere; }
  .sl small { font-size: 13px; color: var(--fg-mute); }
  .quiet-line { margin: 0; font-size: 14px; line-height: 1.5; color: var(--fg-soft); }
  .call strong.disp { font-family: var(--f-display); font-size: 22px; line-height: 1.15; }
  .call .when { font-size: 15px; }
  .call a { font-size: 14px; font-weight: 600; margin-top: 4px; }
  .host-box { border-color: var(--line-2); gap: 10px; }
  .host-box .cm-btn { width: 100%; }
  .qn { flex: none; min-width: 26px; height: 26px; padding: 0 6px; border-radius: var(--cm-r); display: inline-grid; place-items: center; font-size: 13px; font-weight: 800; background: var(--tint); color: var(--fg-soft); }
  .qn.amber { background: var(--amber-tint); color: var(--amber-text); }
`;

const shortTitle = (t, n = 72) => { const s = String(t || ''); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };

function liveHtml(live) {
  const rows = live.slice(0, 5).map((e) => `<a class="sl" href="${esc(entryHref(e.id))}"><span class="cm-badge k-${esc(e.kind)}" title="${esc(KIND_LABEL[e.kind] || e.kind)}">${KIND_ICON[e.kind] || ''}</span>
      <span class="t"><strong>${esc(shortTitle(e.title))}</strong><small>${esc(liveCountLine(e))}</small></span></a>`).join('');
  return `<section class="cm-card sc" aria-label="Live now">
      <div class="top"><h2 class="sh">Live now</h2>${live.length ? `<span class="open-n">${live.length} open</span>` : ''}</div>
      ${rows || '<p class="quiet-line">Nothing is live right now. Polls and topics open during the call.</p>'}
    </section>`;
}

function callHtml(callTime, now, idle) {
  if (!callTime) return '';
  const next = nextShoptalk(now);
  return `<section class="cm-card sc call" aria-label="Next meeting">
      <h2 class="sh">Next meeting</h2>
      <strong class="disp">Shop Talk</strong>
      <span class="when">${esc(next.day)} at ${esc(callTime)}</span>
      <p class="quiet-line">${idle ? 'Nothing is live right now. ' : ''}New polls and topics open during the call. Keep this page open.</p>
      <a href="/shoptalk.ics">Add the call to your calendar</a>
    </section>`;
}

function hostHtml({ drafts, toPublish }) {
  const row = (e, n, label, tone) => `<a class="sl" href="${esc(entryHref(e.id))}"><span class="qn${tone ? ` ${tone}` : ''}">${n}</span>
      <span class="t"><strong>${esc(label)}</strong><small>${esc(shortTitle(e.title, 60))}</small></span></a>`;
  const items = [];
  if (drafts.length) items.push(row(drafts[0], drafts.length, drafts.length === 1 ? 'Draft to open' : `${plural(drafts.length, 'draft')} to open`, ''));
  if (toPublish.length) items.push(row(toPublish[0], toPublish.length, toPublish.length === 1 ? 'Results to publish' : `Results to publish on ${plural(toPublish.length, 'poll')}`, 'amber'));
  return `<section class="cm-card sc host-box" aria-label="Waiting on you">
      <h2 class="sh">Waiting on you</h2>
      <button type="button" class="cm-btn" data-new>New entry</button>
      ${items.join('') || '<p class="quiet-line">Nothing is waiting on you.</p>'}
    </section>`;
}

/** The whole sidebar. `entries` as the page loaded them; `callTime` from the page ("11:00 AM Central Time"). */
export function listSideHtml({ entries, isHost, callTime = '', now = new Date() }) {
  const o = listOverview(entries);
  const host = isHost ? hostHtml(o) : '';
  // Nothing live: lead with the next meeting, which says so, rather than a card that only says it is empty.
  if (!o.live.length && callTime) return `${callHtml(callTime, now, true)}${host}`;
  return `${liveHtml(o.live)}${callHtml(callTime, now, false)}${host}`;
}
