// <gbti-content-editor> (SOW-006 v2): the per-type authoring form. Renders the field descriptors from
// client.formFields(type), a markdown body with a live preview (client.preview), image staging
// (client.stageImage), validation (client.validateContent), and publish (client.publish). The same component
// powers the standalone CMS (in <gbti-app>) and is reused by the inline editor. All typing/gathering uses the
// pure form.mjs helpers, so the only DOM concern here is reading raw values + rendering.

import { GbtiElement, define, esc } from '../base.mjs';
import { gatherInput } from '../form.mjs';

const TYPES = ['post', 'product', 'prompt', 'profile'];

class GbtiContentEditor extends GbtiElement {
  constructor() {
    super();
    this.type = this.getAttribute('type') || 'post';
    this.fields = [];
    this.preset = null; // { input, body } when editing an existing item
  }

  /** Seed the editor from an existing item (used by the inline editor + "edit" from My Content). */
  load(type, input, body) {
    this.type = type || this.type;
    this.preset = { input: input || {}, body: body || '' };
    if (this.isConnected) this.render();
  }

  async render() {
    if (!this.client) return;
    try {
      const res = await this.client.formFields({ type: this.type });
      this.fields = res?.fields ?? [];
    } catch {
      this.fields = [];
    }
    // SOW-011: surface the membership status so a trial member sees a "membership required to publish" notice
    // up front (the publish action is still gated server-side; this is the proactive UX). 'unknown' (oracle
    // unreachable) shows no notice and does not block, matching the fail-open publish gate.
    let membership = 'unknown';
    try {
      membership = (await this.client.status())?.membership ?? 'unknown';
    } catch {
      membership = 'unknown';
    }
    const blocked = membership !== 'paid' && membership !== 'unknown';
    const p = this.preset?.input ?? {};
    this.set(
      this.css(`
        .grid { display: grid; gap: 2px; }
        .actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
        #out { margin-top:12px; }
        .preview { background:#201e26; border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
        .notice { background:#2a2330; border:1px solid var(--accent); border-radius:8px; padding:10px 14px; margin-bottom:12px; }
        .notice a { color: var(--accent); }
      `) +
        `<div class="panel">
           <h2>Author</h2>
           ${blocked ? `<div class="notice">Publishing requires a paid membership. You can write and stage your work now; it stays on your fork until you upgrade. <a href="https://gbti.network" target="_blank" rel="noopener">Upgrade to publish</a>.</div>` : ''}
           <label>Type</label>
           <select id="type">${TYPES.map((t) => `<option ${t === this.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
           <div class="grid" id="fields">${this.fields.map((f) => this.fieldHtml(f, p[f.key], this.fieldVisible(f, (k) => this.presetStr(p[k])))).join('')}</div>
           <label>Body (Markdown)</label>
           <textarea id="body">${esc(this.preset?.body ?? '')}</textarea>
           <div class="actions">
             <button id="preview" class="ghost">Preview</button>
             <button id="validate" class="ghost">Validate</button>
             <button id="publish"${blocked ? ' title="Publishing requires a paid membership"' : ''}>${blocked ? 'Membership required to publish' : 'Publish (open PR)'}</button>
             <input type="file" id="img" accept="image/*" style="display:none" />
             <button id="imgbtn" class="ghost">Add image</button>
           </div>
           <div id="out" class="muted"></div>
         </div>`,
    );

    this.on('#type', 'change', (e) => {
      this.type = e.target.value;
      this.preset = null;
      this.render();
    });
    this.on('#preview', 'click', () => this.doPreview());
    this.on('#validate', 'click', () => this.doValidate());
    this.on('#publish', 'click', () => this.doPublish());
    this.on('#imgbtn', 'click', () => this.$('#img').click());
    this.on('#img', 'change', (e) => this.doImage(e.target.files?.[0]));

    // Live-toggle conditional fields (e.g. the image-gen-only result image) as their dependency changes.
    const deps = new Set(this.fields.filter((f) => f.showIf?.field).map((f) => f.showIf.field));
    for (const dep of deps) {
      const el = this.$(`[data-key="${dep}"]`);
      if (el) { el.addEventListener('input', () => this.syncConditional()); el.addEventListener('change', () => this.syncConditional()); }
    }
  }

  fieldHtml(f, value, visible = true) {
    const v = value == null ? '' : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    const label = `<label>${esc(f.label || f.key)}${f.required ? ' *' : ''}</label>`;
    let control;
    if (f.kind === 'enum') {
      control = `<select data-key="${f.key}">${(f.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (f.kind === 'boolean') {
      return `<div class="field" data-fkey="${f.key}"${visible ? '' : ' hidden'}>` +
        label.replace('<label>', '<label style="display:flex;gap:8px;align-items:center">') +
        `<input type="checkbox" data-key="${f.key}" ${value ? 'checked' : ''} style="width:auto" /></div>`;
    } else if (f.kind === 'textarea' || f.kind === 'json') {
      control = `<textarea data-key="${f.key}" data-kind="${f.kind}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
    } else {
      control = `<input data-key="${f.key}" data-kind="${f.kind}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" />`;
    }
    return `<div class="field" data-fkey="${f.key}"${visible ? '' : ' hidden'}>${label}${control}</div>`;
  }

  /** Format a value the way fieldHtml does, so showIf can read preset values before the DOM exists. */
  presetStr(value) {
    return value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value);
  }

  /** Evaluate a field's `showIf` against a (key)=>string value reader. No showIf => always visible. */
  fieldVisible(f, getVal) {
    const s = f.showIf;
    if (!s) return true;
    return matchesShowIf(s, getVal(s.field));
  }

  /** Recompute conditional fields from the live DOM and toggle their wrappers. */
  syncConditional() {
    const getVal = (k) => {
      const el = this.$(`[data-key="${k}"]`);
      return el ? (el.type === 'checkbox' ? el.checked : el.value) : '';
    };
    for (const f of this.fields) {
      if (!f.showIf) continue;
      const wrap = this.$(`.field[data-fkey="${f.key}"]`);
      if (wrap) wrap.hidden = !this.fieldVisible(f, getVal);
    }
  }

  /** Read raw value for a field key from the rendered inputs (DOM side of the pure gatherInput). */
  rawGetter() {
    return (key, kind) => {
      const el = this.$(`[data-key="${key}"]`);
      if (!el) return undefined;
      if (kind === 'boolean') return el.checked;
      return el.value;
    };
  }

  gather() {
    // Only gather fields that are currently visible, so a hidden conditional field (e.g. a stale image on
    // a prompt whose image-gen target was removed) is never submitted.
    const getVal = (k) => {
      const el = this.$(`[data-key="${k}"]`);
      return el ? (el.type === 'checkbox' ? el.checked : el.value) : '';
    };
    const visible = this.fields.filter((f) => this.fieldVisible(f, getVal));
    return { type: this.type, input: gatherInput(visible, this.rawGetter()), body: this.$('#body')?.value ?? '' };
  }

  out(html, cls = 'muted') {
    const o = this.$('#out');
    if (o) {
      o.className = cls;
      o.innerHTML = html;
    }
  }

  async doPreview() {
    try {
      const res = await this.client.preview({ body: this.$('#body').value });
      this.out(`<div class="preview">${res.html || ''}</div>`);
    } catch (err) {
      this.out(esc(err.message), 'danger');
    }
  }

  async doValidate() {
    try {
      const { type, input, body } = this.gather();
      const res = await this.client.validateContent({ type, input, body });
      this.out(res.valid ? `<span class="tag ok">valid</span> ${esc(res.path || '')}` : `<span class="danger">${esc(res.error)}</span>`);
    } catch (err) {
      this.out(esc(err.message), 'danger');
    }
  }

  async doPublish() {
    this.out('Publishing…');
    try {
      const { type, input, body } = this.gather();
      const res = await this.client.publish({ type, input, body });
      this.out(`<span class="tag ok">${res.updated ? 'updated' : 'opened'}</span> PR <a href="${esc(res.prUrl)}" target="_blank" rel="noopener">#${esc(res.prNumber)}</a>`);
      this.emit('gbti-published', res);
    } catch (err) {
      this.out(esc(err.message), 'danger');
    }
  }

  async doImage(file) {
    if (!file) return;
    const dataBase64 = await fileToBase64(file);
    try {
      const res = await this.client.stageImage({ filename: file.name, dataBase64 });
      // If a visible, empty image field is on the form (e.g. a prompt result image), drop the staged path
      // straight into it; otherwise the path is for the author to reference in their body.
      const imgField = this.fields.find((f) => f.kind === 'image');
      const el = imgField && this.$(`[data-key="${imgField.key}"]`);
      const wrap = imgField && this.$(`.field[data-fkey="${imgField.key}"]`);
      if (el && !el.value && wrap && !wrap.hidden) {
        el.value = res.path;
        this.out(`Image staged into <code>${esc(imgField.label || imgField.key)}</code>: <code>${esc(res.path)}</code>`);
      } else {
        this.out(`Image staged: <code>${esc(res.path)}</code> (reference it in your body)`);
      }
    } catch (err) {
      this.out(esc(err.message), 'danger');
    }
  }
}

/** Normalize a model/target string to lowercase alphanumerics (mirrors client/src/image-models.mjs). */
function normTok(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Evaluate a serializable `showIf` descriptor against a raw dependency value. Currently supports
 * { field, includesModel: [...] }: visible when any comma-separated part of the value matches (by
 * normalized substring) any listed model. Mirrors isImageGenTarget so the UI and the schema agree.
 */
function matchesShowIf(showIf, raw) {
  if (!showIf) return true;
  if (Array.isArray(showIf.includesModel)) {
    const models = showIf.includesModel.map(normTok).filter(Boolean);
    const parts = String(raw ?? '').split(',').map(normTok).filter(Boolean);
    return parts.some((p) => models.some((m) => p.includes(m)));
  }
  return true;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('could not read file'));
    r.readAsDataURL(file);
  });
}

define('gbti-content-editor', GbtiContentEditor);
export { GbtiContentEditor };
