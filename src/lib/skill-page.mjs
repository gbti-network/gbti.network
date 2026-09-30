/**
 * sow-109: the parts of a prompt page that only a SKILL has. The install box (one tab per tool the skill is made
 * for, with that tool's steps) and the skill file itself (collapsed, with Copy).
 *
 * Built here as strings rather than written into prompts/[slug].astro for the same reason prompt-page.mjs exists:
 * the workbench preview shows a draft skill with the same box, and two copies of this markup would drift. The
 * steps come from membership/skill-install.mjs (installTabsFor), so this file only lays them out.
 *
 * Everything interpolated is escaped. The steps are admin-written (house/skill-install.yml), the skill's name is
 * already held to SKILL_NAME_RE, and the file text is the author's, so none of it is trusted as markup.
 */

import { PROMPT_SHELL } from './prompt-page.mjs';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The classes the skill parts of the page use, named once so the page, the preview and the stylesheet agree. */
export const SKILL_SHELL = Object.freeze({
  install: 'skill-install',
  installHead: 'skill-install-head',
  toolsRow: 'skill-tools-row',
  tools: 'skill-tools',
  panel: 'skill-panel',
  steps: 'skill-steps',
  cmd: 'skill-cmd',
  note: 'skill-note',
  local: 'skill-local',
  notes: 'skill-notes',
  file: 'skill-file',
  fileBody: 'skill-file-body',
});

/** Where the reader's chosen tool is remembered, so every skill page opens on the tool they use. */
export const SKILL_TOOL_KEY = 'gbti-skill-tool';

// Drawn inline rather than from the site's icon sprite, because the extension reader renders this box inside a shadow
// root that cannot see the page's sprite. The skill mark is the same shape as IconSprite's ico-kind-skill.
const ICON_PATHS = {
  'ico-kind-skill': '<path d="M4 17l6-5-6-5M12 19h8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  'ico-copy': '<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  'ico-download': '<path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
};
const icon = (id, size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICON_PATHS[id]}</svg>`;
const runsHtml = (runs) => (runs || []).map((r) => (r.code ? `<code>${esc(r.text)}</code>` : esc(r.text))).join('');
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Codex reads this folder too", when another tab installs to the same folder, so a reader does not copy twice. */
export function sharedFolderNote(tab, tabs) {
  const others = (tabs || []).filter((t) => t !== tab && t.folder === tab.folder).map((t) => t.label);
  if (!others.length) return '';
  if (others.length === 1) return `${others[0]} reads this folder too, so one copy serves both.`;
  return `${andList(others)} read this folder too, so one copy serves them all.`;
}

/** The line under the box naming the tools the skill is made for that have no steps on file yet. */
export function withoutNote(without) {
  const xs = (without || []).filter(Boolean);
  if (!xs.length) return '';
  return `Also made for ${andList(xs)}. ${xs.length === 1 ? 'Its' : 'Their'} install steps are not listed here yet, so follow the author's notes below.`;
}

/**
 * The install box. Returns '' when there is no tab at all: a skill made only for tools with no steps on file shows
 * the author's own text instead, which is where their instructions are.
 *
 * @param {object} args
 * @param {Array<{key:string,label:string,folder:string,mkdir:string,run:Array,local:Array}>} args.tabs from installTabsFor
 * @param {string[]} [args.without] targets with no steps, from installTabsFor
 * @param {string} [args.fileHref] where the skill file can be downloaded; no Download link without one
 */
export function buildSkillInstallHtml({ tabs = [], without = [], fileHref = '' } = {}) {
  if (!tabs.length) return '';
  const s = SKILL_SHELL;
  const many = tabs.length > 1;
  const tabId = (t) => `skill-tab-${t.key}`;
  const panelId = (t) => `skill-panel-${t.key}`;

  const chooser = many
    ? `<div class="${s.toolsRow}"><span id="skill-tools-l" class="skill-tools-label">Your tool</span>`
      + `<div class="${s.tools}" role="tablist" aria-labelledby="skill-tools-l">`
      + tabs.map((t, i) => `<button type="button" role="tab" id="${tabId(t)}" aria-controls="${panelId(t)}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-skill-tool="${esc(t.key)}">${esc(t.label)}</button>`).join('')
      + `</div></div>`
    : `<p class="skill-tools-label">For ${esc(tabs[0].label)}</p>`;

  const download = fileHref
    ? `<a class="skill-btn" href="${esc(fileHref)}" download="SKILL.md">${icon('ico-download', 16)}<span>Download SKILL.md</span></a>`
    : '';

  const panels = tabs.map((t, i) => {
    const shared = sharedFolderNote(t, tabs);
    const local = runsHtml(t.local);
    return `<div class="${s.panel}" id="${panelId(t)}" data-skill-panel="${esc(t.key)}"`
      + (many ? ` role="tabpanel" aria-labelledby="${tabId(t)}"` : '')
      + (i === 0 ? '' : ' hidden') + `>`
      + `<ol class="${s.steps}">`
      + `<li><span class="skill-step-n" aria-hidden="true">1</span><div class="skill-step">`
      + `<p class="skill-step-t">Make the skill's folder.</p>`
      + `<div class="${s.cmd}"><code>${esc(t.mkdir)}</code>`
      + `<button type="button" class="skill-btn skill-btn-sm" data-skill-copy-text="${esc(t.mkdir)}">${icon('ico-copy', 14)}<span data-label>Copy</span></button></div>`
      + (shared ? `<p class="${s.note}">${esc(shared)}</p>` : '')
      + `</div></li>`
      + `<li><span class="skill-step-n" aria-hidden="true">2</span><div class="skill-step">`
      + `<p class="skill-step-t">Save the skill file into it as <code>SKILL.md</code>.</p>`
      + `<div class="skill-file-btns">`
      + `<button type="button" class="skill-btn skill-btn-primary" data-skill-copy-file>${icon('ico-copy', 16)}<span data-label>Copy SKILL.md</span></button>`
      + download
      + `</div></div></li>`
      + `<li><span class="skill-step-n" aria-hidden="true">3</span><div class="skill-step">`
      + `<p class="skill-step-t">${runsHtml(t.run)}</p>`
      + `</div></li>`
      + `</ol>`
      + (local ? `<p class="${s.local}">${local}</p>` : '')
      + `</div>`;
  }).join('');

  const also = withoutNote(without);
  return `<section class="${s.install}" data-skill-install aria-labelledby="skill-install-h">`
    + `<div class="${s.installHead}"><span class="skill-install-ico">${icon('ico-kind-skill', 22)}</span>`
    + `<h2 id="skill-install-h">Install this skill</h2></div>`
    + chooser
    + panels
    + (also ? `<p class="${s.note} skill-without">${esc(also)}</p>` : '')
    + `</section>`;
}

