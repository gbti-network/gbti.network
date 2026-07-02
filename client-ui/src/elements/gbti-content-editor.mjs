// <gbti-content-editor> (SOW-006 v2): the per-type authoring form. Renders the field descriptors from
// client.formFields(type), a markdown body with a live preview (client.preview), image staging
// (client.stageImage), validation (client.validateContent), and publish (client.publish). The same component
// powers the standalone CMS (in <gbti-app>) and is reused by the inline editor. All typing/gathering uses the
// pure form.mjs helpers, so the only DOM concern here is reading raw values + rendering.

import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck, failHint } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement
import { gatherInput } from '../form.mjs';
import { resolveAsset } from '../assets.mjs'; // SOW-062 P3: resolve an existing coverImage path to a preview URL
import './gbti-doc-editor.mjs'; // SOW-062 P5: the cohesive WYSIWYG body editor (same #body.value Markdown contract)
import { EDITOR_SURFACE } from '../tokens.mjs'; // SOW-062 P6: the solid --s-* editor palette (decoupled from glass)

// SOW-062 P6: inline icons for the edhead toolbar + section headers (the design's sprite is not in the shadow root).
const _svg = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const DOC = _svg('<path d="M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 3.2V7.5H18M9 12.5h6M9 16h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>');
const EYE = _svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>');
const SAVE = _svg('<path d="M5 4h10l4 4v12H5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 4v5h6V4M8 20v-6h8v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>');
const MERGE = _svg('<circle cx="6" cy="6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="18" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="13" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 8.3v7.4M6 10.5c.4 3.4 3 5 9.4 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');

const TYPES = ['post', 'product', 'prompt', 'profile'];

