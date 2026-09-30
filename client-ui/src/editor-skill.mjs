// sow-109 Phase 5: the prompt editor's "What are you sharing?" choice and, for a skill, the parts a skill adds: the
// install note, the "Made for" tick list, the skill file (SKILL.md) and the "Commands and usage" heading on the page
// text. Laid out from the approved canvas (the WorkbenchEditor board). Split out of gbti-content-editor.mjs, which is
// already past the size cap, so that file only calls in: it renders these strings and runs wireSkillEditor once.
//
// Nothing here is a new contract. The choice writes the `kind` form field, the tick list writes the same `targets`
// input the rail's chips write, and the skill file is read by the editor's gather() and published beside index.md by
// the shared rule in client/src/skill-file.mjs.
import { esc } from './base.mjs';
import { SITE_ORIGIN } from './public-url.mjs';
import { skillTokenDecls } from '../../src/lib/skill-box-css.mjs';

export const normalizeKind = (v) => (v === 'skill' ? 'skill' : 'prompt');

const svg = (d, size, width = 2.4) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  prompt: '<path d="M4 6h16M4 12h11M4 18h7"/>',
  skill: '<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  install: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
};

const CARDS = [
  { kind: 'prompt', name: 'Prompt', desc: 'Text a reader copies into ChatGPT, Claude, Gemini or another AI tool.' },
  { kind: 'skill', name: 'Skill', desc: 'A SKILL.md file a reader installs once, so their agent gains a new slash command.' },
];

/** The heading over the editor's body, which is the prompt itself for a prompt and the page text for a skill. */
export function mainHeading(kind) {
  return normalizeKind(kind) === 'skill'
    ? { title: 'Commands and usage', optional: true, sub: 'The commands your skill adds and what each one does. Shown under the install box.' }
    : { title: 'The prompt', optional: false, sub: 'The text a reader copies into their AI tool.' };
}

/** The inner markup of the body heading (the editor supplies its own icon in front). */
export const mainHeadingHtml = (kind) => {
  const h = mainHeading(kind);
  // The Optional tag is always rendered and only hidden, so switching a new prompt to a skill can show it.
  return `<span data-main-title>${esc(h.title)}</span> <span class="dsub-opt" data-main-opt${h.optional ? '' : ' hidden'}>Optional</span> <span class="dsub" data-main-sub>${esc(h.sub)}</span>`;
};

/** The two cards, with the hidden `kind` input gather() reads. */
export function kindSectionHtml(kind) {
  const cur = normalizeKind(kind);
  const cards = CARDS.map((c) => `<button type="button" class="kind-card${c.kind === cur ? ' on' : ''}" role="radio" aria-checked="${c.kind === cur}" data-kind-pick="${c.kind}">
      <span class="kc-top"><span class="kc-ico kc-${c.kind}">${svg(ICON[c.kind], 18)}</span><span class="kc-name">${esc(c.name)}</span><span class="kc-check">${svg(ICON.check, 13, 3.2)}</span></span>
      <span class="kc-desc">${esc(c.desc)}</span></button>`).join('');
  return `<section class="kind-sec" aria-labelledby="kindh"><h2 id="kindh" class="kind-h">What are you sharing?</h2>
    <div class="kind-cards" role="radiogroup" aria-labelledby="kindh">${cards}</div>
    <input data-key="kind" data-kind="enum" type="hidden" value="${cur}" /></section>`;
}

/**
 * The tick list's rows: every tool, the ones with standard steps first (in file order), each with its note and whether
 * it is ticked. A ticked target the list does not know (a tool since removed) is kept as its own row, so an edit never
 * drops it silently.
 */
