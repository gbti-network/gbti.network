// sow-499: anonymous or public answers on the entry page (design round 5, option B). The two named choices under the
// answer, the line that says which one a saved answer is (with the switch), and the names of the public answers in
// the results. Copy rule (owner): the words are Anonymous and Public, nothing else.
//
// A public answer's chip links to the member's profile only when they have one: /members-index.json (a static file on
// the CDN) lists the public profiles by GBTI name, and the Worker sends each public answerer's GBTI name. A failed read
// of either leaves the chips unlinked, never linked to a guess.
import { esc } from '../base.mjs';
import { faceHtml, peopleLine, profileHref } from '../community-core.mjs';

export const ANSWER_CSS = `
  .vis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .vc { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line-2); border-radius: var(--cm-r); background: var(--paper); cursor: pointer; }
  .vc.on { border: 2px solid var(--green); background: var(--green-tint); padding: 9px 11px; }
  .vc input { margin-top: 2px; }
  .vc span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .vc strong { font-size: 14px; }
  .vc small { font-size: 12.5px; line-height: 1.4; color: var(--fg-mute); }
  .vline { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 8px 12px; border-radius: var(--cm-r); background: var(--tint); font-size: 13.5px; }
  .vline .cm-quiet { margin-left: auto; padding: 2px 0; }
  .ppl-row { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .pchip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px 2px 2px; border: 1px solid var(--line); border-radius: var(--cm-r); background: var(--paper); color: var(--fg); font-size: 12.5px; font-weight: 600; text-decoration: none; }
  a.pchip:hover { border-color: var(--green); color: var(--green-700); }
  .pchip .cm-av { width: 20px; height: 20px; }
  .anon { font-size: 12px; color: var(--fg-mute); }
  @media (max-width: 480px) { .vis { grid-template-columns: minmax(0, 1fr); } }
`;

/** The two named choices, Anonymous selected unless the member picked Public. `disabled` for the host's draft preview. */
export function visibilityHtml(isPublic, { disabled = false } = {}) {
  const card = (value, label, line, on) => `<label class="vc${on ? ' on' : ''}"><input type="radio" name="vis" value="${value}"${disabled ? ' disabled' : ' data-vis'}${on ? ' checked' : ''}>
      <span><strong>${label}</strong><small>${line}</small></span></label>`;
  return `<div class="vis" role="radiogroup" aria-label="Anonymous or public">
      ${card('anon', 'Anonymous', 'Counted. Nobody sees it was you.', !isPublic)}
      ${card('public', 'Public', 'Members see it was you once the results are published.', isPublic)}
    </div>`;
}

/** Which one a saved answer is, and (while voting is open) the switch to the other. */
export function savedVisibilityHtml(mine, { canSwitch }) {
  if (!mine) return '';
  const pub = mine.public === true;
  const text = pub ? '<strong>Public.</strong> Members see it was you once the results are published.' : '<strong>Anonymous.</strong> Nobody sees it was you.';
  const sw = canSwitch ? `<button type="button" class="cm-quiet" data-vis-switch="${pub ? 'anon' : 'public'}">${pub ? 'Make it anonymous' : 'Make it public'}</button>` : '';
  return `<div class="vline">${text}${sw}</div>`;
}

/** The public answers on one result bar, each a chip (linked to a profile when there is one), then the anonymous count. */
export function peopleHtml(group, known) {
  const people = Array.isArray(group?.people) ? group.people : [];
  const chips = people.map((p) => {
    const href = profileHref(p.folder, known);
    const inner = `${faceHtml(p)}${esc(p.login || p.folder || '')}`;
    return href ? `<a class="pchip" href="${esc(href)}">${inner}</a>` : `<span class="pchip">${inner}</span>`;
  }).join('');
  const line = peopleLine(group);
  if (!chips && !line) return '';
  return `<span class="ppl-row">${chips}${line ? `<span class="anon">${esc(line)}</span>` : ''}</span>`;
}

let known = null;
/** The GBTI names that have a public profile page, read once per page. Resolves to a Set, empty on any failure. */
export function loadKnownProfiles(fetchImpl = globalThis.fetch) {
  if (!known) {
    known = Promise.resolve()
      .then(() => fetchImpl('/members-index.json', { credentials: 'omit' }))
      .then((r) => (r && r.ok ? r.json() : { members: [] }))
      .then((j) => new Set((Array.isArray(j?.members) ? j.members : Array.isArray(j) ? j : []).map((m) => String(m?.username || '').toLowerCase()).filter(Boolean)))
      .catch(() => new Set());
  }
  return known;
}