/**
 * The skill file under the author's text: the prompt block's chrome, labelled SKILL.md, collapsed until the reader
 * asks for the whole file. The <pre> is also what every Copy SKILL.md button on the page copies.
 */
export function buildSkillFileHtml({ text = '' } = {}) {
  const p = PROMPT_SHELL;
  const s = SKILL_SHELL;
  return `<section class="${s.file}" data-skill-file data-open="false" aria-labelledby="skill-file-h">`
    + `<h2 id="skill-file-h" class="skill-file-h">The skill file</h2>`
    + `<div class="${p.block}">`
    + `<div class="${p.blockBar}">`
    + `<span class="${p.blockLabel}">${icon('ico-kind-skill', 15)}SKILL.md</span>`
    + `<div class="${p.blockActions}">`
    + `<button type="button" class="skill-file-toggle" data-skill-file-toggle aria-expanded="false">Show the whole file</button>`
    + `<button type="button" class="btn btn-primary prompt-copy" data-skill-copy-file><span data-label>Copy</span></button>`
    + `</div></div>`
    + `<div class="${s.fileBody}"><pre class="prompt-raw" data-skill-raw>${esc(text)}</pre></div>`
    + `</div></section>`;
}

/**
 * Wires the skill parts of a page: the tool tabs (remembered per browser), every Copy, and the file's
 * show-the-whole-file toggle. Safe to call on a page without them.
 */
export function wireSkillPage(root = document, storage = globalThis.localStorage) {
  const box = root.querySelector('[data-skill-install]');
  if (box) {
    const tabs = Array.from(box.querySelectorAll('[data-skill-tool]'));
    const panels = Array.from(box.querySelectorAll('[data-skill-panel]'));
    const pick = (key, remember) => {
      if (!panels.some((p) => p.dataset.skillPanel === key)) return false;
      tabs.forEach((t) => {
        const on = t.dataset.skillTool === key;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      panels.forEach((p) => { p.hidden = p.dataset.skillPanel !== key; });
      if (remember) { try { storage?.setItem(SKILL_TOOL_KEY, key); } catch { /* storage blocked: the choice lasts this visit */ } }
      return true;
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => pick(t.dataset.skillTool, true));
      t.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = tabs[(i + step + tabs.length) % tabs.length];
        pick(next.dataset.skillTool, true);
        next.focus();
      });
    });
    let saved = null;
    try { saved = storage?.getItem(SKILL_TOOL_KEY) ?? null; } catch { saved = null; }
    if (saved) pick(saved, false);
  }

  const copy = async (btn, text) => {
    const label = btn.querySelector('[data-label]') || btn;
    const was = label.textContent;
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = 'Copied';
    } catch {
      label.textContent = 'Copy failed';
    }
    setTimeout(() => { label.textContent = was; }, 1500);
  };
  const raw = root.querySelector('[data-skill-raw]');
  root.querySelectorAll('[data-skill-copy-text]').forEach((b) => b.addEventListener('click', () => copy(b, b.getAttribute('data-skill-copy-text') || '')));
  root.querySelectorAll('[data-skill-copy-file]').forEach((b) => b.addEventListener('click', () => copy(b, raw?.textContent ?? '')));

  const file = root.querySelector('[data-skill-file]');
  const toggle = file?.querySelector('[data-skill-file-toggle]');
  toggle?.addEventListener('click', () => {
    const open = file.dataset.open !== 'true';
    file.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Show less' : 'Show the whole file';
  });
}