// SOW-062 Phase 2: fields HIDDEN from the editor UI but PRESERVED on save. They are still rendered into the DOM
// (a hidden block) carrying their preset value, and gather() filters by showIf (not DOM-hidden), so it still reads
// + re-submits them — editing an item that already has a `canonicalUrl` never strips it.
const HIDDEN_KEYS = new Set(['canonicalUrl']);
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
    let canStage = true; // SOW-082: Save-draft is allowed for trial+paid; 'unknown' fails OPEN like publish
    try {
      const st = await this.client.status();
      membership = st?.membership ?? 'unknown';
      canStage = membership === 'unknown' || st?.canStageDrafts === true;
    } catch {
      membership = 'unknown';
    }
    const blocked = membership !== 'paid' && membership !== 'unknown';
    const p = this.preset?.input ?? {};
    const getValPreset = (k) => this.presetStr(p[k]);
    // SOW-062 Phase 6: title/tagline/slug render as the INLINE document header (contenteditable, two-way bound to
    // their hidden [data-key] inputs), so they are pulled OUT of the rail into the hidden block -- gather() still
    // reads them. The rest group into rail sections; HIDDEN_KEYS also render hidden-but-preserved.
    const taglineKey = this.fields.find((f) => f.key === 'excerpt') ? 'excerpt' : (this.fields.find((f) => f.key === 'shortDescription') ? 'shortDescription' : null);
    const headerKeys = new Set(['title', 'slug', taglineKey].filter(Boolean));
    const grouped = {};
    const hiddenFields = [];
    for (const f of this.fields) {
      if (HIDDEN_KEYS.has(f.key) || headerKeys.has(f.key)) { hiddenFields.push(f); continue; }
      const sec = sectionFor(f.key);
      (grouped[sec] = grouped[sec] || []).push(f);
    }
    const order = ['Details', ...RAIL_SECTIONS.map((s) => s.name)];
    const sectionsHtml = order.filter((n) => grouped[n]?.length).map((n) => {
      const inner = grouped[n].map((f) => this.fieldHtml(f, p[f.key], this.fieldVisible(f, getValPreset))).join('');
      return `<details open class="rsec"><summary>${esc(n)}</summary><div class="rbody">${inner}</div></details>`;
    }).join('');
    const hiddenHtml = hiddenFields.map((f) => this.fieldHtml(f, p[f.key], false)).join('');
    const typePath = ({ post: 'blog', product: 'products', prompt: 'prompts' })[this.type] || this.type;
    const isPub = String(p.status || '').toLowerCase() === 'published';
    const statusLabel = isPub ? (p.publishedAt ? String(p.publishedAt).slice(0, 10) : 'published') : 'draft';
    this.set(
      this.css(EDITOR_SURFACE + `
        :host { display:block; background:var(--s-app); color:var(--s-fg); font-family:var(--font-body); }
        .edhead { display:flex; align-items:center; gap:12px; padding:4px 2px 16px; flex-wrap:wrap; }
        .etype { font-family:var(--font-mono,monospace); font-size:10.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--s-green-fg); background:var(--s-tint); border:1.5px solid var(--s-tint-2); border-radius:999px; padding:5px 12px; }
        .edhead-sp { flex:1; }
        .savechip { font-size:13px; color:var(--s-fg-mute); font-weight:500; }
        .ebtn { font:inherit; font-weight:600; font-size:14px; padding:9px 16px; border-radius:8px; border:1.5px solid var(--s-line-2); background:var(--s-surface); color:var(--s-fg); cursor:pointer; display:inline-flex; align-items:center; gap:7px; white-space:nowrap; }
        .ebtn:hover { border-color:var(--s-fg-mute); }
        .ebtn svg { width:16px; height:16px; }
        .ebtn-primary { background:var(--s-green); border-color:var(--s-green); color:#fff; box-shadow:0 8px 20px rgba(31,158,95,.26); }
        .ebtn-primary:hover { filter:brightness(.96); border-color:var(--s-green); }
        .edgrid { display:grid; grid-template-columns:minmax(0,1fr) 350px; gap:34px; align-items:start; }
        @media (max-width:800px) { .edgrid { grid-template-columns:1fr; } }
        .doc { min-width:0; background:var(--s-canvas); border:1.5px solid var(--s-line); border-radius:12px; box-shadow:var(--s-shadow-md); padding:40px 46px 52px; color:var(--s-fg); }
        .doc-title { font-family:var(--font-display); font-weight:800; font-size:34px; line-height:1.14; letter-spacing:-.015em; color:var(--s-fg); outline:none; margin-bottom:6px; }
        .doc-title:empty::before { content:attr(data-ph); color:var(--s-fg-mute); opacity:.55; }
        .doc-tagline { font-size:18px; line-height:1.5; font-weight:500; color:var(--s-fg-soft); outline:none; margin:2px 0 14px; }
        .doc-tagline:empty::before { content:attr(data-ph); color:var(--s-fg-mute); opacity:.5; }
        .doc-slug { display:flex; align-items:center; gap:9px; flex-wrap:wrap; font-family:var(--font-mono,monospace); font-size:12.5px; color:var(--s-fg-mute); margin-bottom:6px; }
        .doc-slug .slug-val { color:var(--s-green-fg); font-weight:600; outline:none; border-bottom:1.5px dashed transparent; }
        .doc-slug .slug-val:hover { border-bottom-color:var(--s-line-2); }
        .doc-slug .slug-val:focus { border-bottom-color:var(--s-green); }
        .doc-slug .slug-meta { display:inline-flex; align-items:center; gap:7px; }
        .doc-slug .pubdot { width:7px; height:7px; border-radius:50%; background:var(--s-fg-mute); }
        .doc-slug .slug-meta.pub .pubdot { background:var(--s-green); }
        .docsec { margin-top:38px; padding-top:30px; border-top:1.5px solid var(--s-line); }
        .docsec#secMain { margin-top:14px; padding-top:0; border-top:none; }
        .docsec-h { font-family:var(--font-mono,monospace); font-size:11px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--s-fg-mute); margin-bottom:14px; display:flex; align-items:center; gap:8px; }
        .docsec-h svg { width:15px; height:15px; }
        #body { display:block; min-height:24vh; }
        .notice { background:var(--s-tint); border:1px solid var(--s-green); border-radius:10px; padding:10px 14px; margin-bottom:16px; color:var(--s-fg); font-size:13.5px; }
        .notice a { color:var(--s-green-fg); }
        #out { margin-top:14px; }
        .preview { background:var(--s-surface-2); border:1px solid var(--s-line); border-radius:10px; padding:12px 14px; color:var(--s-fg); margin-top:12px; }
        .rail { display:flex; flex-direction:column; gap:14px; position:sticky; top:8px; max-height:calc(100vh - 16px); overflow-y:auto; }
        @media (max-width:800px) { .rail { position:static; max-height:none; } }
        .rsec { background:var(--s-surface); border:1.5px solid var(--s-line); border-radius:10px; box-shadow:var(--s-shadow); overflow:hidden; }
        .rsec > summary { list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; padding:13px 15px; font-weight:700; font-size:14px; color:var(--s-fg); }
        .rsec > summary::-webkit-details-marker { display:none; }
        .rsec > summary::after { content:'⌄'; color:var(--s-fg-mute); font-size:12px; }
        .rsec[open] > summary::after { content:'⌃'; }
        .rbody { padding:2px 15px 14px; display:grid; gap:8px; }
        .rbody label { font-size:12px; color:var(--s-fg-mute); font-weight:600; }
        .type-ro { font-weight:600; font-size:13px; padding:7px 11px; border:1px solid var(--s-line); border-radius:8px; background:var(--s-surface-2); color:var(--s-fg); text-transform:capitalize; }
        .cover-frames { display:flex; gap:12px; align-items:flex-end; margin:6px 0 10px; }
        .cover-frames.empty { display:none; }
        .cf { margin:0; }
        .cf img { display:block; background:var(--s-surface-2); border:1px solid var(--s-line); border-radius:8px; }
        .cf-43 img { width:116px; aspect-ratio:4/3; object-fit:cover; }
        .cf-hero img { width:184px; height:auto; max-height:150px; object-fit:contain; }
        .cf figcaption { font-size:11px; color:var(--s-fg-mute); margin-top:4px; text-align:center; }
        .cover-actions { display:flex; gap:8px; }
      `) +
        `<div class="edhead">
           <span class="etype">${esc(this.type)}</span>
           <span class="edhead-sp"></span>
           <span class="savechip" id="savechip"></span>
           <button class="ebtn" id="preview" type="button">${EYE} Preview</button>
           <button class="ebtn" id="validate" type="button">Validate</button>
           ${canStage ? `<button class="ebtn" id="draft" type="button">${SAVE} Save draft</button>` : ''}
           <button class="ebtn${blocked ? '' : ' ebtn-primary'}" id="publish" type="button"${blocked ? ' title="Publishing requires a paid membership"' : ''}>${blocked ? 'Membership required' : `${MERGE} Publish`}</button>
         </div>
         <div class="edgrid">
           <article class="doc">
             ${blocked ? `<div class="notice">Publishing requires a paid membership. Use <b>Save draft</b> to keep your work on your own fork; publish it once you upgrade. <a href="https://gbti.network/membership/" target="_blank" rel="noopener">Upgrade to publish</a>.</div>` : ''}
             <div class="doc-title" contenteditable="true" data-header="title" data-ph="Untitled">${esc(this.presetStr(p.title) || '')}</div>
             ${taglineKey ? `<div class="doc-tagline" contenteditable="true" data-header="${taglineKey}" data-ph="Add a tagline…">${esc(this.presetStr(p[taglineKey]) || '')}</div>` : ''}
             <div class="doc-slug"><span class="slug-base">${esc(typePath)}/</span><span class="slug-val" contenteditable="true" spellcheck="false" data-header="slug" data-ph="slug">${esc(this.presetStr(p.slug) || '')}</span><span class="slug-meta${isPub ? ' pub' : ''}"><span class="pubdot"></span><span>${esc(statusLabel)}</span></span></div>
             <section class="docsec" id="secMain">
               <div class="docsec-h">${DOC} Main content</div>
               <gbti-doc-editor id="body"></gbti-doc-editor>
             </section>
             <div id="out" class="muted"></div>
             <div hidden>${hiddenHtml}</div>
           </article>
           <aside class="rail">
             <details open class="rsec"><summary>Document</summary><div class="rbody"><label>Type</label><div class="type-ro">${esc(this.type)}</div></div></details>
             ${sectionsHtml}
           </aside>
         </div>`,
    );

    // SOW-062 5e: the Document Type is READ-ONLY (set when the item is created; gather() reads this.type, not the DOM).
    this.on('#preview', 'click', () => this.doPreview());
    this.on('#validate', 'click', () => this.doValidate());
    this.on('#draft', 'click', () => this.doDraft());
    this.on('#publish', 'click', () => this.doPublish());
    this._bindHeader(); // SOW-062 P6: the inline title/tagline/slug mirror to their hidden [data-key] inputs

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

  // SOW-062 P6: two-way bind the inline document header (title/tagline/slug contenteditables) to their hidden
  // [data-key] meta inputs, so gather() -- which reads [data-key] -- stays the single source of truth for publish.
  _bindHeader() {
    this.$$('[data-header]').forEach((el) => {
      const input = this.$(`[data-key="${el.dataset.header}"]`);
      if (!input) return;
      const sync = () => { input.value = el.textContent.trim(); };
      el.addEventListener('input', sync);
      el.addEventListener('blur', sync);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); }); // single-line header fields
      el.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData)?.getData('text/plain') || ''; if (typeof document !== 'undefined') document.execCommand('insertText', false, t.replace(/\s+/g, ' ').trim()); });
      sync();
    });
  }

  gather() {
    // SOW-062 P6: flush the inline header contenteditables into their [data-key] inputs before reading.
    this.$$('[data-header]').forEach((el) => { const i = this.$(`[data-key="${el.dataset.header}"]`); if (i) i.value = el.textContent.trim(); });
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
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
    }
  }

  async doValidate() {
    try {
      const { type, input, body } = this.gather();
      const res = await this.client.validateContent({ type, input, body });
      this.out(res.valid ? `<span class="tag ok">valid</span> ${esc(res.path || '')}` : `<span class="danger">${esc(res.error)}</span>`);
    } catch (err) {
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
    }
  }

  async doPublish() {
    this.out('Publishing…');
    try {
      const { type, input, body } = this.gather();
      const res = await this.client.publish({ type, input, body });
      this.out(`<span class="tag ok">submitted</span> ${esc(submitAck({ prNumber: res.prNumber, autoMerge: true }))}`); // SOW-072 P2: consistent ack (esc: out() writes innerHTML)
      this.emit('gbti-published', res);
    } catch (err) {
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
    }
  }

  // SOW-082: Save the current content as a draft on the member's own fork (no PR). Allowed for trial + paid; a
  // trial member's members-only content is refused server-side with a clean upgrade nudge (membership-required).
  async doDraft() {
    this.out('Saving draft…');
    try {
      const { type, input, body } = this.gather();
      const res = await this.client.saveDraft({ type, input, body });
      this.out('<span class="tag ok">saved</span> Draft staged on your fork. Open <b>Drafts</b> to review or publish it.');
      this.emit('gbti-draft-saved', res);
    } catch (err) {
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
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
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
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
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
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