export function madeForRows({ allTools = [], stepKeys = [], targets = [] } = {}) {
  const withSteps = new Set(stepKeys);
  const on = new Set(targets);
  const known = allTools.filter((t) => t && t.label);
  const rows = [...known.filter((t) => withSteps.has(t.key)), ...known.filter((t) => !withSteps.has(t.key))]
    .map((t) => ({ label: t.label, note: withSteps.has(t.key) ? 'Standard steps' : 'No standard steps yet', on: on.has(t.label) }));
  const labels = new Set(rows.map((r) => r.label));
  for (const t of targets) if (!labels.has(t)) rows.push({ label: t, note: 'Not in the tool list', on: true });
  return rows;
}

/** A target list with one label switched on or off, keeping the order the author built it in. */
export function toggleTarget(targets, label) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  return list.includes(label) ? list.filter((t) => t !== label) : [...list, label];
}

export const madeForButtonsHtml = (rows) => rows.map((r) => `<button type="button" class="mf-tool${r.on ? ' on' : ''}" aria-pressed="${r.on}" data-mf-tool="${esc(r.label)}">
    <span class="mf-box">${svg(ICON.check, 12, 3.4)}</span><span class="mf-txt"><span class="mf-name">${esc(r.label)}</span><span class="mf-note">${esc(r.note)}</span></span></button>`).join('');

/** The skill-only blocks, above the page text: the install note, Made for, and the skill file. Hidden for a prompt. */
export function skillSectionsHtml({ kind, skillFile = '' } = {}) {
  const hide = normalizeKind(kind) === 'skill' ? '' : ' hidden';
  return `<div class="skill-note" data-skill-only${hide}><span class="sn-ico">${svg(ICON.install, 17)}</span><div><b>No install steps needed</b>
      <span class="sn-text">Your skill page shows the standard install steps for every tool you tick below, and readers pick theirs. Write about what your skill does, not how to install it.</span></div></div>
    <section class="mf-sec" aria-labelledby="mfh" data-skill-only${hide}><h2 id="mfh" class="kind-h">Made for</h2>
      <p class="mf-sub">Tick every tool your skill works in. Readers get the install steps for the one they use.</p>
      <div class="mf-tools" role="group" aria-labelledby="mfh" data-mf-tools><span class="mf-wait">Loading the tool list…</span></div>
      <p class="mf-foot">Not listed? Explain installation for it in Commands and usage, and ask an admin to add its standard steps.</p></section>
    <section class="sf-sec" data-skill-only${hide}><label for="skillfile" class="kind-h">The skill file (SKILL.md)</label>
      <p class="mf-sub">Paste the whole file. Readers copy or download exactly this.</p>
      <textarea id="skillfile" class="sf-text" rows="12" spellcheck="false" placeholder="---&#10;name: my-skill&#10;description: What it does and when to use it.&#10;---">${esc(skillFile)}</textarea></section>`;
}

/** The skill file to publish or save: the text area's value for a skill, nothing for a prompt. */
export function skillFileFrom(root) {
  const kind = root.querySelector('input[data-key="kind"]')?.value;
  if (normalizeKind(kind) !== 'skill') return undefined;
  const ta = root.querySelector('#skillfile');
  return ta ? ta.value : undefined;
}

/** Where the public tool list is read from: this site when the editor runs on one, else gbti.network. */
export function siteFor(loc = globalThis.location) {
  return loc && /^https?:$/.test(loc.protocol || '') && /(^|\.)gbti\.network$/.test(loc.hostname || '') ? loc.origin : SITE_ORIGIN;
}

