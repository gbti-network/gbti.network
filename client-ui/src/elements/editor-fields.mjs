// <gbti-content-editor> rail fields: the markup for each form field (fieldHtml), the rail controls that write back into
// their hidden [data-key] inputs, the permalink field, conditional fields (showIf) and gather(). A class mixin composed
// onto GbtiElement in gbti-content-editor.mjs, so `this` is the editor. The methods moved here unchanged when the
// element crossed the 900-line limit (owner, 2026-09-30).

import { esc } from '../base.mjs';
import { SLUG_MAX } from '../../../membership/item-id.mjs'; // sow-354
import { audienceControl } from '../one-click-public-core.mjs'; // sow-293, sow-323
import { gatherInput } from '../form.mjs';
import { categoryFieldHtml } from '../category-picker-core.mjs'; // sow-227: that field's markup + the hidden input gather() reads
import { skillFileFrom } from '../editor-skill.mjs'; // sow-109: prompt or skill
import { BANNER_PRESETS } from '../../../src/lib/banner-presets.mjs'; // sow-174: the curated banner-color swatches
import { GLOBE, LOCK, INFO, X } from './editor-icons.mjs';

const TYPE_LABEL = { post: 'Article', project: 'Project', prompt: 'Prompt', profile: 'Profile' };

export const withEditorFields = (Base) => class extends Base {
  fieldHtml(f, value, visible = true) {
    // A Date must be handled BEFORE the generic object branch. YAML parses an unquoted `publishedAt: 2025-06-23`
    // into a Date, and `typeof aDate === 'object'`, so it used to fall through to JSON.stringify and render as
    // `"2025-06-23T00:00:00.000Z"` WITH the quote characters. Reading that back gives Invalid Date, and since
    // publishedAt is a preserved hidden field, saving ANY item with a YAML-dated frontmatter failed with
    // "invalid post: publishedAt: Invalid input" and no way for the author to see or fix the offending value.
    // 46 published posts carry that shape. ISO date-only matches fmtD's convention in this file and round-trips
    // cleanly, unlike String(date), which renders a UTC date in local time ("Jun 22" for a Jun 23 post).
    const v = value == null ? ''
      : Array.isArray(value) ? value.join(', ')
      : value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10))
      : typeof value === 'object' ? JSON.stringify(value)
      : String(value);
    const label = `<label>${esc(f.label || f.key)}${f.required ? ' <span class="req">*</span>' : ''}${f.hint ? ` <span class="hint">· ${esc(f.hint)}</span>` : ''}</label>`;
    const wrap = (inner, cls = '') => `<div class="fld${cls ? ' ' + cls : ''}" data-fkey="${f.key}"${visible ? '' : ' hidden'}>${inner}</div>`;

    // SOW-062 P6: visibility -> segmented switch + optional public-stub sub-block (publicStub is folded in here).
    if (f.kind === 'enum' && f.key === 'visibility') {
      // sow-323: the audience is a superadmin's decision now, so most authors do not get a free switch. The
      // decision is a pure function (audienceControl) because it has a case that loses an author their live
      // page if it is wrong: an ALREADY public item must keep submitting `visibility: public`, or the author's
      // own edit takes it down. The Worker agrees with this; see pathsNeedingApproval and approvedOnMain.
      const aud = audienceControl({
        paidTier: this._paidTier,
        isSuperadmin: this._isSuperadmin === true,
        currentVisibility: v,
        existing: !!this.itemPath,
      });
      const isMembers = aud.value === 'members';
      const stubField = this.fields.find((x) => x.key === 'publicStub');
      const stubOn = this._presetBool('publicStub');
      if (aud.mode !== 'switch') {
        const icon = isMembers ? LOCK : GLOBE;
        const word = isMembers ? 'Members only' : 'Public';
        return `<div class="fld visfield" data-fkey="visibility"${visible ? '' : ' hidden'}><label>Audience</label>
          <div class="vislocked" data-vislocked>${icon} <b>${word}</b></div>
          <input data-key="visibility" data-kind="enum" type="hidden" value="${esc(aud.value)}" />
          ${stubField && aud.publicStub === true ? '<input data-key="publicStub" data-kind="boolean" type="checkbox" checked hidden />' : ''}
          <div class="infobox">${INFO}<div>${esc(aud.note)}</div></div>
          <p class="urlprev"><a href="https://gbti.network/submit-content/" target="_blank" rel="noopener">How publishing works</a></p></div>`;
      }
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
    // sow-174: gallery layout -> three illustrated cards (Auto / Grid / Carousel) instead of a bare select,
    // matching the design mock's own live toggle. "Auto" is an empty value: the hidden input's default
    // coercion (form.mjs) already turns '' into undefined on submit, which is exactly what resolveGalleryStyle()
    // needs to fall back to picking by shot count -- no new gather/coerce path for this field.
    if (f.kind === 'enum' && f.key === 'galleryStyle') {
      const cards = [
        { key: '', name: 'Auto', desc: 'Picks a layout by shot count', shape: '' },
        { key: 'grid', name: 'Grid', desc: 'Captioned, 2-up', shape: '<span class="gs-tile"></span><span class="gs-tile"></span>' },
        { key: 'carousel', name: 'Carousel', desc: 'One large frame + a filmstrip', shape: '<span class="gs-frame"></span><span class="gs-strip"><i></i><i></i><i></i></span>' },
      ];
      const cur = v || '';
      const cardsHtml = cards.map((c) => `<button type="button" class="gs-card${c.key === cur ? ' on' : ''}" data-gs="${c.key}">
        <span class="gs-shape">${c.shape}</span><span class="gs-name">${esc(c.name)}</span><span class="gs-desc">${esc(c.desc)}</span></button>`).join('');
      return wrap(`${label}<div class="gs-cards" data-gscards>${cardsHtml}<input data-key="${f.key}" data-kind="enum" type="hidden" value="${esc(cur)}" /></div>`);
    }
    // sow-179: article layout -> illustrated cards, the same pattern as the galleryStyle picker above
    // (reuses its .gs-* CSS and the generic [data-gscards] click handler as-is, no new wiring needed).
    // Unlike galleryStyle there is no "Auto" option: the choice is real and always on.
    //
    // sow-326: Editorial is GONE as an option (owner, 2026-09-12), and the highlighted fallback is now
    // journal. The two used to disagree: an item with no layout showed Editorial highlighted while
    // [slug].astro rendered journal, so publishing an untouched draft silently WROTE layout: editorial.
    if (f.kind === 'enum' && f.key === 'layout') {
      const cards = [
        { key: 'journal', name: 'Journal', desc: 'Sticky rail beside one reading column', shape: '<span class="gs-tile" style="flex:0 0 26%"></span><span class="gs-tile"></span>' },
        { key: 'card', name: 'Card', desc: 'Centered card, no rail', shape: '<span class="gs-tile" style="flex:0 0 62%;margin:0 auto"></span>' },
      ];
      const cur = v === 'card' ? 'card' : 'journal';
      const cardsHtml = cards.map((c) => `<button type="button" class="gs-card${c.key === cur ? ' on' : ''}" data-gs="${c.key}">
        <span class="gs-shape">${c.shape}</span><span class="gs-name">${esc(c.name)}</span><span class="gs-desc">${esc(c.desc)}</span></button>`).join('');
      return wrap(`${label}<div class="gs-cards" data-gscards>${cardsHtml}<input data-key="${f.key}" data-kind="enum" type="hidden" value="${esc(cur)}" /></div>`);
    }
    // Project sidebar position -> two illustrated cards (Left / Right), same pattern as the article-layout
    // picker above (reuses its .gs-* CSS and the generic [data-gscards] click handler as-is).
    if (f.kind === 'enum' && f.key === 'sidebarPosition') {
      const cards = [
        { key: 'left', name: 'Left', desc: 'Contents rail beside the left edge', shape: '<span class="gs-tile" style="flex:0 0 26%"></span><span class="gs-tile"></span>' },
        { key: 'right', name: 'Right', desc: 'Contents rail beside the right edge', shape: '<span class="gs-tile"></span><span class="gs-tile" style="flex:0 0 26%"></span>' },
      ];
      const cur = v || 'right';
      const cardsHtml = cards.map((c) => `<button type="button" class="gs-card${c.key === cur ? ' on' : ''}" data-gs="${c.key}">
        <span class="gs-shape">${c.shape}</span><span class="gs-name">${esc(c.name)}</span><span class="gs-desc">${esc(c.desc)}</span></button>`).join('');
      return wrap(`${label}<div class="gs-cards" data-gscards>${cardsHtml}<input data-key="${f.key}" data-kind="enum" type="hidden" value="${esc(cur)}" /></div>`);
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
      if (f.key === 'categories') return wrap(`${label}${categoryFieldHtml(arr)}`); // sow-227: one path, from the tree
      const accent = f.key !== 'tags';
      const chips = arr.map((c) => `<span class="chip2 ${accent ? '' : 'chip-neutral'}">${esc(c)}<span class="x" data-rm>${X}</span></span>`).join('');
      return wrap(`${label}<div class="chips" data-chips="${f.key}" data-accent="${accent}">${chips}<input type="text" placeholder="${esc(f.placeholder || 'Add…')}"></div><input data-key="${f.key}" data-kind="array" type="hidden" value="${esc(arr.join(', '))}" />`);
    }
    // image / cover (current control; the reframe is deferred to rail-2)
    if (f.kind === 'image') {
      const url = v ? this.resolveCover(v) : '';
      const has = !!url;
      // A field that declares its own aspect (project icon 1:1, featured 16:10, banner 3:1) locks the preview
      // to it: the old shared 4:3/Hero toggle matched none of them, so an icon stretched into a 4:3 box and a
      // 16:10 cover showed letterbox bars. Fields with no declared frame keep the toggle.
      const framed = typeof f.frame === 'string' && f.frame.includes('/');
      const frameStyle = framed ? ` style="aspect-ratio:${esc(f.frame)}${f.previewPx ? `;max-width:${Number(f.previewPx)}px` : ''}"` : '';
      const picker = framed
        ? ''
        : '<div class="framepick"><button type="button" class="on" data-frame="card4">4:3 card</button><button type="button" data-frame="hero">Hero</button></div>';
      const hint = f.hint ? `<div class="urlprev" style="color:var(--s-fg-soft)">${esc(f.hint)}</div>` : '';
      // sow-174: the banner field alone also offers a curated color preset, an alternative to uploading an
      // image (resolveHero() in project-page.mjs treats an uploaded image and a chosen preset as mutually
      // exclusive). bannerPreset is not its own row -- it is excluded from RAIL_SCHEMA and hiddenFields both,
      // and folded in here exactly like publicStub is folded into the visibility field above.
      const presetVal = f.key === 'banner' ? String(this.preset?.input?.bannerPreset || '') : '';
      const swatchesHtml = f.key === 'banner' ? `<div class="swatchrow" data-swatches>${BANNER_PRESETS.map((p) =>
        `<button type="button" class="swatch${p.key === presetVal ? ' on' : ''}" data-preset="${p.key}" title="${esc(p.label)}">
          <span class="sw-dot" style="background:linear-gradient(150deg,${p.from},${p.to})"></span>${esc(p.label)}</button>`).join('')}
        <input data-key="bannerPreset" data-kind="enum" type="hidden" value="${esc(presetVal)}" /></div>` : '';
      return `<div class="fld cover-field" data-fkey="${f.key}"${visible ? '' : ' hidden'}>${label}${hint}
        <div class="cover" data-cover>
          ${picker}
          <div class="coverframe${framed ? '' : ' card4'}" data-coverframe${frameStyle}>${this._coverFrameInner(url)}</div>
          <input type="file" accept="image/*" hidden data-cover-file />
          <div class="coverbtns"><button type="button" class="ebtn" data-cover-pick>${has ? 'Replace image' : 'Choose image'}</button><button type="button" class="ebtn" data-cover-reuse>Reuse</button><button type="button" class="ebtn" data-cover-clear${has ? '' : ' hidden'}>Remove</button><span class="up-st" data-cover-st></span></div>
          ${swatchesHtml ? `<div class="swatch-or">or pick a color</div>${swatchesHtml}` : ''}
          <input data-key="${f.key}" data-kind="image" type="hidden" value="${esc(v)}" />
        </div></div>`;
    }
    // SOW-062 P6: the project links[] editor -> structured rows (was a raw JSON textarea). The rows serialize back
    // into the SAME hidden [data-key="links"] json input gather() reads, and each row preserves its original extra
    // fields (primary, encrypted, ...) so the round-trip never drops data.
    if (f.kind === 'json' && f.key === 'links') {
      return wrap(this._linksInner(f, value));
    }
    // sow-268: the project gallery[] editor -> structured rows (was a raw JSON textarea that could not
    // round-trip: an array value renders comma-joined at line ~773, and coerceValue('json') then JSON.parse'd
    // that string and threw, so every project with screenshots was unsaveable and Preview was a dead button).
    // Same shape as links: rows serialize into the SAME hidden [data-key="gallery"] json input gather() reads.
    if (f.kind === 'json' && f.key === 'gallery') {
      return wrap(this._galleryInner(f, value));
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
    this.$('[data-cat-picker]')?.addEventListener('change', (e) => { const h = this.$('input[data-key="categories"]'); if (h) h.value = (e.detail?.path || []).join(', '); this._markDirty(); });
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
    const skillFile = this.type === 'prompt' ? skillFileFrom(this.root) : undefined; // sow-109: a skill's SKILL.md
    return { type: this.type, input: gatherInput(visible, this.rawGetter()), body: this.$('#body')?.value ?? '', ...(skillFile !== undefined ? { skillFile } : {}) };
  }

  // SOW-112 v2 (owner-directed): the permalink is a NORMAL editable field in the Details rail, above Short
  // description. Changing it stages like any other edit (Save draft), and the actual rename (move + redirect)
  // happens at the PUBLISH event — no separate rename action, no dialogs.
  permalinkFieldHtml() {
    const typePath = ({ post: 'articles', project: 'projects', product: 'projects', prompt: 'prompts' })[this.type] || this.type;
    const loaded = this.presetStr(this.preset?.input?.slug) || '';
    const existing = Boolean(this.itemPath);
    const val = this._slugVal ?? loaded;
    const note = existing && val && val !== loaded
      ? `<div class="urlprev">/${esc(typePath)}/${esc(loaded)}/ becomes /${esc(typePath)}/${esc(val)}/ when you publish. The old link redirects, and the discussion, saves, and counts follow.</div>`
      : existing ? `<div class="urlprev">Changing the permalink renames this item when you publish; the old link will redirect.</div>` : '';
    return `<div class="fld"><label>Permalink</label><div class="slugrow"><span class="slugpre">${esc(typePath)}/</span><input id="slugfield" type="text" spellcheck="false" maxlength="${SLUG_MAX}" value="${esc(val)}" /></div>${note}</div>`;
  }

  _wirePermalinkField() {
    const input = this.$('#slugfield');
    if (!input) return;
    const typePath = ({ post: 'articles', project: 'projects', product: 'projects', prompt: 'prompts' })[this.type] || this.type;
    const loaded = this.presetStr(this.preset?.input?.slug) || '';
    input.addEventListener('input', () => {
      const v = String(input.value || '').trim().toLowerCase();
      this._slugVal = v;
      // Mirror into the hidden gather() input + the inline display (the same live mirror on new and existing).
      const mirror = this.$('[data-key="slug"]');
      if (mirror) mirror.value = v;
      const inline = this.root?.querySelector('.doc-slug .slug-val');
      if (inline) inline.textContent = v;
      // The note switches to the concrete old -> new URLs while the value differs from the loaded slug.
      const note = input.closest('.fld')?.querySelector('.urlprev');
      if (note && this.itemPath) {
        note.textContent = v && v !== loaded
          ? `/${typePath}/${loaded}/ becomes /${typePath}/${v}/ when you publish. The old link redirects, and the discussion, saves, and counts follow.`
          : 'Changing the permalink renames this item when you publish; the old link will redirect.';
      }
    });
  }
};

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
