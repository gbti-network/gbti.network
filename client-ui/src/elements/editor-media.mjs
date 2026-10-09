// <gbti-content-editor> images: resolving a cover or body image to a preview URL, staging an uploaded file, reading
// staged images back after a reload, reusing an image from the member's own published items, and the cover control.
// A class mixin composed onto GbtiElement in gbti-content-editor.mjs, so `this` is the editor. The methods moved here
// unchanged when the element crossed the 900-line limit (owner, 2026-09-30).

import { esc } from '../base.mjs';
import { failHint } from '../workspace-core.mjs';
import { resolveContentAsset } from '../assets.mjs'; // SOW-062 P3 + sow-165: resolve a cover/body image path to a loadable preview URL
import { uniqueImageName } from '../gallery.mjs'; // sow-268: gallery rows parse/serialize (round-trips a json field that a comma-join used to break) + P3 unique upload names
import { MEDIA_INDEX_URL, mediaFor, filterMedia, reusePlan, authorFromItemPath } from '../media-picker.mjs'; // sow-165/sow-268: reuse an image from the member's own published items into a frontmatter field or a gallery row
import { loadStagedImages, referencedDraftImages } from '../../../src/lib/staged-images.mjs'; // a staged (uploaded, unpublished) image reads back from the Worker store, not from the CDN
import { imageClientFor } from '../prepared-editor.mjs'; // a saved listing reads its staged images from its own store
import { IMG } from './editor-icons.mjs';

