// <gbti-skill-install-manager> (sow-109 Phase 6): Admin tools > Skill install, SUPERADMIN only. The install steps a
// skill page shows for each tool a skill can be made for (house/skill-install.yml), and adding a tool to the list
// (house/ai-tools.yml). Laid out from the approved canvas (the AdminInstallBox board): the tools down the left, the
// chosen tool's steps and a live preview on the right.
//
// THREE FIELDS, NOT ONE MARKDOWN BOX. The canvas drew a free-form box; the approved plan settled on the three fields
// the file actually holds (the folder, how to run it, the one-project note), because steps 1 and 2 are the same for
// every tool and a free-form box would let one tool's page drift from the others'. The preview is the website's own
// install box (src/lib/skill-page.mjs), so what a superadmin sees here is what a reader gets.
//
// Loads on the client's arrival, never from connectedCallback, and a failed load waits for Try again instead of
// retrying on its own (the client-ready race, sow-334). Host-agnostic: every host supplies skillInstallPool,
// setSkillInstallSteps and addSkillInstallTool.
import { GbtiElement, define, esc } from '../base.mjs';
import { houseEditAck } from '../workspace-core.mjs';
import { installTabsFromTools } from '../../../membership/skill-install.mjs';
import { buildSkillInstallHtml } from '../../../src/lib/skill-page.mjs';
import { SKILL_READER_CSS } from '../skill-reader.mjs';
import { toolKeyFor, SKILL_STEP_LIMITS } from '../../../membership/skill-install-edits.mjs';

const PREVIEW_NAME = 'farley';
const NEW = '__new__';
const blank = () => ({ label: '', folder: '', run: '', local: '' });

const CSS = `
  :host { display:block; }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .msg.err { color:var(--danger); }
  .busy { opacity:.55; pointer-events:none; }
  .muted { color:var(--muted); }
  .lede { font-size:13px; color:var(--muted); margin:0 0 14px; line-height:1.55; }
  .lede code, .f .note code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .grid { display:grid; grid-template-columns:minmax(170px, 230px) minmax(0, 1fr); gap:18px; align-items:start; }
  @media (max-width: 760px) { .grid { grid-template-columns:1fr; } }
  .list { display:flex; flex-direction:column; gap:4px; border-right:1px solid var(--line); padding-right:14px; }
  @media (max-width: 760px) { .list { border-right:0; padding-right:0; } }
  button.tool { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:8px 10px; border:1px solid transparent;
    border-radius:8px; background:transparent; color:var(--fg); font:inherit; cursor:pointer; }
  button.tool:hover { background:transparent; border-color:var(--line); }
  button.tool.on { border-color:var(--accent); background:transparent; }
  .tl { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
  .tn { font-size:14px; font-weight:700; }
  .ts { font-size:12px; color:var(--muted); }
  button.add { margin-top:6px; padding:8px 10px; border:1px dashed var(--line); border-radius:8px; background:transparent;
    color:var(--fg); font:inherit; font-size:13px; font-weight:700; cursor:pointer; }
  button.add:hover, button.add.on { background:transparent; border-color:var(--accent); color:var(--accent); }
  .pane { min-width:0; }
  .cols { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:18px; align-items:start; }
  @media (max-width: 1000px) { .cols { grid-template-columns:1fr; } }
  .f { margin:0 0 12px; }
  .f label { display:block; font-size:12.5px; font-weight:600; color:var(--fg); margin:0 0 5px; }
  .f input { display:block; width:100%; box-sizing:border-box; font:inherit; font-size:13.5px; color:var(--fg);
    background:var(--paper, transparent); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
  .f input.code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
  .f input[readonly] { color:var(--muted); }
  .f .note { display:block; font-size:12px; color:var(--muted); margin-top:5px; line-height:1.45; }
  .pv-h { font-size:12.5px; font-weight:600; color:var(--fg); margin:0 0 6px; }
  .pv { pointer-events:none; }
  .pv .skill-install { margin:0; }
  .none { border:1px dashed var(--line); border-radius:10px; padding:14px 16px; }
  .none b { display:block; font-size:14px; margin:0 0 4px; color:var(--fg); }
  .none span { font-size:13px; color:var(--muted); line-height:1.55; }
  .acts { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:6px; }
  button.save, button.lk { font:inherit; font-size:13px; font-weight:600; border-radius:8px; padding:7px 14px; cursor:pointer; }
  .save { border:1px solid var(--accent); background:var(--accent); color:var(--paper, #fff); }
  .save:hover { background:var(--accent); filter:brightness(1.08); }
  .save[disabled] { cursor:default; opacity:.5; filter:none; }
  .lk { border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); }
  .lk:hover { background:var(--paper, transparent); border-color:var(--accent); color:var(--accent); }
  .lk.rm:hover { border-color:var(--danger); color:var(--danger); }
  .hint { font-size:12.5px; color:var(--muted); margin:0; line-height:1.5; }
  [hidden] { display:none !important; } /* an explicit display beats the UA [hidden] rule inside a shadow root */
`;

