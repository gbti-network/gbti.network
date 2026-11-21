// sow-498: the entry page's right sidebar (design round 4, option C, "Run sheet"). A superadmin gets the run sheet:
// the numbered steps from community-core runSheet(), the current one outlined in green with its button, and the link
// for the call chat always on show. A member gets a Status card in the same place. Both then see who can see the
// entry, with real faces, and the facts about it.
//
// The buttons carry the entry element's existing hooks (data-op, data-copy, data-edit, data-access), so its own
// handlers run them; this module only draws.
import { esc } from '../base.mjs';
import {
  runSheet, memberStatusLine, statusPill, faceHtml, meetingText, plural, isPollKind, threadCounts,
} from '../community-core.mjs';

export const SIDE_CSS = `
  .side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .sc { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .sh { font-family: var(--f-mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-mute); font-weight: 500; }
  .run { border-color: var(--line-2); }
  .run .top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .run h2 { font-size: 16px; font-weight: 700; }
  .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .step { display: flex; gap: 9px; align-items: flex-start; padding: 9px 10px; border: 1px solid var(--line); border-radius: var(--cm-r); }
  .step.current { border: 2px solid var(--green); background: var(--green-tint); padding: 8px 9px; }
  .mk { flex: none; width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 12px; font-weight: 800; background: var(--tint); color: var(--fg-mute); }
  .step.done .mk { background: var(--cm-btn); color: #fff; }
  .step.current .mk { background: var(--paper); color: var(--green-700); box-shadow: inset 0 0 0 2px var(--green); }
  .step.ready .mk { background: var(--paper); color: var(--fg-soft); box-shadow: inset 0 0 0 1px var(--line-2); }
  .mk svg { width: 12px; height: 12px; }
  .sb { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .sb strong { font-size: 14px; }
  .step.next .sb strong { color: var(--fg-mute); }
  .sb .d { font-size: 12.5px; line-height: 1.45; color: var(--fg-mute); }
  .sb .cm-btn { align-self: flex-start; margin-top: 6px; }
  .sb .cm-quiet { align-self: flex-start; font-size: 13px; padding: 4px 0 0; }
  .lk { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 6px; }
  .lk code { display: block; align-self: stretch; padding: 7px 8px; border: 1px solid var(--line-2); border-radius: var(--cm-r); background: var(--paper-2);
    font-family: var(--f-mono); font-size: 12px; line-height: 1.45; color: var(--fg); word-break: break-all; user-select: all; }
  .lk .cm-btn2 { min-height: 34px; }
  .jl { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 2px; }
  .tools { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; border-top: 1px solid var(--line); padding-top: 4px; }
  .tools .cm-danger { margin-left: auto; }
  .stat .cm-pill { align-self: flex-start; }
  .stat p { margin: 0; font-size: 14px; line-height: 1.5; }
  .who-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .ppl { display: flex; flex-direction: column; gap: 8px; }
  .ppl span.p { display: flex; align-items: center; gap: 8px; font-size: 13.5px; min-width: 0; overflow-wrap: anywhere; }
  .ppl .cm-av { width: 24px; height: 24px; }
  .ppl details { display: flex; flex-direction: column; gap: 8px; }
  .ppl details > summary { cursor: pointer; font-size: 14px; font-weight: 600; color: var(--green-700); list-style: none; }
  .ppl details > summary::-webkit-details-marker { display: none; }
  .ppl details[open] > summary { margin-bottom: 8px; }
  .ppl details .more { display: flex; flex-direction: column; gap: 8px; }
  .fine { font-size: 13px; line-height: 1.45; color: var(--fg-mute); margin: 0; }
  dl.facts { margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; font-size: 13.5px; }
  dl.facts dt { color: var(--fg-mute); }
  dl.facts dd { margin: 0; overflow-wrap: anywhere; }
`;

const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function stepHtml(s, i, link) {
  const mark = s.status === 'done' ? TICK : String(i + 1);
  const state = { done: 'Done', current: 'Next step', ready: 'Ready', next: 'Later' }[s.status] || '';
  const btn = s.op ? `<button type="button" class="cm-btn" data-op="${esc(s.op)}">${esc(s.label)}</button>` : '';
  let quiet = '';
  if (s.quiet?.action === 'access') quiet = `<button type="button" class="cm-quiet" data-access>${esc(s.quiet.label)}</button>`;
  else if (s.quiet?.op) quiet = `<button type="button" class="cm-quiet" data-op="${esc(s.quiet.op)}">${esc(s.quiet.label)}</button>`;
  // The whole address on show (the protocol left off, so it reads at a glance); Copy takes the full link.
  const lk = s.link
    ? `<div class="lk"><code data-link aria-label="Link for the call chat">${esc(String(link).replace(/^https?:\/\//, ''))}</code><button type="button" class="cm-btn2" data-copy>Copy the link</button></div>`
    : '';
  // sow-500: the join link's own quiet controls, under the link.
  const join = s.joinLink === 'on'
    ? `<span class="jl"><button type="button" class="cm-quiet" data-join-link="off">Turn off the join link</button><button type="button" class="cm-quiet" data-join-link="new">Make a new link</button></span>`
    : s.joinLink === 'off' ? `<span class="jl"><button type="button" class="cm-quiet" data-join-link="new">Turn on the join link</button></span>` : '';
  return `<li class="step ${esc(s.status)}"${s.status === 'current' ? ' aria-current="step"' : ''}>
      <span class="mk" aria-hidden="true">${mark}</span>
      <div class="sb"><strong>${esc(s.title)}<span class="cm-sr"> (${state})</span></strong><span class="d">${esc(s.detail)}</span>${lk}${join}${btn}${quiet}</div>
    </li>`;
}