let toolsCache = null;
async function loadTools(fetchImpl, site) {
  if (!toolsCache) {
    toolsCache = (async () => {
      const res = await fetchImpl(`${site}/skill-install.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      return { allTools: Array.isArray(j?.allTools) ? j.allTools : [], stepKeys: (Array.isArray(j?.tools) ? j.tools : []).map((t) => t.key) };
    })().catch((e) => { toolsCache = null; throw e; });
  }
  return toolsCache;
}
export const _resetEditorTools = () => { toolsCache = null; };

/**
 * Wire the choice and the tick list in one editor's shadow root. `ed` is the editor element (for $, $$ and
 * _markDirty); the rail's targets field is hidden for a skill, because the tick list writes the same input.
 */
export function wireSkillEditor(ed, { fetchImpl = globalThis.fetch, site = siteFor() } = {}) {
  const root = ed.root;
  const q = (s) => root.querySelector(s);
  const targetsInput = () => q('input[data-key="targets"]');
  const targetsNow = () => String(targetsInput()?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
  let toolsLoaded = false;
  const railTargets = () => q('.fld[data-fkey="targets"]');

  // The rail's chips mirror the list, so switching back to Prompt shows what the tick list chose.
  const syncChips = (list) => {
    const box = q('[data-chips="targets"]');
    if (!box) return;
    box.querySelectorAll('.chip2').forEach((c) => c.remove());
    const inp = box.querySelector('input');
    for (const label of list) {
      const chip = root.ownerDocument.createElement('span');
      chip.className = 'chip2';
      chip.innerHTML = `${esc(label)}<span class="x" data-rm><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></span>`;
      box.insertBefore(chip, inp);
    }
  };
  const fillTools = async () => {
    const box = q('[data-mf-tools]');
    if (!box) return;
    try {
      const { allTools, stepKeys } = await loadTools(fetchImpl, site);
      box.innerHTML = madeForButtonsHtml(madeForRows({ allTools, stepKeys, targets: targetsNow() }));
      toolsLoaded = true;
    } catch {
      // Without the list the rail's own field still works, so it stays in view and this says where to look.
      box.innerHTML = '<span class="mf-wait">The tool list could not load. Add the tools under Works with in the Details panel.</span>';
      toolsLoaded = false;
    }
    apply(normalizeKind(q('input[data-key="kind"]')?.value));
  };
  const apply = (kind) => {
    const skill = kind === 'skill';
    root.querySelectorAll('[data-skill-only]').forEach((el) => { el.hidden = !skill; });
    root.querySelectorAll('[data-kind-pick]').forEach((b) => {
      const on = b.dataset.kindPick === kind;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const h = mainHeading(kind);
    const t = q('[data-main-title]'); if (t) t.textContent = h.title;
    const s = q('[data-main-sub]'); if (s) s.textContent = h.sub;
    const o = q('[data-main-opt]'); if (o) o.hidden = !h.optional;
    const pw = q('[data-publish-kind]'); if (pw) pw.textContent = kind;
    const rail = railTargets(); if (rail) rail.hidden = skill && toolsLoaded;
  };

  root.querySelectorAll('[data-kind-pick]').forEach((b) => b.addEventListener('click', () => {
    const kind = normalizeKind(b.dataset.kindPick);
    const input = q('input[data-key="kind"]');
    if (input && input.value !== kind) { input.value = kind; ed._markDirty?.(); }
    apply(kind);
  }));
  q('[data-mf-tools]')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mf-tool]');
    if (!btn) return;
    const next = toggleTarget(targetsNow(), btn.dataset.mfTool);
    const inp = targetsInput(); if (inp) inp.value = next.join(', ');
    const on = next.includes(btn.dataset.mfTool);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    syncChips(next);
    ed._markDirty?.();
  });
  apply(normalizeKind(q('input[data-key="kind"]')?.value));
  return fillTools();
}

/** The styles for the blocks above, on the editor's --s-* palette plus the shared prompt and skill colours. */
export const SKILL_EDITOR_CSS = `
  :host { ${skillTokenDecls('light')} }
  :host-context([data-theme="dark"]) { ${skillTokenDecls('dark')} }
  .kind-sec, .mf-sec, .sf-sec { margin-top:18px; display:flex; flex-direction:column; gap:10px; }
  .kind-h { margin:0; font-size:15px; font-weight:700; color:var(--s-fg); letter-spacing:normal; text-transform:none; font-family:inherit; }
  .kind-cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
  @media (max-width:560px) { .kind-cards { grid-template-columns:1fr; } }
  button.kind-card { display:flex; flex-direction:column; align-items:stretch; gap:8px; padding:14px 16px; border:2px solid var(--s-line-2); border-radius:12px; background:var(--s-surface); color:var(--s-fg); font:inherit; text-align:left; cursor:pointer; width:auto; }
  button.kind-card:hover { border-color:var(--skill-box-line); background:var(--s-surface); }
  button.kind-card.on { border-color:var(--skill-box-accent); background:var(--skill-box-bg); }
  .kc-top { display:flex; align-items:center; gap:10px; }
  .kc-ico { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .kc-prompt { background:var(--kind-prompt-bg); color:var(--kind-prompt-fg); }
  .kc-skill { background:var(--kind-skill-bg); color:var(--kind-skill-fg); }
  .kc-name { flex:1; font-weight:700; font-size:17px; }
  .kc-check { width:22px; height:22px; border-radius:50%; background:var(--skill-box-accent); color:var(--skill-box-on-accent); display:flex; align-items:center; justify-content:center; visibility:hidden; }
  .kind-card.on .kc-check { visibility:visible; }
  .kc-desc { font-size:13.5px; line-height:1.5; color:var(--s-fg-soft); }
  .skill-note { margin-top:16px; display:flex; gap:12px; align-items:flex-start; padding:14px 16px; border:1px solid var(--skill-box-line); border-radius:12px; background:var(--skill-box-bg); }
  .skill-note b { display:block; font-size:14.5px; margin-bottom:2px; color:var(--s-fg); }
  .sn-text { font-size:13.5px; line-height:1.55; color:var(--skill-box-mute); }
  .sn-ico { width:30px; height:30px; flex-shrink:0; border-radius:8px; background:var(--skill-box-accent); color:var(--skill-box-on-accent); display:flex; align-items:center; justify-content:center; }
  .mf-sub, .mf-foot { margin:0; font-size:13.5px; line-height:1.5; color:var(--s-fg-mute); }
  .mf-tools { display:flex; gap:8px; flex-wrap:wrap; }
  .mf-wait { font-size:13.5px; color:var(--s-fg-mute); }
  button.mf-tool { display:flex; align-items:center; gap:10px; padding:8px 12px; border:1.5px solid var(--s-line-2); border-radius:10px; background:var(--s-surface); color:var(--s-fg); font:inherit; cursor:pointer; width:auto; }
  button.mf-tool:hover { border-color:var(--skill-box-line); background:var(--s-surface); }
  button.mf-tool.on { border-color:var(--skill-box-accent); background:var(--skill-box-bg); }
  .mf-box { width:18px; height:18px; flex-shrink:0; box-sizing:border-box; border-radius:5px; border:1.5px solid var(--s-fg-mute); color:transparent; display:flex; align-items:center; justify-content:center; }
  .mf-tool.on .mf-box { background:var(--skill-box-accent); border-color:var(--skill-box-accent); color:var(--skill-box-on-accent); }
  .mf-txt { display:flex; flex-direction:column; text-align:left; }
  .mf-name { font-size:14px; font-weight:700; }
  .mf-note { font-size:12px; color:var(--s-fg-mute); }
  .sf-text { box-sizing:border-box; width:100%; min-height:220px; padding:12px 14px; border:1px solid var(--s-line-2); border-radius:8px; background:var(--s-surface-2); color:var(--s-fg); font-family:var(--font-mono,ui-monospace,monospace); font-size:13px; line-height:1.6; resize:vertical; }
  .sf-text:focus { outline:none; border-color:var(--skill-box-accent); }
  .dsub-opt { font-size:11px; font-weight:600; letter-spacing:.04em; text-transform:none; color:var(--s-fg-mute); border:1px solid var(--s-line-2); border-radius:999px; padding:1px 8px; }
  [data-skill-only][hidden], [data-main-opt][hidden] { display:none !important; }
`;
