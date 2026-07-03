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
// SOW-062 P6 rail: the design references these by sprite id; the shadow root has no sprite, so inline them.
const S = 'fill="none" stroke="currentColor"';
const GLOBE = _svg(`<circle cx="12" cy="12" r="8.2" ${S} stroke-width="1.7"/><path d="M3.8 12h16.4M12 3.8c2.2 2.3 3.3 5.2 3.3 8.2S14.2 17.9 12 20.2M12 3.8c-2.2 2.3-3.3 5.2-3.3 8.2S9.8 17.9 12 20.2" ${S} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`);
const LOCK = _svg(`<rect x="5" y="11" width="14" height="9" rx="2.2" ${S} stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" ${S} stroke-width="1.8"/>`);
const INFO = _svg(`<circle cx="12" cy="12" r="8.2" ${S} stroke-width="1.7"/><path d="M12 11v5" ${S} stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="8" r="1.05" fill="currentColor"/>`);
const X = _svg(`<path d="M6 6l12 12M18 6L6 18" ${S} stroke-width="2" stroke-linecap="round"/>`);
const CHEV = _svg(`<path d="M6 9l6 6 6-6" ${S} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
const TAG = _svg(`<path d="M4 11.5V5a1 1 0 0 1 1-1h6.5l8 8-7.5 7.5-8-8z" ${S} stroke-width="1.7" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/>`);
const COIN = _svg(`<circle cx="12" cy="12" r="8" ${S} stroke-width="1.8"/><path d="M12 7.5v9M14.5 9.3c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.9 0 2.6 5 1.4 5 4 0 1.2-1.1 2-2.5 2-1 0-2-.4-2.6-1.1" ${S} stroke-width="1.6" stroke-linecap="round"/>`);
const LINK = _svg(`<path d="M10 14a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L11 8" ${S} stroke-width="1.7" stroke-linecap="round"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-2.5 2.5a3.5 3.5 0 0 0 5 5L13 16" ${S} stroke-width="1.7" stroke-linecap="round"/>`);
const IMG = _svg(`<rect x="4" y="5" width="16" height="14" rx="2.2" ${S} stroke-width="1.8"/><circle cx="9" cy="10" r="1.7" ${S} stroke-width="1.6"/><path d="M5 17.5l4.2-4.2L13 17l2.6-2.6L19 17.8" ${S} stroke-width="1.7" stroke-linejoin="round"/>`);
const SECTION_ICON = { Publishing: EYE, Taxonomy: TAG, Pricing: COIN, Links: LINK, Media: IMG, Details: DOC };
const TYPE_LABEL = { post: 'Article', product: 'Product', prompt: 'Prompt', profile: 'Profile' };

const TYPES = ['post', 'product', 'prompt', 'profile'];

// SOW-062 Phase 2: fields HIDDEN from the editor UI but PRESERVED on save. They are still rendered into the DOM
// (a hidden block) carrying their preset value, and gather() filters by showIf (not DOM-hidden), so it still reads
// + re-submits them — editing an item that already has a `canonicalUrl` never strips it.
const HIDDEN_KEYS = new Set(['canonicalUrl']);
// SOW-062 Phase 6: the rail follows the hi-fi mockup's CURATED per-type schema (gbti-editor-data.js RAILS), not the
// exhaustive formFields grouping. Each section lists the field keys to show, in order. Any formField NOT listed here
// is preserved HIDDEN (gather() still submits its existing value). status + publishedAt surface in the slug-meta.
// (Article deliberately has no Video section -- owner: the video sidebar is not needed for the article edit page.)
const RAIL_SCHEMA = {
  post: [
    { title: 'Details', open: true, keys: ['visibility', 'excerpt', 'categories', 'tags'] },
    { title: 'Media', open: false, keys: ['coverImage', 'coverAlt'] },
  ],
  product: [
    { title: 'Details', open: true, keys: ['visibility', 'shortDescription', 'categories', 'tags'] },
    { title: 'Pricing', open: true, keys: ['pricing', 'pricingUrl'] },
    { title: 'Links', open: true, keys: ['links'] },
    { title: 'Media', open: true, keys: ['icon', 'featuredImage', 'banner'] },
  ],
  prompt: [
    { title: 'Details', open: true, keys: ['visibility', 'shortDescription', 'targets', 'categories', 'tags'] },
    { title: 'Media', open: false, keys: ['image'] },
  ],
};

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
    // SOW-062 Phase 6: header = title + slug ONLY (the description moved into the rail Details per the mockup). The
    // rail renders the per-type RAIL_SCHEMA in order; fields NOT in the schema (nor header, nor publicStub which the
    // visibility switch folds in) are preserved HIDDEN so gather() still submits their existing values.
    const headerKeys = new Set(['title', 'slug']);
    const schema = RAIL_SCHEMA[this.type] || RAIL_SCHEMA.post;
    const schemaKeys = new Set(schema.flatMap((s) => s.keys));
    const fieldByKey = new Map(this.fields.map((f) => [f.key, f]));
    const hiddenFields = this.fields.filter((f) => !headerKeys.has(f.key) && !schemaKeys.has(f.key) && f.key !== 'publicStub');
    const sectionsHtml = schema.map((sec) => {
      const inner = sec.keys.map((key) => { const f = fieldByKey.get(key); return f ? this.fieldHtml(f, p[key], this.fieldVisible(f, getValPreset)) : ''; }).join('');
      if (!inner) return '';
      return `<details ${sec.open ? 'open' : ''} class="rsec"><summary><span class="st"><span class="si">${SECTION_ICON[sec.title] || DOC}</span>${esc(sec.title)}</span><span class="chev">${CHEV}</span></summary><div class="rbody">${inner}</div></details>`;
    }).join('');
    const hiddenHtml = hiddenFields.map((f) => this.fieldHtml(f, p[f.key], false)).join('');
    const typePath = ({ post: 'blog', product: 'products', prompt: 'prompts' })[this.type] || this.type;
    const isPub = String(p.status || '').toLowerCase() === 'published';
    const statusLabel = isPub ? (p.publishedAt ? String(p.publishedAt).slice(0, 10) : 'published') : 'draft';
    this.set(
      this.css(EDITOR_SURFACE + `
        :host { display:block; background:var(--s-app); color:var(--s-fg); font-family:var(--font-body); container-type:inline-size; }
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
        @container (max-width:1140px) { .edgrid { grid-template-columns:1fr; } }
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
        @container (max-width:1140px) { .rail { position:static; max-height:none; } }
        .rsec { background:var(--s-surface); border:1.5px solid var(--s-line); border-radius:10px; box-shadow:var(--s-shadow); overflow:hidden; }
        .rsec > summary { list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; padding:13px 15px; font-weight:700; font-size:14px; color:var(--s-fg); }
        .rsec > summary::-webkit-details-marker { display:none; }
        .rsec > summary::after { content:'⌄'; color:var(--s-fg-mute); font-size:12px; }
        .rsec[open] > summary::after { content:'⌃'; }
        .rbody { padding:2px 15px 14px; display:grid; gap:8px; }
        .rbody label { font-size:12px; color:var(--s-fg-mute); font-weight:600; }
        .type-ro { font-weight:600; font-size:13px; padding:7px 11px; border:1px solid var(--s-line); border-radius:8px; background:var(--s-surface-2); color:var(--s-fg); text-transform:capitalize; }
        /* SOW-062 P6 rail controls (ported from gbti-editor.css --s-* controls) */
        .rsec > summary { padding:14px 16px; }
        .rsec > summary::after { content:none; }
        .rsec > summary .st { display:flex; align-items:center; gap:9px; font-weight:700; font-size:14px; color:var(--s-fg); }
        .rsec > summary .st .si { width:17px; height:17px; color:var(--s-fg-mute); display:inline-flex; }
        .rsec > summary .chev { width:17px; height:17px; color:var(--s-fg-mute); transition:transform .18s ease; display:inline-flex; }
        .rsec[open] > summary .chev { transform:rotate(180deg); }
        .rbody { padding:4px 16px 16px; display:flex; flex-direction:column; gap:15px; }
        .fld { display:flex; flex-direction:column; gap:6px; }
        .fld > label { font-size:12.5px; font-weight:600; color:var(--s-fg-soft); display:flex; align-items:center; gap:6px; }
        .fld .req { color:var(--s-green-fg); } .fld .hint { font-size:11.5px; color:var(--s-fg-mute); font-weight:400; }
        .inp, .ta, .selbox { width:100%; font:inherit; font-size:13.5px; color:var(--s-fg); background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; padding:9px 11px; outline:none; box-sizing:border-box; }
        .inp:focus, .ta:focus, .selbox:focus { border-color:var(--s-green); background:var(--s-surface); }
        .ta { resize:vertical; min-height:64px; line-height:1.5; } .inp.mono, .ta.mono { font-family:var(--font-mono,monospace); font-size:12.5px; }
        .selbox { appearance:none; cursor:pointer; padding-right:34px; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2384818c' stroke-width='2.2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 11px center; }
        .urlprev { font-family:var(--font-mono,monospace); font-size:11.5px; color:var(--s-fg-mute); line-height:1.5; } .urlprev b { color:var(--s-green-fg); font-weight:600; }
        .tgl { width:42px; height:24px; border-radius:999px; background:var(--s-line-2); border:0; position:relative; cursor:pointer; flex:none; transition:background .18s; }
        .tgl.on { background:var(--s-green); }
        .tgl::after { content:""; position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.25); transition:left .18s cubic-bezier(.3,.7,.4,1); }
        .tgl.on::after { left:21px; }
        .tglrow { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .tglrow .tt { font-size:13px; font-weight:600; color:var(--s-fg); } .tglrow .td { font-size:11.5px; color:var(--s-fg-mute); margin-top:1px; }
        .chips { display:flex; flex-wrap:wrap; gap:6px; padding:7px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; }
        .chips:focus-within { border-color:var(--s-green); }
        .chip2 { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; padding:4px 6px 4px 10px; border-radius:7px; background:var(--s-tint); color:var(--s-green-fg); border:1.5px solid var(--s-tint-2); }
        .chip2 .x { width:15px; height:15px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:.65; } .chip2 .x:hover { opacity:1; background:rgba(0,0,0,.08); } .chip2 .x svg { width:11px; height:11px; }
        .chips input { flex:1; min-width:70px; border:0; background:transparent; font:inherit; font-size:13px; color:var(--s-fg); outline:none; padding:4px; }
        .chip-neutral { background:var(--s-surface-3); color:var(--s-fg-soft); border-color:var(--s-line-2); }
        .visfield { padding-bottom:4px; }
        .visswitch { position:relative; display:grid; grid-template-columns:1fr 1fr; padding:4px; border-radius:7px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); margin-top:2px; }
        .visswitch .vs-thumb { position:absolute; top:4px; bottom:4px; left:4px; width:calc(50% - 4px); border-radius:7px; background:var(--s-surface); box-shadow:0 1px 3px rgba(0,0,0,.12); border:1.5px solid var(--s-line-2); transition:transform .18s cubic-bezier(.3,.7,.4,1); }
        .visswitch[data-active="members"] .vs-thumb { transform:translateX(calc(100% + 4px)); background:var(--s-tint); border-color:var(--s-tint-2); }
        .visswitch .vs-opt { position:relative; z-index:1; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:9px 6px; border:0; background:transparent; font:inherit; font-size:13.5px; font-weight:600; color:var(--s-fg-mute); cursor:pointer; white-space:nowrap; }
        .visswitch .vs-opt svg { width:16px; height:16px; } .visswitch .vs-opt.on { color:var(--s-fg); }
        .visswitch[data-active="members"] .vs-opt[data-vis="members"].on { color:var(--s-green-fg); }
        .stubwrap { margin-top:12px; padding-top:12px; border-top:1.5px dashed var(--s-line); } .stubwrap[hidden] { display:none; }
        .infobox { display:flex; gap:9px; margin-top:10px; padding:11px 13px; border-radius:7px; background:var(--s-tint); border:1.5px solid var(--s-tint-2); font-size:12.5px; line-height:1.55; color:var(--s-fg-soft); }
        .infobox svg { width:15px; height:15px; flex:none; margin-top:1px; color:var(--s-green-fg); } .infobox b { font-weight:700; color:var(--s-fg); }
        .statusrow { display:flex; align-items:center; gap:8px; }
        .dotpill { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; padding:6px 12px; border-radius:999px; background:var(--s-tint); color:var(--s-green-fg); border:1.5px solid var(--s-tint-2); }
        .dotpill .d { width:7px; height:7px; border-radius:50%; background:var(--s-green); }
        .cover-field .ebtn { font-size:13px; padding:7px 12px; }
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
             <div class="doc-slug"><span class="slug-base">${esc(typePath)}/</span><span class="slug-val" contenteditable="true" spellcheck="false" data-header="slug" data-ph="slug">${esc(this.presetStr(p.slug) || '')}</span><span class="slug-meta${isPub ? ' pub' : ''}"><span class="pubdot"></span><span>${esc(statusLabel)}</span></span></div>
             <section class="docsec" id="secMain">
               <div class="docsec-h">${DOC} Main content</div>
               <gbti-doc-editor id="body"></gbti-doc-editor>
             </section>
             <div id="out" class="muted"></div>
             <div hidden>${hiddenHtml}</div>
           </article>
           <aside class="rail">
             <details open class="rsec"><summary><span class="st"><span class="si">${DOC}</span>Type</span><span class="chev">${CHEV}</span></summary><div class="rbody"><div class="fld"><div class="urlprev" style="color:var(--s-fg-soft)">This is a <b>${esc(this.typeLabel())}</b>. Type is set at creation and can't be changed here.</div></div></div></details>
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
    this._wireRail(); // SOW-062 P6: chips / toggles / visibility switch / status dots

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
    const label = `<label>${esc(f.label || f.key)}${f.required ? ' <span class="req">*</span>' : ''}${f.hint ? ` <span class="hint">· ${esc(f.hint)}</span>` : ''}</label>`;
    const wrap = (inner, cls = '') => `<div class="fld${cls ? ' ' + cls : ''}" data-fkey="${f.key}"${visible ? '' : ' hidden'}>${inner}</div>`;

    // SOW-062 P6: visibility -> segmented switch + optional public-stub sub-block (publicStub is folded in here).
    if (f.kind === 'enum' && f.key === 'visibility') {
      const isMembers = String(v) === 'members';
      const stubField = this.fields.find((x) => x.key === 'publicStub');
      const stubOn = this._presetBool('publicStub');
      return `<div class="fld visfield" data-fkey="visibility"${visible ? '' : ' hidden'}><label>Visibility</label>
        <div class="visswitch" data-visswitch data-active="${isMembers ? 'members' : 'public'}"><span class="vs-thumb"></span>
          <button class="vs-opt ${isMembers ? '' : 'on'}" data-vis="public" type="button">${GLOBE} Public</button>
          <button class="vs-opt ${isMembers ? 'on' : ''}" data-vis="members" type="button">${LOCK} Members only</button></div>
        <input data-key="visibility" data-kind="enum" type="hidden" value="${esc(isMembers ? 'members' : 'public')}" />
        ${stubField ? `<div class="stubwrap" data-stubwrap ${isMembers ? '' : 'hidden'}>
          <div class="tglrow"><div><div class="tt">Leave a public stub</div><div class="td">Show a teaser on the public site instead of hiding it.</div></div>
            <button class="tgl ${stubOn ? 'on' : ''}" data-k="publicStub" type="button" role="switch" aria-checked="${stubOn}"></button></div>
          <input data-key="publicStub" data-kind="boolean" type="checkbox" ${stubOn ? 'checked' : ''} hidden />
          <div class="infobox">${INFO}<div>With a stub, the public site shows the <b>title</b>, <b>author</b>, and <b>short description</b>; the content stays members-only.</div></div>
        </div>` : ''}</div>`;
    }
    // status -> dotpill + select
    if (f.kind === 'enum' && f.key === 'status') {
      const opts = (f.options || ['draft', 'published']).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
      return wrap(`${label}<div class="statusrow"><span class="dotpill" data-statuspill><span class="d"></span><span data-statustxt>${esc(v || 'draft')}</span></span><select class="selbox" data-key="status" data-kind="enum" style="flex:1">${opts}</select></div>`);
    }
    // generic enum -> styled selbox
    if (f.kind === 'enum') {
      return wrap(`${label}<select class="selbox" data-key="${f.key}" data-kind="enum">${(f.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
    }
    // boolean -> toggle
    if (f.kind === 'boolean') {
      const on = !!value;
      return wrap(`<div class="tglrow"><div><div class="tt">${esc(f.label || f.key)}</div>${f.desc ? `<div class="td">${esc(f.desc)}</div>` : ''}</div><button class="tgl ${on ? 'on' : ''}" data-k="${f.key}" type="button" role="switch" aria-checked="${on}"></button></div><input type="checkbox" data-key="${f.key}" data-kind="boolean" ${on ? 'checked' : ''} hidden />`);
    }
    // array -> chips (value arrives comma-joined; hidden input keeps the comma string for gather())
    if (f.kind === 'array') {
      const arr = String(v).split(',').map((s) => s.trim()).filter(Boolean);
      const accent = f.key !== 'tags';
      const chips = arr.map((c) => `<span class="chip2 ${accent ? '' : 'chip-neutral'}">${esc(c)}<span class="x" data-rm>${X}</span></span>`).join('');
      return wrap(`${label}<div class="chips" data-chips="${f.key}" data-accent="${accent}">${chips}<input type="text" placeholder="${esc(f.placeholder || 'Add…')}"></div><input data-key="${f.key}" data-kind="array" type="hidden" value="${esc(arr.join(', '))}" />`);
    }
    // image / cover (current control; the reframe is deferred to rail-2)
    if (f.kind === 'image') {
      const url = v ? resolveAsset(v) : '';
      const has = !!url;
      return `<div class="fld cover-field" data-fkey="${f.key}"${visible ? '' : ' hidden'}>${label}
        <div class="cover" data-cover>
          <div class="cover-frames${has ? '' : ' empty'}">
            <figure class="cf cf-43"><img data-cimg src="${esc(url)}" alt="" /><figcaption>4:3 card</figcaption></figure>
            <figure class="cf cf-hero"><img data-cimg src="${esc(url)}" alt="" /><figcaption>Hero (full)</figcaption></figure>
          </div>
          <input type="file" accept="image/*" hidden data-cover-file />
          <div class="cover-actions"><button type="button" class="ebtn" data-cover-pick>${has ? 'Replace image' : 'Choose image'}</button><button type="button" class="ebtn" data-cover-clear${has ? '' : ' hidden'}>Remove</button></div>
          <input data-key="${f.key}" data-kind="image" type="hidden" value="${esc(v)}" />
        </div></div>`;
    }
    // textarea / json -> .ta
    if (f.kind === 'textarea' || f.kind === 'json') {
      return wrap(`${label}<textarea class="ta" data-key="${f.key}" data-kind="${f.kind}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`);
    }
    // text / date / number -> .inp
    const mono = f.kind === 'date' || f.key === 'slug';
    return wrap(`${label}<input class="inp${mono ? ' mono' : ''}" data-key="${f.key}" data-kind="${f.kind}" type="text" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" />`);
  }

  _presetBool(key) { return !!this.preset?.input?.[key]; }
  typeLabel() { return TYPE_LABEL[this.type] || this.type; }

  // SOW-062 P6: keep the status dot color tracking the select value.
  syncStatusDots() {
    this.$$('[data-statuspill]').forEach((p) => {
      const sel = this.$('[data-key="status"]');
      const val = sel ? sel.value : (p.querySelector('[data-statustxt]')?.textContent || '');
      const txt = p.querySelector('[data-statustxt]'); if (txt) txt.textContent = val;
      const d = p.querySelector('.d'); if (d) d.style.background = val === 'published' ? 'var(--s-green)' : 'var(--s-fg-mute)';
    });
  }

  // SOW-062 P6: wire the rail controls (chips add/remove, toggles, the visibility switch, status dots). Each writes
  // back to its hidden [data-key] input so gather()/gatherInput read the same values (no server contract change).
  _wireRail() {
    this.$$('[data-chips]').forEach((box) => {
      const persist = () => { const h = this.$(`input[data-key="${box.dataset.chips}"]`); if (h) h.value = [...box.querySelectorAll('.chip2')].map((c) => c.textContent.trim()).join(', '); };
      box.addEventListener('keydown', (e) => {
        const inp = e.target.closest('input'); if (!inp) return;
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault(); const val = inp.value.trim().replace(/,$/, ''); if (!val) return;
          const accent = box.dataset.accent === 'true'; const chip = document.createElement('span');
          chip.className = `chip2 ${accent ? '' : 'chip-neutral'}`; chip.innerHTML = `${esc(val)}<span class="x" data-rm>${X}</span>`;
          inp.before(chip); inp.value = ''; persist();
        }
      });
      box.addEventListener('click', (e) => { const rm = e.target.closest('.chip2 .x'); if (rm) { rm.closest('.chip2').remove(); persist(); } });
    });
    this.$$('.tgl[data-k]').forEach((tg) => tg.addEventListener('click', () => { const on = tg.classList.toggle('on'); tg.setAttribute('aria-checked', on); const cb = this.$(`input[data-key="${tg.dataset.k}"]`); if (cb) cb.checked = on; }));
    this.$$('[data-visswitch]').forEach((sw) => sw.querySelectorAll('.vs-opt').forEach((opt) => opt.addEventListener('click', () => {
      const vis = opt.dataset.vis; sw.dataset.active = vis;
      sw.querySelectorAll('.vs-opt').forEach((o) => o.classList.toggle('on', o.dataset.vis === vis));
      const h = this.$('input[data-key="visibility"]'); if (h) h.value = vis;
      const stub = this.$('[data-stubwrap]'); if (stub) stub.hidden = vis !== 'members';
    })));
    this.$$('[data-key="status"]').forEach((sel) => sel.addEventListener('change', () => this.syncStatusDots()));
    this.syncStatusDots();
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
      const wrap = this.$(`.fld[data-fkey="${f.key}"]`);
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
      if (this.fields.some((f) => f.key === 'status')) input.status = 'published'; // SOW-062 P6: status is action-driven (no rail dropdown)
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
      if (this.fields.some((f) => f.key === 'status')) input.status = 'draft'; // SOW-062 P6: status is action-driven (no rail dropdown)
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
