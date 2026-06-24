// <gbti-content-editor> (SOW-006 v2): the per-type authoring form. Renders the field descriptors from
// client.formFields(type), a markdown body with a live preview (client.preview), image staging
// (client.stageImage), validation (client.validateContent), and publish (client.publish). The same component
// powers the standalone CMS (in <gbti-app>) and is reused by the inline editor. All typing/gathering uses the
// pure form.mjs helpers, so the only DOM concern here is reading raw values + rendering.

import { GbtiElement, define, esc } from '../base.mjs';
import { gatherInput } from '../form.mjs';
import { resolveAsset } from '../assets.mjs'; // SOW-062 P3: resolve an existing coverImage path to a preview URL
import './gbti-block-editor.mjs'; // SOW-062 P4: the block body editor (serializes to/from Markdown via #body.value)

const TYPES = ['post', 'product', 'prompt', 'profile'];

// SOW-062 Phase 2: fields HIDDEN from the editor UI but PRESERVED on save. They are still rendered into the DOM
// (a hidden block) carrying their preset value, and gather() filters by showIf (not DOM-hidden), so it still reads
// + re-submits them — editing an item that already has a `delegation` / `canonicalUrl` never strips it.
const HIDDEN_KEYS = new Set(['delegation', 'canonicalUrl']);
// SOW-062 Phase 2: the right-hand document side rail groups the meta fields into collapsible sections. Anything not
// matched here falls into "Details" (rendered first, open). Keys vary by type; unmatched keys degrade gracefully.
const RAIL_SECTIONS = [
  { name: 'Publishing', keys: ['status', 'visibility'] },
  { name: 'Taxonomy', keys: ['categories', 'tags'] },
  { name: 'Pricing', keys: ['pricing', 'pricingUrl'] },
  { name: 'Links', keys: ['links'] },
  { name: 'Media', keys: ['coverImage', 'coverAlt', 'image', 'imageAlt', 'alt', 'video'] },
];
const sectionFor = (key) => RAIL_SECTIONS.find((s) => s.keys.includes(key))?.name || 'Details';

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
    const getValPreset = (k) => this.presetStr(p[k]);
    // SOW-062 Phase 2: group the meta fields into rail sections; the HIDDEN_KEYS render into a preserved-but-hidden
    // block (so gather() still re-submits their existing values).
    const grouped = {};
    const hiddenFields = [];
    for (const f of this.fields) {
      if (HIDDEN_KEYS.has(f.key)) { hiddenFields.push(f); continue; }
      const sec = sectionFor(f.key);
      (grouped[sec] = grouped[sec] || []).push(f);
    }
    const order = ['Details', ...RAIL_SECTIONS.map((s) => s.name)];
    const sectionsHtml = order.filter((n) => grouped[n]?.length).map((n) => {
      const inner = grouped[n].map((f) => this.fieldHtml(f, p[f.key], this.fieldVisible(f, getValPreset))).join('');
      return `<details open class="sec"><summary>${esc(n)}</summary><div class="grid">${inner}</div></details>`;
    }).join('');
    const hiddenHtml = hiddenFields.map((f) => this.fieldHtml(f, p[f.key], false)).join('');
    this.set(
      this.css(`
        .editor { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:22px; align-items:start; }
        @media (max-width:860px) { .editor { grid-template-columns:1fr; } }
        .doc { min-width:0; }
        .doc .body-l { margin-top:0; }
        #body { display:block; min-height:30vh; }
        .grid { display:grid; gap:2px; }
        .actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
        #out { margin-top:12px; }
        .preview { background:#201e26; border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
        .notice { background:#2a2330; border:1px solid var(--accent); border-radius:8px; padding:10px 14px; margin-bottom:12px; }
        .notice a { color: var(--accent); }
        .rail { border:1px solid var(--line); border-radius:12px; background:var(--panel); padding:4px 14px 12px; position:sticky; top:8px; max-height:calc(100vh - 16px); overflow-y:auto; }
        @media (max-width:860px) { .rail { position:static; max-height:none; } }
        .rail-h { font-family:var(--font-display, inherit); font-weight:700; font-size:15px; padding:11px 0 2px; }
        .rail details.sec { border-top:1px solid var(--line); }
        .rail summary { cursor:pointer; list-style:none; font-weight:600; font-size:13px; padding:10px 0; color:var(--fg); display:flex; justify-content:space-between; align-items:center; }
        .rail summary::-webkit-details-marker { display:none; }
        .rail summary::after { content:'⌄'; color:var(--muted); font-size:12px; }
        .rail details[open] summary::after { content:'⌃'; }
        .rail .grid { padding-bottom:10px; }
        .cover-frames { display:flex; gap:12px; align-items:flex-end; margin:6px 0 10px; }
        .cover-frames.empty { display:none; }
        .cf { margin:0; }
        .cf img { display:block; background:var(--hover); border:1px solid var(--line); border-radius:8px; }
        .cf-43 img { width:116px; aspect-ratio:4/3; object-fit:cover; }
        .cf-hero img { width:184px; height:auto; max-height:150px; object-fit:contain; }
        .cf figcaption { font-size:11px; color:var(--muted); margin-top:4px; text-align:center; }
        .cover-actions { display:flex; gap:8px; }
      `) +
        `<div class="editor">
           <div class="doc">
             ${blocked ? `<div class="notice">Publishing requires a paid membership. You can write and stage your work now; it stays on your fork until you upgrade. <a href="https://gbti.network" target="_blank" rel="noopener">Upgrade to publish</a>.</div>` : ''}
             <label class="body-l">Body</label>
             <gbti-block-editor id="body"></gbti-block-editor>
             <div class="actions">
               <button id="preview" class="ghost">Preview</button>
               <button id="validate" class="ghost">Validate</button>
               <button id="publish"${blocked ? ' title="Publishing requires a paid membership"' : ''}>${blocked ? 'Membership required to publish' : 'Publish (open PR)'}</button>
               <input type="file" id="img" accept="image/*" style="display:none" />
               <button id="imgbtn" class="ghost">Add image</button>
             </div>
             <div id="out" class="muted"></div>
           </div>
           <aside class="rail">
             <div class="rail-h">Document</div>
             <label>Type</label>
             <select id="type">${TYPES.map((t) => `<option ${t === this.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
             ${sectionsHtml}
             <div hidden>${hiddenHtml}</div>
           </aside>
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

    // SOW-062 P3: the rich cover-image control(s) — preview + Choose/Replace/Remove (the kind:'image' field).
    this.$$('[data-cover]').forEach((c) => {
      const file = c.querySelector('[data-cover-file]');
      c.querySelector('[data-cover-pick]')?.addEventListener('click', () => file?.click());
      file?.addEventListener('change', (e) => this.doCoverImage(e.target.files?.[0], c));
      c.querySelector('[data-cover-clear]')?.addEventListener('click', () => this.clearCover(c));
    });

    // SOW-062 P4: seed the block body editor from the preset body (its value setter parses Markdown -> blocks).
    const be = this.$('#body');
    if (be) be.value = this.preset?.body ?? '';

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
    if (f.kind === 'image') {
      // SOW-062 P3: a rich cover-image control — a 4:3 (card) + a full (reader hero) framing preview, Choose/Replace
      // + Remove, and a hidden input carrying the staged path (so gather() reads it like any field).
      const url = v ? resolveAsset(v) : '';
      const has = !!url;
      return `<div class="field cover-field" data-fkey="${f.key}"${visible ? '' : ' hidden'}>${label}
        <div class="cover" data-cover>
          <div class="cover-frames${has ? '' : ' empty'}">
            <figure class="cf cf-43"><img data-cimg src="${esc(url)}" alt="" /><figcaption>4:3 card</figcaption></figure>
            <figure class="cf cf-hero"><img data-cimg src="${esc(url)}" alt="" /><figcaption>Hero (full)</figcaption></figure>
          </div>
          <input type="file" accept="image/*" hidden data-cover-file />
          <div class="cover-actions">
            <button type="button" class="ghost" data-cover-pick>${has ? 'Replace image' : 'Choose image'}</button>
            <button type="button" class="ghost" data-cover-clear${has ? '' : ' hidden'}>Remove</button>
          </div>
          <input data-key="${f.key}" data-kind="image" type="hidden" value="${esc(v)}" />
        </div></div>`;
    }
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

  // SOW-062 P3: stage a picked cover image — update both framing previews from the file immediately, then stage it
  // and drop the returned repo path into the field's hidden input (gather() picks it up like any field).
  async doCoverImage(file, control) {
    if (!file || !control) return;
    const dataUrl = await fileToDataUrl(file);
    control.querySelectorAll('[data-cimg]').forEach((img) => { img.src = dataUrl; });
    control.querySelector('.cover-frames')?.classList.remove('empty');
    control.querySelector('[data-cover-clear]')?.removeAttribute('hidden');
    const pick = control.querySelector('[data-cover-pick]');
    if (pick) pick.textContent = 'Replace image';
    try {
      const res = await this.client.stageImage({ filename: file.name, dataBase64: dataUrl.split(',')[1] || '' });
      const el = control.querySelector('[data-key]');
      if (el) el.value = res.path;
      this.out(`Cover image staged: <code>${esc(res.path)}</code>`);
    } catch (err) {
      this.out(esc(err.message), 'danger');
    }
  }

  clearCover(control) {
    if (!control) return;
    const el = control.querySelector('[data-key]');
    if (el) el.value = '';
    control.querySelectorAll('[data-cimg]').forEach((img) => { img.removeAttribute('src'); });
    control.querySelector('.cover-frames')?.classList.add('empty');
    control.querySelector('[data-cover-clear]')?.setAttribute('hidden', '');
    const pick = control.querySelector('[data-cover-pick]');
    if (pick) pick.textContent = 'Choose image';
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

// SOW-062 P3: the full data: URL (for an immediate cover-image preview before the staged path is published).
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('could not read file'));
    r.readAsDataURL(file);
  });
}

define('gbti-content-editor', GbtiContentEditor);
export { GbtiContentEditor };