class GbtiSkillInstallManager extends GbtiElement {
  constructor() {
    super();
    this._status = 'idle'; // idle | loading | failed | ready
    this._tools = [];      // [{ key, label, steps }] as last read
    this._sel = null;      // a tool key, or NEW
    this._draft = blank(); // what is in the boxes right now
  }

  /** Typing is not saved anywhere, so a client re-render must not rebuild the boxes under a cursor. */
  skipClientRender() { return this._status === 'ready' && this._dirty(); }

  _savedFor(key) {
    const t = this._tools.find((x) => x.key === key);
    return t ? { label: t.label, folder: t.steps?.folder || '', run: t.steps?.run || '', local: t.steps?.local || '' } : blank();
  }

  _dirty() {
    if (this._sel === NEW) return Object.values(this._draft).some((v) => v.trim());
    return JSON.stringify(this._draft) !== JSON.stringify(this._savedFor(this._sel));
  }

  _pick(key) {
    this._sel = key;
    this._draft = key === NEW ? blank() : this._savedFor(key);
    this._msg = '';
  }

  async load() {
    if (!this.client) { this.render(); return; }
    this._status = 'loading';
    this.render();
    try {
      const r = await this.client.skillInstallPool();
      this._tools = Array.isArray(r?.tools) ? r.tools : [];
      // Open on the chosen tool if it still exists, else the first one with steps, else the first one.
      const keep = this._tools.some((t) => t.key === this._sel) ? this._sel : (this._tools.find((t) => t.steps) || this._tools[0])?.key;
      this._pick(keep ?? NEW);
      this._status = 'ready';
    } catch (e) {
      this._status = 'failed';
      this._loadError = e?.message || 'The install steps could not be read.';
    }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + '<p class="muted">Open in the GBTI client (superadmin) to manage the install steps.</p>'); return; }
    if (this._status === 'idle') { this.load(); this.set(this.css(CSS) + '<p class="muted">Loading the install steps...</p>'); return; }
    if (this._status === 'loading') { this.set(this.css(CSS) + '<p class="muted">Loading the install steps...</p>'); return; }
    if (this._status === 'failed') {
      this.set(this.css(CSS) + `<p class="msg err">${esc(this._loadError)}</p><div class="acts"><button class="lk" type="button" data-retry>Try again</button></div>`);
      this.$('[data-retry]')?.addEventListener('click', () => { this._status = 'idle'; this.render(); });
      return;
    }
    const isNew = this._sel === NEW;
    const tools = this._tools.map((t) => `<button type="button" class="tool${t.key === this._sel ? ' on' : ''}" aria-pressed="${t.key === this._sel}" data-tool="${esc(t.key)}">
        <span class="tl"><span class="tn">${esc(t.label)}</span><span class="ts">${t.steps ? '3 steps' : 'No steps yet'}</span></span></button>`).join('');
    const saved = isNew ? null : this._tools.find((t) => t.key === this._sel);
    const name = isNew ? (this._draft.label.trim() || 'the new tool') : saved?.label || '';
    this.set(this.css(SKILL_READER_CSS + CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <p class="lede">The install steps for each tool a skill can be made for. An author ticks the tools their skill works with; a reader picks theirs and gets these steps. Write <code>{name}</code> where the skill's folder name goes. Superadmin only.</p>
      ${this._msg ? `<p class="msg${this._msgErr ? ' err' : ''}" role="status">${esc(this._msg)}</p>` : ''}
      <div class="grid">
        <nav class="list" aria-label="Tools">${tools}<button type="button" class="add${isNew ? ' on' : ''}" data-add>+ Add a tool</button></nav>
        <div class="pane">
          <div class="cols">
            <div>
              <div class="f"><label for="si-label">Tool name</label>
                <input id="si-label" data-k="label" type="text" maxlength="${SKILL_STEP_LIMITS.label}" value="${esc(this._draft.label)}"${isNew ? ' placeholder="Gemini CLI"' : ' readonly'} />
                <span class="note">${isNew ? `Filed as <code>${esc(toolKeyFor(this._draft.label) || 'tool-name')}</code>. Authors and readers see the name exactly as written, and it cannot be renamed here once added.` : 'Authors tick this name, and readers see it on the tabs. It is stored in every skill made for it, so it cannot be renamed here.'}</span></div>
              <div class="f"><label for="si-folder">Folder</label>
                <input id="si-folder" class="code" data-k="folder" type="text" maxlength="${SKILL_STEP_LIMITS.folder}" value="${esc(this._draft.folder)}" placeholder="~/.agents/skills/{name}" />
                <span class="note">Step 1 makes this folder. It must contain <code>{name}</code>.</span></div>
              <div class="f"><label for="si-run">How to run it</label>
                <input id="si-run" data-k="run" type="text" maxlength="${SKILL_STEP_LIMITS.run}" value="${esc(this._draft.run)}" placeholder="Start a new session and type \`/{name}\`." />
                <span class="note">Step 3. Put a command in \`backticks\` to show it as code.</span></div>
              <div class="f"><label for="si-local">Only in one project <span class="muted">(optional)</span></label>
                <input id="si-local" data-k="local" type="text" maxlength="${SKILL_STEP_LIMITS.local}" value="${esc(this._draft.local)}" placeholder="Only want it in one project? Use \`.agents/skills/{name}/\` inside it instead." />
                <span class="note">Shown under the steps.</span></div>
            </div>
            <div>
              <p class="pv-h">Preview, as /${PREVIEW_NAME}</p>
              <div data-preview>${this._previewHtml(name)}</div>
            </div>
          </div>
          <div class="acts">
            <button class="save" type="button" data-save${this._dirty() ? '' : ' disabled'}>${isNew ? `Add ${esc(name)}` : `Save ${esc(name)} steps`}</button>
            ${!isNew && saved?.steps ? '<button class="lk rm" type="button" data-clear>Remove its steps</button>' : ''}
            <p class="hint">Each save opens a pull request that merges on its own. Skill pages show the change after the next site deploy.</p>
          </div>
        </div>
      </div></div>`);
    this.$$('[data-tool]').forEach((b) => b.addEventListener('click', () => { this._pick(b.dataset.tool); this.render(); }));
    this.$('[data-add]')?.addEventListener('click', () => { this._pick(NEW); this.render(); });
    this.$$('[data-k]').forEach((el) => el.addEventListener('input', () => {
      this._draft[el.dataset.k] = el.value;
      // Update in place, so the field keeps the cursor: the preview, the Save state and the new tool's filed key.
      const pv = this.$('[data-preview]');
      const nm = this._sel === NEW ? (this._draft.label.trim() || 'the new tool') : name;
      if (pv) pv.innerHTML = this._previewHtml(nm);
      const save = this.$('[data-save]');
      if (save) { save.disabled = !this._dirty(); if (this._sel === NEW) save.textContent = `Add ${nm}`; }
      if (el.dataset.k === 'label') { const code = el.parentElement?.querySelector('.note code'); if (code) code.textContent = toolKeyFor(el.value) || 'tool-name'; }
    }));
    this.$('[data-save]')?.addEventListener('click', () => this._save());
    this.$('[data-clear]')?.addEventListener('click', () => this._clear());
  }

  /** The website's own install box for this tool, or the no-steps card when the fields are not filled in yet. */
  _previewHtml(name) {
    const d = this._draft;
    const key = this._sel === NEW ? (toolKeyFor(d.label) || 'new-tool') : this._sel;
    const label = this._sel === NEW ? (d.label.trim() || 'New tool') : name;
    const { tabs } = installTabsFromTools({ tools: [{ key, label, folder: d.folder, run: d.run, local: d.local }], targets: [label], name: PREVIEW_NAME });
    const box = tabs.length && d.folder.includes('{name}') ? buildSkillInstallHtml({ tabs }) : '';
    if (box) return `<div class="pv" inert>${box}</div>`;
    return `<div class="none"><b>No standard steps for ${esc(label)} yet</b><span>A skill made for ${esc(label)} still lists it. Its page shows the author's own Commands and usage text in place of the install box until steps are added here.</span></div>`;
  }

  async _save() {
    if (!this._dirty()) return;
    const d = this._draft;
    const isNew = this._sel === NEW;
    const call = isNew
      ? () => this.client.addSkillInstallTool({ label: d.label, folder: d.folder, run: d.run, local: d.local })
      : () => this.client.setSkillInstallSteps({ key: this._sel, folder: d.folder, run: d.run, local: d.local });
    await this._run(call, isNew ? toolKeyFor(d.label) : this._sel);
  }

  async _clear() {
    const label = this._tools.find((t) => t.key === this._sel)?.label || this._sel;
    if (typeof confirm === 'function' && !confirm(`Remove the ${label} steps? Skills made for ${label} show their author's own text instead.`)) return;
    await this._run(() => this.client.setSkillInstallSteps({ key: this._sel, clear: true }), this._sel, { cleared: true });
  }

  async _run(call, key, { cleared = false } = {}) {
    this._busy = true; this._msg = ''; this._msgErr = false; this.render();
    try {
      const r = await call();
      this._msg = r?.noop ? 'No change (those are already its steps).' : (r?.prNumber ? houseEditAck(r) : 'Submitted.');
      // The list reflects the save straight away; the site itself follows once the pull request merges and deploys.
      const d = this._draft;
      const steps = cleared ? null : { folder: d.folder.trim(), run: d.run.trim(), local: d.local.trim() };
      const existing = this._tools.find((t) => t.key === key);
      if (existing) existing.steps = steps;
      else this._tools.push({ key, label: d.label.trim(), steps: d.folder.trim() ? steps : null });
      this._sel = key;
      this._draft = this._savedFor(key);
    } catch (e) {
      this._msg = e?.message || 'That change could not be saved.';
      this._msgErr = true;
    }
    this._busy = false;
    this.render();
  }
}

define('gbti-skill-install-manager', GbtiSkillInstallManager);
