// <gbti-content-editor> row editors: the project links[] and gallery[] fields as structured rows, each serializing back
// into the hidden json input gather() reads, with the gallery reorder by drag or by arrow key. A class mixin composed
// onto GbtiElement in gbti-content-editor.mjs, so `this` is the editor. The methods moved here unchanged when the
// element crossed the 900-line limit (owner, 2026-09-30).

import { esc } from '../base.mjs';
import { detectLinkSource } from '../../../src/lib/project-page.mjs'; // sow-175: wordpress.org/github.com URL detection
import { galleryRowsFromValue, galleryValueFromRows, moveGalleryRow } from '../gallery.mjs'; // sow-268: gallery rows parse/serialize (round-trips a json field that a comma-join used to break) + P3 unique upload names
import { GRIP, IMG, PLUS, TRASH } from './editor-icons.mjs';

export const withEditorRows = (Base) => class extends Base {
  // SOW-062 P6: the project links[] editor. One row per link + an Add button + a hidden json input that gather()
  // reads (unchanged contract). _serializeLinks rebuilds the array on every edit, preserving each row's extra fields.
  _linksInner(f, value) {
    let links = [];
    try { links = Array.isArray(value) ? value : (typeof value === 'string' && value ? JSON.parse(value) : []); } catch { links = []; }
    const rows = links.map((l, i) => this._linkRowHtml(l, i)).join('');
    return `<label>Links <span class="hint">· buttons on the project page</span></label>
      <div class="linkrows" data-links>${rows}</div>
      <button class="ebtn addrow" type="button" data-addlink>${PLUS} Add link</button>
      <datalist id="lk-types">${['download', 'project', 'repository', 'github', 'website', 'docs', 'demo'].map((k) => `<option value="${k}"></option>`).join('')}</datalist>
      <input data-key="${f.key}" data-kind="json" type="hidden" value="${esc(JSON.stringify(links))}" />`;
  }

  _linkRowHtml(l = {}, i) {
    const { type, kind, url, label, visibility, ...extra } = l || {};
    const t = esc(type || kind || '');
    const vis = visibility === 'members' ? 'members' : 'public';
    return `<div class="linkrow" data-li="${i}" data-hadvis="${visibility != null ? '1' : '0'}" data-extra="${esc(JSON.stringify(extra))}">
      <div class="lr-top">
        <input class="inp lk-type" list="lk-types" placeholder="type" value="${t}" />
        <input class="inp lk-url" type="text" placeholder="https://" value="${esc(url || '')}" />
        <button class="lr-del" type="button" data-lrdel title="Remove">${TRASH}</button>
      </div>
      <div class="lr-bot">
        <input class="inp lk-label" type="text" placeholder="Button label" value="${esc(label || '')}" />
        <div class="lr-vis" data-lrvis>${['public', 'members'].map((x) => `<button type="button" data-vis="${x}" class="${vis === x ? 'on' : ''}">${x}</button>`).join('')}</div>
      </div>
    </div>`;
  }

  _serializeLinks() {
    const wrap = this.$('[data-links]');
    const hidden = this.$('[data-key="links"]');
    if (!wrap || !hidden) return;
    const links = [];
    wrap.querySelectorAll('.linkrow').forEach((row) => {
      const url = (row.querySelector('.lk-url')?.value || '').trim();
      if (!url) return; // an empty row is not a link
      let extra = {};
      try { extra = JSON.parse(row.dataset.extra || '{}'); } catch { extra = {}; }
      const type = (row.querySelector('.lk-type')?.value || '').trim();
      const label = (row.querySelector('.lk-label')?.value || '').trim();
      const vis = row.querySelector('.lr-vis button.on')?.dataset.vis || 'public';
      const link = {};
      if (type) link.type = type;
      link.url = url;
      if (label) link.label = label;
      // only emit visibility if the user chose members OR the original link carried it (keeps existing PRs clean)
      if (vis === 'members' || row.dataset.hadvis === '1') link.visibility = vis;
      Object.assign(link, extra); // preserve primary / encrypted / any other original field
      links.push(link);
    });
    hidden.value = JSON.stringify(links);
  }

  _wireLinks() {
    const wrap = this.$('[data-links]');
    if (!wrap) return;
    wrap.addEventListener('input', () => this._serializeLinks());
    wrap.addEventListener('click', (e) => {
      const del = e.target.closest('[data-lrdel]');
      if (del) { e.preventDefault(); del.closest('.linkrow')?.remove(); this._serializeLinks(); return; }
      const vb = e.target.closest('.lr-vis button');
      if (vb) { e.preventDefault(); vb.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === vb)); this._serializeLinks(); }
    });
    // sow-175: auto-detect a wordpress.org / github.com URL on blur (not `input`, so this fires once when
    // the author leaves the field rather than re-detecting on every keystroke of a paste). Type is set as a
    // real VALUE, since it is functional (it changes how the page treats the link); label is set only as a
    // PLACEHOLDER, never a value, so an untouched field still serializes as no override -- _serializeLinks()
    // already omits an empty label, and the published page's own linkLabel() default takes over from there.
    // Never overwrites a type or label the author already touched.
    wrap.addEventListener('blur', (e) => {
      const urlEl = e.target.closest?.('.lk-url');
      if (!urlEl) return;
      const row = urlEl.closest('.linkrow');
      const source = detectLinkSource(urlEl.value.trim());
      if (!source) return;
      const typeEl = row.querySelector('.lk-type');
      const labelEl = row.querySelector('.lk-label');
      if (typeEl && !typeEl.value.trim()) {
        typeEl.value = source === 'wordpress' ? 'download' : 'repository';
        this._serializeLinks();
      }
      if (labelEl && !labelEl.value.trim()) {
        labelEl.placeholder = source === 'wordpress' ? 'Download' : 'View on GitHub';
      }
    }, true); // capture: blur does not bubble
    this.$('[data-addlink]')?.addEventListener('click', (e) => {
      e.preventDefault();
      const tmp = document.createElement('div');
      tmp.innerHTML = this._linkRowHtml({}, wrap.children.length);
      const row = tmp.firstElementChild;
      if (row) { wrap.appendChild(row); this._serializeLinks(); row.querySelector('.lk-type')?.focus(); }
    });
  }

  // sow-268: the project gallery[] editor. One row per screenshot + an Add button + a hidden json input that
  // gather() reads (unchanged contract). Mirrors _linksInner: galleryValueFromRows rebuilds the array on every
  // edit, emitting a bare string for an uncaptioned row so the ten existing projects do not churn.
  _galleryInner(f, value) {
    const rows = galleryRowsFromValue(value);
    const rowsHtml = rows.map((r, i) => this._galleryRowHtml(r, i)).join('');
    return `<label>Gallery <span class="hint">· screenshots on the project page</span></label>
      <div class="galrows" data-gallery>${rowsHtml}</div>
      <div class="galactions">
        <button class="ebtn" type="button" data-galupload>${IMG} Upload screenshots</button>
        <button class="ebtn" type="button" data-galreuse>Reuse</button>
        <button class="ebtn addrow" type="button" data-addshot>${PLUS} Add by path</button>
        <span class="up-st" data-gal-st></span>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden data-galfile />
      <input data-key="${f.key}" data-kind="json" type="hidden" value="${esc(JSON.stringify(galleryValueFromRows(rows)))}" />`;
  }

  _galleryRowHtml(r = {}, i) {
    const src = String(r.src || '');
    const caption = String(r.caption || '');
    const thumb = src ? this.resolveCover(src) : '';
    return `<div class="galrow" data-gi="${i}">
      <div class="gr-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" />` : ''}</div>
      <div class="gr-fields">
        <input class="inp gr-src" type="text" placeholder="./images/shot.webp" value="${esc(src)}" />
        <input class="inp gr-cap" type="text" placeholder="Caption (optional)" value="${esc(caption)}" />
      </div>
      <div class="gr-ctl">
        <button class="gr-grip" type="button" data-grdrag draggable="true"
          title="Drag to reorder, or focus and use the arrow keys"
          aria-label="Reorder screenshot. Drag, or press the up and down arrow keys.">${GRIP}</button>
        <button class="lr-del" type="button" data-grdel title="Remove">${TRASH}</button>
      </div>
    </div>`;
  }

  _serializeGallery() {
    const wrap = this.$('[data-gallery]');
    const hidden = this.$('[data-key="gallery"]');
    if (!wrap || !hidden) return;
    const rows = [];
    wrap.querySelectorAll('.galrow').forEach((row) => {
      rows.push({
        src: row.querySelector('.gr-src')?.value || '',
        caption: row.querySelector('.gr-cap')?.value || '',
      });
    });
    hidden.value = JSON.stringify(galleryValueFromRows(rows));
  }

  // Repaint a row's thumbnail from its current path (used after an edit or a reorder, so the preview follows
  // the path). Cheap: resolveCover is a string transform, not a fetch.
  _refreshGalleryThumb(row) {
    const src = (row.querySelector('.gr-src')?.value || '').trim();
    const box = row.querySelector('.gr-thumb');
    if (box) box.innerHTML = src ? `<img src="${esc(this.resolveCover(src))}" alt="" />` : '';
  }

  _wireGallery() {
    const wrap = this.$('[data-gallery]');
    if (!wrap) return;
    wrap.addEventListener('input', (e) => {
      const srcEl = e.target.closest?.('.gr-src');
      if (srcEl) this._refreshGalleryThumb(srcEl.closest('.galrow'));
      this._serializeGallery();
    });
    wrap.addEventListener('click', (e) => {
      const del = e.target.closest('[data-grdel]');
      if (del) { e.preventDefault(); del.closest('.galrow')?.remove(); this._serializeGallery(); return; }
    });

    // sow-268: reordering. The owner chose DRAG HANDLES over the up/down buttons that shipped first, and the
    // consequence is not optional: buttons were keyboard-reachable for free and a drag target is not. So the
    // handle is ONE control serving both modalities. It is a real <button>, so it is tabbable and announced,
    // it carries draggable="true" for the pointer path, and ArrowUp/ArrowDown move the row while keeping
    // focus on it. Both paths funnel through the same pure moveGalleryRow, so they cannot drift apart.
    const galRows = () => Array.from(wrap.querySelectorAll('.galrow'));
    const applyOrder = (from, to, keepFocus) => {
      const before = galRows();
      const after = moveGalleryRow(before, from, to);
      if (after.every((r, i) => r === before[i])) return; // a no-op move: leave the DOM alone
      after.forEach((r) => wrap.appendChild(r)); // appendChild MOVES an existing node, so this reorders in place
      this._serializeGallery();
      // The moved row is the same DOM node, so focus follows it to its new position without a lookup.
      if (keepFocus) before[from]?.querySelector('[data-grdrag]')?.focus();
    };

    wrap.addEventListener('keydown', (e) => {
      const grip = e.target.closest?.('[data-grdrag]');
      if (!grip) return;
      const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      if (!dir) return;
      e.preventDefault(); // stop the rail scrolling under the author while they reorder
      const i = galRows().indexOf(grip.closest('.galrow'));
      if (i >= 0) applyOrder(i, i + dir, true);
    });

    let dragFrom = -1;
    wrap.addEventListener('dragstart', (e) => {
      const grip = e.target.closest?.('[data-grdrag]');
      if (!grip) return;
      const row = grip.closest('.galrow');
      dragFrom = galRows().indexOf(row);
      row?.classList.add('dragging');
      // Firefox refuses to start a drag unless data is set; the value is unused.
      try { e.dataTransfer.setData('text/plain', String(dragFrom)); e.dataTransfer.effectAllowed = 'move'; } catch {}
    });
    wrap.addEventListener('dragover', (e) => {
      if (dragFrom < 0) return;
      e.preventDefault(); // required, or the drop never fires
      const over = e.target.closest?.('.galrow');
      if (!over) return;
      const rows = galRows();
      const to = rows.indexOf(over);
      if (to < 0 || to === dragFrom) return;
      // Reorder live as the pointer passes, so the author sees the result rather than guessing at it.
      applyOrder(dragFrom, to, false);
      dragFrom = to;
    });
    const endDrag = () => {
      if (dragFrom < 0) return;
      wrap.querySelector('.galrow.dragging')?.classList.remove('dragging');
      dragFrom = -1;
      this._serializeGallery();
    };
    wrap.addEventListener('drop', (e) => { e.preventDefault(); endDrag(); });
    wrap.addEventListener('dragend', endDrag);
    this.$('[data-addshot]')?.addEventListener('click', (e) => {
      e.preventDefault();
      const tmp = document.createElement('div');
      tmp.innerHTML = this._galleryRowHtml({}, wrap.children.length);
      const row = tmp.firstElementChild;
      if (row) { wrap.appendChild(row); this._serializeGallery(); row.querySelector('.gr-src')?.focus(); }
    });
    // sow-268 Phase 3: upload N screenshots at once (one row per file). sow-165: "Reuse" pulls from the
    // member's own published images. Both feed the SAME row machinery above (a staged ./images/x path).
    const galFile = this.$('[data-galfile]');
    this.$('[data-galupload]')?.addEventListener('click', () => galFile?.click());
    galFile?.addEventListener('change', (e) => { const files = e.target.files; e.target.value = ''; this.doGalleryImages(files); });
    this.$('[data-galreuse]')?.addEventListener('click', (e) => this._openMediaPicker(e.currentTarget, { gallery: true }));
  }
};