export const withEditorMedia = (Base) => class extends Base {
  // SOW-062 P6: resolve a cover value to a VIEWABLE url for the rail preview. An absolute or already-optimized
  // (/_astro/) url passes through resolveAsset; a repo-relative `./images/x.webp` is served from the item's folder
  // from GitHub's raw host, sow-450 (the built site only serves the /_astro/-optimized variant, whose path the editor does
  // not have). This is why resolveAsset alone produced a broken `gbti.network/./images/...` url. Falls back safely.
  resolveCover(value) {
    // sow-165: a freshly-staged cover previews from its local data URL (the raw host 404s until the PR merges);
    // an already-committed value resolves against the item folder on the raw host.
    return (this._stagedSrc && this._stagedSrc[value]) || resolveContentAsset(value, this.itemPath);
  }

  /**
   * The draft this editor is editing, as the `<type>:<slug>` token the staged-image store scopes its keys by
   * (the SAME identity membership/member-drafts.mjs keys a draft record with). Without it in the key, two
   * unpublished drafts that both staged a `cover.png` overwrote each other and the wrong picture published.
   *
   * Read off the live controls rather than through gather(), which can THROW on a field that fails to coerce
   * (sow-268) and would turn a picked image into a dead control with no message. Null when there is no slug
   * yet, which the client refuses on: a draft with no permalink cannot be saved either.
   */
  get itemToken() {
    const slug = String(this._slugVal ?? (this.$('[data-key="slug"]')?.value || this.presetStr(this.preset?.input?.slug) || '')).trim();
    return this.type && slug ? `${this.type}:${slug}` : null;
  }

  // An image that is staged but not yet published exists ONLY in the Worker's staged store, so on a reload
  // resolveCover falls through to a raw-host URL for a file that is not on main: the broken thumbnail the
  // author sees after saving a draft. Refill _stagedSrc from the store, then repaint just the thumbs that
  // changed. Repainting in place rather than re-rendering, so an author who is already typing keeps their
  // caret. Fire-and-forget from render(): the form is fully usable while this is in flight.
  async _rehydrateStaged() {
    // Read the paths off the live controls rather than through gather(), which drops HIDDEN fields: a cover
    // sitting in a collapsed or conditionally hidden row is exactly the one an author would notice missing.
    const paths = [
      ...this.$$('[data-key][data-kind="image"]').map((el) => el.value),
      ...this.$$('.galrow .gr-src').map((el) => el.value),
      ...referencedDraftImages(this.preset?.input || {}, this.$('#body')?.value || ''),
    ];
    const item = this.itemToken;
    const found = await loadStagedImages(paths, (name) => imageClientFor(this)?.getStagedImage?.(name, item), this._stagedSrc || {}); // sow-427: a saved listing also reads its own store
    if (!Object.keys(found).length) return;
    Object.assign((this._stagedSrc ||= {}), found);
    this.$$('[data-cover]').forEach((c) => {
      const val = c.querySelector('[data-key][data-kind="image"]')?.value || '';
      const cf = found[val] && c.querySelector('[data-coverframe]');
      if (cf) cf.innerHTML = this._coverFrameInner(this.resolveCover(val));
    });
    this.$$('.galrow').forEach((row) => this._refreshGalleryThumb(row));
  }

  // sow-268 Phase 3: append one gallery row per uploaded file. Sequential (await each stage) so the website
  // host's /membership/draft-image PUTs do not race and one failure does not abort the rest. Each file gets a
  // SESSION-UNIQUE name (uniqueImageName) because stageImage uses the filename verbatim, so two files both named
  // image.png would otherwise collide onto one ./images/image.png. The just-staged bytes preview from the local
  // data URL keyed by the stored path (resolveCover reads _stagedSrc first; a raw-host URL 404s until merge).
  async doGalleryImages(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const wrap = this.$('[data-gallery]');
    if (!wrap) return;
    const st = this.$('[data-gal-st]');
    const taken = this._galleryTakenNames();
    let added = 0; let failed = 0;
    for (const file of files) {
      if (st) st.textContent = `Uploading ${added + failed + 1} of ${files.length}...`;
      try {
        const dataUrl = await fileToDataUrl(file);
        const filename = uniqueImageName(file.name, taken);
        taken.add(filename);
        const res = await this.client.stageImage({ filename, dataBase64: dataUrl.split(',')[1] || '', itemPath: this.itemPath, item: this.itemToken });
        (this._stagedSrc ||= {})[res.path] = dataUrl;
        this._appendGalleryRow(wrap, res.path);
        added += 1;
      } catch (err) {
        failed += 1;
        const h = failHint(err); // SOW-072 P3: consistent failure copy across every composer
        if (st) st.textContent = h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text;
      }
    }
    this._serializeGallery();
    if (st && !failed) st.textContent = added ? `Added ${added} screenshot${added === 1 ? '' : 's'}.` : '';
  }

  // The bare filenames already in play this session: every current row's basename plus (the caller adds) the
  // names staged in this batch. uniqueImageName suffixes against this so an upload never overwrites a sibling.
  _galleryTakenNames() {
    const wrap = this.$('[data-gallery]');
    const set = new Set();
    wrap?.querySelectorAll('.gr-src').forEach((inp) => {
      const base = String(inp.value || '').split('/').pop();
      if (base) set.add(base);
    });
    return set;
  }

  // Append a gallery row for a staged/reused path and serialize. Shared by upload + reuse so the row shape and
  // the thumbnail-from-_stagedSrc path stay in one place.
  _appendGalleryRow(wrap, src) {
    const tmp = document.createElement('div');
    tmp.innerHTML = this._galleryRowHtml({ src }, wrap.children.length);
    const row = tmp.firstElementChild;
    if (row) wrap.appendChild(row);
  }

  // --- sow-165: reuse an existing image (the member's own published items) into a FIELD or a gallery row ---
  // Ported from gbti-doc-editor's picker; the only difference is the destination (a frontmatter field or a new
  // gallery row rather than a body block). The media index is a public build artifact (no token, CORS *), so a
  // failure here is a missing picker, never a broken editor: every path fail-softs to an empty grid with a reason.
  async _loadMediaIndex() {
    if (this._mediaRows) return this._mediaRows;
    // The item's own folder identifies its owner, the same key the index groups by. A brand-new item (no path
    // yet) or a house item yields no owner, so reuse is unavailable there (upload + Add by path still work).
    const me = (typeof this.author === 'string' && this.author) || authorFromItemPath(this.itemPath);
    if (!me) { this._mediaErr = 'Reuse is available on your own items.'; return (this._mediaRows = []); }
    try {
      const res = await fetch(MEDIA_INDEX_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      this._mediaRows = mediaFor(await res.json(), me);
      if (!this._mediaRows.length) this._mediaErr = 'No images yet. Images appear here once an item using them is published.';
    } catch {
      this._mediaRows = [];
      this._mediaErr = 'Could not load your image library.';
    }
    return this._mediaRows;
  }

  // Open the reuse grid anchored under the button that invoked it. `dest` is { cover: <control> } for a
  // frontmatter image field, or { gallery: true } for a new gallery row.
  async _openMediaPicker(btn, dest) {
    this._closeMediaPicker();
    const anchor = btn?.closest?.('.cover') || btn?.closest?.('.galactions') || btn?.parentElement;
    if (!anchor) return;
    const pop = document.createElement('div');
    pop.className = 'media-pop';
    pop.innerHTML = '<div class="media-load">Loading your images...</div>';
    anchor.appendChild(pop);
    this._mediaPop = pop;

    const rows = await this._loadMediaIndex();
    if (this._mediaPop !== pop) return; // closed while loading
    const draw = (q) => {
      const shown = filterMedia(rows, q);
      const grid = pop.querySelector('.media-grid');
      if (!grid) return;
      grid.innerHTML = shown.length
        ? shown.map((r, i) => {
          const plan = reusePlan(r, this.itemPath);
          return `<button type="button" class="media-cell" data-mi="${i}" title="${esc(r.name)} (from ${esc(r.itemTitle || r.slug || '')})">`
            + `<img src="${esc(plan?.sourceUrl || '')}" alt="" loading="lazy" /><span>${esc(r.name)}</span></button>`;
        }).join('')
        : `<div class="media-load">${esc(rows.length ? 'Nothing matches that.' : (this._mediaErr || 'No images.'))}</div>`;
      grid.querySelectorAll('[data-mi]').forEach((cell) => {
        cell.addEventListener('click', () => { const rec = shown[Number(cell.dataset.mi)]; this._closeMediaPicker(); this._reuseImage(rec, dest); });
        cell.querySelector('img')?.addEventListener('error', (e) => { e.target.style.display = 'none'; });
      });
    };
    pop.innerHTML = '<input class="media-q" type="search" placeholder="Search your images" aria-label="Search your images" /><div class="media-grid"></div>';
    const q = pop.querySelector('.media-q');
    q?.addEventListener('input', () => draw(q.value));
    draw('');
    q?.focus();
    this._onMediaEsc = (e) => { if (e.key === 'Escape') this._closeMediaPicker(); };
    document.addEventListener('keydown', this._onMediaEsc);
  }

  _closeMediaPicker() {
    this._mediaPop?.remove();
    this._mediaPop = null;
    if (this._onMediaEsc) { document.removeEventListener('keydown', this._onMediaEsc); this._onMediaEsc = null; }
  }

  // Selecting a row COPIES the file into the item being edited, through the same client.stageImage the upload
  // path uses, so co-location and the publish flush stay in one place. The copy fetches the source bytes and
  // re-stages them AS-IS (btoa of the raw arrayBuffer, no canvas round-trip), so a repeated reuse never degrades
  // the image (sow-290 intake). An image already in THIS item needs no copy: re-staging a byte-identical file
  // over itself would look like it worked while doing nothing on a name-deduplicating host.
  async _reuseImage(record, dest) {
    const plan = reusePlan(record, this.itemPath);
    if (!plan) return;
    const st = dest?.cover ? dest.cover.querySelector('[data-cover-st]') : this.$('[data-gal-st]');
    let path = plan.ref;
    if (!plan.alreadyHere) {
      if (!this.client?.stageImage) { if (st) st.textContent = 'Reuse is not available in this client'; return; }
      if (st) st.textContent = 'Copying...';
      try {
        const res = await fetch(plan.sourceUrl);
        if (!res.ok) throw new Error(String(res.status));
        const buf = new Uint8Array(await res.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
        const name = dest?.gallery ? uniqueImageName(plan.name, this._galleryTakenNames()) : plan.name;
        const out = await this.client.stageImage({ filename: name, dataBase64: btoa(bin), itemPath: this.itemPath, item: this.itemToken });
        path = out.path;
      } catch {
        if (st) st.textContent = 'Could not copy that image';
        return;
      }
    }
    // Preview the reused image from its live source URL keyed by the stored path (the bytes are identical, and
    // resolveCover reads _stagedSrc first, so the thumbnail shows before the copy PR merges).
    (this._stagedSrc ||= {})[path] = plan.sourceUrl;
    if (dest?.gallery) {
      const wrap = this.$('[data-gallery]');
      if (wrap) { this._appendGalleryRow(wrap, path); this._serializeGallery(); }
      if (st) st.textContent = 'Added.';
    } else if (dest?.cover) {
      this._setCoverField(dest.cover, path, plan.sourceUrl);
      if (st) st.textContent = '';
    }
  }

  // Put a reused/staged image path into a frontmatter image control: the hidden field, the reframable preview,
  // the Remove button + the "Replace image" label, and clear any mutually-exclusive banner swatch. Mirrors the
  // tail of doCoverImage so reuse and upload leave the control in the same state.
  _setCoverField(control, path, previewUrl) {
    if (!control) return;
    const cf = control.querySelector('[data-coverframe]');
    if (cf) { cf.innerHTML = '<img data-cimg alt="" />'; const img = cf.querySelector('[data-cimg]'); if (img) img.src = previewUrl || this.resolveCover(path); }
    control.querySelector('[data-cover-clear]')?.removeAttribute('hidden');
    const pick = control.querySelector('[data-cover-pick]');
    if (pick) pick.textContent = 'Replace image';
    const el = control.querySelector('[data-key][data-kind="image"]');
    if (el) el.value = path;
    const swatches = control.querySelector('[data-swatches]');
    if (swatches) {
      swatches.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('on'));
      const presetInput = swatches.querySelector('[data-key="bannerPreset"]');
      if (presetInput) presetInput.value = '';
    }
  }

  async doImage(file) {
    if (!file) return;
    const dataBase64 = await fileToBase64(file);
    try {
      // sow-165: co-locate into the item folder so a dropped result image stores as ./images/x (native build).
      // itemPath is what the npm/extension host co-locates by; item is what the WEBSITE host scopes the staged
      // store by. Both hosts share this component, so both travel.
      const res = await this.client.stageImage({ filename: file.name, dataBase64, itemPath: this.itemPath, item: this.itemToken });
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

  // SOW-062 P6: the inner of the reframable cover preview -- the image (object-fit:cover) when set, else the
  // striped "no image yet" placeholder. Used by the initial render, doCoverImage, and clearCover.
  _coverFrameInner(url) {
    return url
      ? `<img data-cimg src="${esc(url)}" alt="" />`
      : `<div class="ph">${IMG}<span class="mono">no image yet</span></div>`;
  }

  // SOW-062 P3/P6: stage a picked cover image — drop it into the reframable preview immediately, then stage it and
  // put the returned repo path into the field's hidden input (gather() picks it up like any field).
  async doCoverImage(file, control) {
    if (!file || !control) return;
    const dataUrl = await fileToDataUrl(file);
    const cf = control.querySelector('[data-coverframe]');
    if (cf) { cf.innerHTML = '<img data-cimg alt="" />'; const img = cf.querySelector('[data-cimg]'); if (img) img.src = dataUrl; }
    control.querySelector('[data-cover-clear]')?.removeAttribute('hidden');
    const pick = control.querySelector('[data-cover-pick]');
    if (pick) pick.textContent = 'Replace image';
    try {
      // sow-165: co-locate into the item folder so the cover stores as the canonical ./images/x (the old
      // per-user path could not be resolved by Astro's image() and broke the site build).
      const res = await this.client.stageImage({ filename: file.name, dataBase64: dataUrl.split(',')[1] || '', itemPath: this.itemPath, item: this.itemToken });
      // Preview the just-staged cover from the local data URL keyed by the stored path; a full re-render
      // otherwise resolves it to a raw-host URL that 404s until the PR merges.
      (this._stagedSrc ||= {})[res.path] = dataUrl;
      // sow-174: scoped to data-kind="image" -- the banner control also holds a second [data-key] (the
      // bannerPreset swatch input), and a bare [data-key] would grab whichever comes first in DOM order.
      const el = control.querySelector('[data-key][data-kind="image"]');
      if (el) el.value = res.path;
      this.out(`Cover image staged: <code>${esc(res.path)}</code>`);
      // A picked file supersedes any chosen color preset (resolveHero() prefers an uploaded image either way,
      // but leaving a swatch marked "on" here would misrepresent which one is actually going to render).
      const swatches = control.querySelector('[data-swatches]');
      if (swatches) {
        swatches.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('on'));
        const presetInput = swatches.querySelector('[data-key="bannerPreset"]');
        if (presetInput) presetInput.value = '';
      }
    } catch (err) {
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
    }
  }

  clearCover(control) {
    if (!control) return;
    // sow-174: see the matching note in doCoverImage -- scoped so this never touches the sibling bannerPreset
    // hidden input when the banner control also carries the swatch row.
    const el = control.querySelector('[data-key][data-kind="image"]');
    if (el) el.value = '';
    const cf = control.querySelector('[data-coverframe]');
    if (cf) cf.innerHTML = this._coverFrameInner('');
    control.querySelector('[data-cover-clear]')?.setAttribute('hidden', '');
    const pick = control.querySelector('[data-cover-pick]');
    if (pick) pick.textContent = 'Choose image';
  }
};

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