function runHtml(entry, results, { link, openedText }) {
  const sheet = runSheet(entry, { total: results?.total || 0, openedText });
  const poll = isPollKind(entry.kind);
  const lock = poll && entry.status !== 'draft'
    ? `<button type="button" class="cm-quiet" data-op="${entry.locked ? 'unlock' : 'lock'}">${entry.locked ? 'Reopen the discussion' : 'Close the discussion'}</button>`
    : '';
  return `<section class="cm-card sc run" aria-label="${esc(sheet.title)}">
      <div class="top"><h2>${esc(sheet.title)}</h2><span class="cm-mono cm-mute">${sheet.done} of ${sheet.steps.length} done</span></div>
      <ol class="steps">${sheet.steps.map((s, i) => stepHtml(s, i, link)).join('')}</ol>
      <div data-host-msg></div>
      <div class="tools"><button type="button" class="cm-quiet" data-edit>Edit</button>${lock}<button type="button" class="cm-quiet cm-danger" data-op="delete">Delete</button></div>
    </section>`;
}

function statusHtml(entry) {
  const pill = statusPill(entry);
  const line = memberStatusLine(entry);
  if (!pill || !line) return '';
  return `<section class="cm-card sc stat" aria-label="Status"><h2 class="sh">Status</h2><span class="cm-pill ${pill.tone}">${esc(pill.text)}</span><p>${esc(line)}</p></section>`;
}

function whoHtml(entry, isHost) {
  const a = entry.access || {};
  const chosen = a.mode === 'chosen';
  const members = Array.isArray(a.members) ? a.members : [];
  const n = Number(a.count ?? members.length);
  // Six names on show; the rest fold behind "Show N more", so a large group does not run down the page.
  const row = (m) => `<span class="p">${faceHtml(m)}${esc(m.login || m.username || '')}</span>`;
  const SHOWN = 6;
  const rest = members.slice(SHOWN);
  const list = chosen && members.length
    ? `<div class="ppl">${members.slice(0, SHOWN).map(row).join('')}${rest.length ? `<details><summary>Show ${rest.length} more</summary><div class="more">${rest.map(row).join('')}</div></details>` : ''}</div>`
    : '';
  return `<section class="cm-card sc" aria-label="Who can see it">
      <div class="who-h"><h2 class="sh">Who can see it</h2>${isHost ? '<button type="button" class="cm-btn2 sm" data-access>Manage access</button>' : ''}</div>
      <strong style="font-size:14px">${esc(chosen ? plural(n, 'chosen member') : 'All members')}</strong>
      ${list}
      <p class="fine">${chosen ? 'Superadmins see every entry. Other members never meet it.' : 'Every paying member can see it and take part.'}</p>
    </section>`;
}

function factsHtml(entry, discussion) {
  const poll = isPollKind(entry.kind);
  const c = threadCounts(discussion);
  const answers = Number(entry.counts?.answers) || 0;
  const rows = [
    ['Meeting', meetingText(entry.meeting)],
    ['Started by', entry.author?.login || 'the host'],
    ...(poll ? [['Answers', entry.status === 'draft' ? 'Open the poll to collect answers' : plural(answers, 'answer')]] : []),
    ['Discussion', entry.status === 'draft' ? 'Opens with the entry' : `${plural(c.posts, 'post')}${c.replies ? ` · ${plural(c.replies, 'reply', 'replies')}` : ''}`],
  ];
  return `<section class="cm-card sc" aria-label="About this entry"><h2 class="sh">About this entry</h2>
      <dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></section>`;
}

/** The whole sidebar. `link` is the entry's full address; `openedText` the opening time as the page writes it. */
export function sideHtml({ entry, results, discussion, isHost, link = '', openedText = '' }) {
  if (!entry) return '';
  return `${isHost ? runHtml(entry, results, { link, openedText }) : statusHtml(entry)}${whoHtml(entry, isHost)}${factsHtml(entry, discussion)}`;
}
