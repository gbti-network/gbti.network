// <gbti-cta-manager> (sow-281, redesigned in sow-337): the SUPERADMIN manager of the call-to-action cards
// (house/ctas.yml), built to the approved design. A list with a thumbnail of each card, and an editor with the layout
// picker, the words and link, the image (re-encoded in the browser, cta-image-encode.mjs), the button icon (searched
// from the site's icon library, cta-icon-library.mjs), the HTML block with its outside addresses, the pages the card
// shows on, and a live preview in light and dark, sidebar and phone. The registry is superadmin-pinned in CODEOWNERS
// and the Worker ops carry ROLE_RANK.superadmin, so this surface is UX, not the boundary.
//
// One save is one pull request: the editor sends every changed field (items and enabled included) in a single add
// or update, so two open edits never race each other on the same file. The list's Enable and Disable are their own
// small edit.
//
// It reads the live registry through the client (client.ctaPool) and the built /ctas.json for the pages a card can go
// on and the titles of the ones it is on. A failed load is its own state (sow-334): it shows the failure and a Try
// again button and does NOT retry on its own. Pure logic lives in cta-manager-core.mjs and markup in
// cta-manager-view.mjs; this file holds state and events.
import { GbtiElement, define } from '../base.mjs';
import { CTA_CARD_CSS } from '../../../membership/cta-card-render.mjs';
import { ctaImageUrl } from '../../../src/lib/ctas.mjs';
import { draftFromCta, blankDraft, cardFromDraft, validateDraft, savePayload, normalizeHost, foundHosts, pagesFromBuilt, pageCandidates, previewNote, plural } from '../cta-manager-core.mjs';
import { loadingView, failedView, listView, editorView, editTitle, shownError, imageBody, iconResults, foundLine, candidateList, previewCard } from '../cta-manager-view.mjs';
import { cardClicksLine } from '../outbound-manager-core.mjs'; // sow-359: a tracked card's click history
import { encodeCtaImage } from '../cta-image-encode.mjs';
import { createIconLibrary } from '../cta-icon-library.mjs';
import { CTA_MANAGER_CSS } from './cta-manager-css.mjs';

const SITE = 'https://gbti.network';
const SUBMITTED = 'Submitted. It merges automatically and appears shortly. Track it in your WorkBench.';
const FIELD_KEYS = ['id', 'label', 'partner', 'line', 'button', 'destination', 'image', 'html'];

class GbtiCtaManager extends GbtiElement {
  constructor() {
    super();
    this._status = 'idle'; // idle | loading | failed | ready
    this._view = 'list';
    this._st = null;
    if (this.root) this._listen();
  }

  // The client-ready race (see gbti-quote-manager): the element sits in static admin markup and upgrades before the
  // client is injected, so render() starts the load when the client arrives, never connectedCallback.
  connectedCallback() { super.connectedCallback?.(); }

  /** Where the site's files are read from: the page's own origin when the page says so, else production. */
  get site() {
    const o = this.dataset?.siteOrigin;
    if (o === 'page' && typeof location !== 'undefined') return location.origin;
    return SITE;
  }

  get icons() {
    if (!this._icons) this._icons = createIconLibrary({ base: this.site });
    return this._icons;
  }

  // An open editor with unsaved typing declines the client-broadcast re-render (sow-326), which would rebuild it.
  skipClientRender() { return this._view === 'edit' && this._status === 'ready'; }

  async load() {
    if (!this.client) { this.render(); return; }
    this._status = 'loading';
    this.render();
    try {
      const [pool, built, clicks] = await Promise.all([
        this.client.ctaPool(),
        fetch(`${this.site}/ctas.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`ctas.json ${r.status}`); return r.json(); }),
        // sow-359: a card that points at a tracked link is already counted per path by the daily rollup, so
        // its clicks come from the same public artifact the link board reads. It must NOT fail the load: the
        // manager's job is editing cards, and a missing click history is a missing line, not a broken page.
        fetch(`${this.site}/outbound-clicks.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      this._clicks = clicks && typeof clicks === 'object'
        ? { coverage: Array.isArray(clicks.coverage) ? clicks.coverage : [], clicks: clicks.clicks && typeof clicks.clicks === 'object' ? clicks.clicks : {} }
        : { coverage: [], clicks: {} };
      this._ctas = Array.isArray(pool?.ctas) ? pool.ctas : [];
      this._built = new Map((Array.isArray(built?.ctas) ? built.ctas : []).map((c) => [c.id, c]));
      this._pages = pagesFromBuilt(built);
      this._status = 'ready';
    } catch (e) {
      this._status = 'failed';
      this._problem = e?.message || 'unknown error';
    }
    this.render();
  }

  _imageUrl(file) {
    const path = ctaImageUrl(file);
    return path ? `${this.site}${path}` : null;
  }

  /** A card's page title: the public page list, then the built registry's resolution, then the reference itself. */
  _titleOf(ctaId, it) {
    const page = (this._pages || []).find((p) => p.type === it.type && p.ref === it.ref);
    if (page) return page.title;
    const hit = (this._built?.get(ctaId)?.items || []).find((x) => x.type === it.type && x.ref === it.ref);
    return hit?.title || it.ref;
  }

  render() {
    if (!this.client) { this.set(this.css(CTA_MANAGER_CSS) + '<p class="muted">Open in the GBTI client (superadmin) to manage call-to-actions.</p>'); return; }
    if (this._status === 'failed') { this._paint(failedView(this._problem)); return; }
    if (this._status !== 'ready') { if (this._status === 'idle') this.load(); else this._paint(loadingView()); return; }
    if (this._view === 'edit' && this._st) { this._paint(editorView(this._st, foundHosts(this._st.d.html, this._st.d.hosts))); this._afterEditorPaint(); return; }
    const rows = this._ctas.map((c) => ({ cta: c, image: typeof c.image === 'string' ? { url: this._imageUrl(c.image) } : null, busy: this._busyId === c.id, clicks: cardClicksLine(c, this._clicks) })); // sow-359: the tracked link's clicks, when the card has one
    this._paint(listView({ rows, msg: this._listMsg, msgBad: this._listBad }));
  }

  _paint(markup) { this.set(this.css(CTA_MANAGER_CSS + CTA_CARD_CSS) + markup); }

  // ---- list -------------------------------------------------------------------------------------------------------

  async _toggle(id) {
    const c = this._ctas.find((x) => x.id === id);
    if (!c || this._busyId) return;
    const enabled = c.enabled !== true;
    this._busyId = id; this._listMsg = ''; this.render();
    try {
      const r = await this.client.setCtaEnabled({ id, enabled });
      c.enabled = enabled;
      this._listMsg = r?.noop ? `${c.label} is already ${enabled ? 'enabled' : 'disabled'}.` : `${enabled ? 'Enabled' : 'Disabled'} ${c.label}. Submitted. It merges automatically and appears shortly.`;
      this._listBad = false;
    } catch (e) {
      this._listMsg = e?.message || 'That change failed.'; this._listBad = true;
    }
    this._busyId = null;
    this.render();
  }

  // ---- editor state -----------------------------------------------------------------------------------------------

  _open(c) {
    const isNew = !c;
    const d = isNew ? blankDraft() : draftFromCta(c, { imageUrl: typeof c.image === 'string' ? this._imageUrl(c.image) : null });
    this._st = {
      d, isNew, original: isNew ? null : structuredClone(c), tried: false, saving: false, msg: '', msgKind: '',
      pickerOpen: false, iconQuery: '', iconSet: '', icons: { status: 'idle', total: 0, results: [], sets: [] },
      hostDraft: '', hostErr: '', pageQuery: '', cands: [], drag: false, imageMsg: '', imageWork: false, pvDark: false, pvPhone: false,
      titleOf: (it) => this._titleOf(d.id, it),
    };
    this._revalidate();
    this._view = 'edit'; this._listMsg = '';
    this.render();
  }

  _back() { this._view = 'list'; this._st = null; this.render(); }

  _revalidate() {
    const st = this._st;
    st.v = validateDraft(st.d, { isNew: st.isNew, taken: new Set(this._ctas.map((c) => c.id)) });
    // A refused save's banner follows the fields: it names what is still wrong, and goes once nothing is.
    if (st.msgKind === 'err' && st.tried && !st.saving) {
      st.msg = st.v.ok ? '' : Object.keys(st.v.errors).length ? 'Fix the highlighted fields to save.' : st.v.banner;
      if (!st.msg) st.msgKind = '';
    }
  }

  /** Any edit clears a sent or failed save's message (the draft now differs from what was sent), then revalidates. */
  _touched() {
    const st = this._st;
    if (st.msg && st.msgKind !== 'err') { st.msg = ''; st.msgKind = ''; }
    this._revalidate();
  }

  /** Redraw only what a keystroke changes, so the field under the cursor keeps its focus and selection. */
  _refreshLive({ found = false } = {}) {
    const st = this._st;
    const title = this.$('[data-region="title"]');
    if (title) title.textContent = editTitle(st);
    for (const k of FIELD_KEYS) {
      const msg = shownError(st, k);
      this.$$(`[data-err="${k}"]`).forEach((el) => { el.textContent = msg; el.hidden = !msg; });
      this.$(`[data-fld="${k}"]`)?.classList.toggle('err', !!msg);
    }
    const banner = this.$('[data-region="banner"]');
    if (banner) { banner.textContent = st.msg; banner.hidden = !st.msg; banner.className = st.msgKind === 'err' || st.msgKind === 'server' ? 'msg bad' : 'msg'; }
    const stage = this.$('[data-region="stage"]');
    if (stage) stage.innerHTML = previewCard(st);
    const note = this.$('[data-region="pvnote"]');
    if (note) note.textContent = previewNote(st.d);
    this.$$('[data-count]').forEach((el) => { el.textContent = plural(st.d.items.length); });
    if (found) { const f = this.$('[data-region="found"]'); if (f) f.innerHTML = foundLine(foundHosts(st.d.html, st.d.hosts)); }
  }

  _afterEditorPaint() {
    // A stored image's size is read from the picture itself once it loads; a missing one (not deployed yet) says so.
    const img = this.$('[data-stored-img]');
    const img0 = this._st?.d.image;
    if (img && img0?.kind === 'stored') {
      const info = this.$('[data-region="imginfo"]');
      img.addEventListener('load', () => { if (info && img.naturalWidth) info.textContent = `WebP · ${img.naturalWidth} × ${img.naturalHeight}`; }, { once: true });
      img.addEventListener('error', () => { img.hidden = true; if (info) info.textContent = 'WebP · shows on the site after the next deploy'; }, { once: true });
    }
  }

  async _setImage(file) {
    const st = this._st;
    st.imageWork = true; st.imageMsg = ''; st.drag = false;
    this._redrawImage();
    const r = await encodeCtaImage(file);
    if (this._st !== st) return;
    st.imageWork = false;
    if (r.ok) {
      st.d.image = { kind: 'upload', base64: r.base64, url: r.dataUrl, width: r.width, height: r.height, bytes: r.bytes };
      this._touched();
    } else {
      st.imageMsg = r.problem;
    }
    this.render();
  }

  _redrawImage() {
    const el = this.$('[data-region="image"]');
    if (el) { el.innerHTML = imageBody(this._st); this._afterEditorPaint(); }
  }

  _addHost(raw) {
    const st = this._st;
    const n = normalizeHost(raw ?? st.hostDraft);
    if (!n.ok) { st.hostErr = n.problem; const el = this.$('[data-region="hosterr"]'); if (el) { el.textContent = n.problem; el.hidden = false; } return; }
    if (!st.d.hosts.includes(n.host)) st.d.hosts = [...st.d.hosts, n.host];
    if (raw === undefined) st.hostDraft = '';
    st.hostErr = '';
    this._touched();
    this.render();
  }

  // ---- icons ------------------------------------------------------------------------------------------------------

  async _searchIcons() {
    const st = this._st;
    const token = (this._iconToken = (this._iconToken || 0) + 1);
    try {
      if (st.icons.status !== 'ready') st.icons.sets = await this.icons.sets();
      const { total, icons } = await this.icons.search(st.iconQuery, { setId: st.iconSet });
      if (this._st !== st || token !== this._iconToken) return;
      const first = st.icons.status !== 'ready';
      st.icons = { ...st.icons, status: 'ready', total, results: icons };
      if (first) this.render(); // the set chips arrive with the first answer
      else { const el = this.$('[data-region="icons"]'); if (el) el.innerHTML = iconResults(st); }
    } catch (e) {
      if (this._st !== st || token !== this._iconToken) return;
      st.icons = { ...st.icons, status: 'failed', problem: e?.message || 'unknown error' };
      const el = this.$('[data-region="icons"]');
      if (el) el.innerHTML = iconResults(st); else this.render();
    }
  }

  // ---- save -------------------------------------------------------------------------------------------------------

  async _save() {
    const st = this._st;
    if (st.saving) return;
    st.tried = true;
    this._revalidate();
    if (!st.v.ok) {
      st.msg = Object.keys(st.v.errors).length ? 'Fix the highlighted fields to save.' : st.v.banner;
      st.msgKind = 'err';
      this.render();
      return;
    }
    const { fields, changed } = savePayload(st.d, st.original, { isNew: st.isNew });
    if (!st.isNew && !changed.length) { st.msg = 'Nothing to save: this card already reads this way.'; st.msgKind = ''; this.render(); return; }
    st.saving = true; st.msg = ''; st.msgKind = '';
    this.render();
    try {
      const r = st.isNew ? await this.client.addCta(fields) : await this.client.updateCta(fields);
      // What was sent becomes the new starting point, so a second save sends only what changes after this one.
      const saved = cardFromDraft(st.d);
      if (st.d.image.kind === 'upload') {
        saved.image = `${saved.id}.webp`;
        st.d.image = { kind: 'stored', file: saved.image, url: st.d.image.url, width: st.d.image.width, height: st.d.image.height };
      }
      const at = this._ctas.findIndex((c) => c.id === saved.id);
      if (at >= 0) this._ctas[at] = saved; else this._ctas.push(saved);
      st.original = structuredClone(saved);
      st.isNew = false;
      st.msg = r?.noop ? 'Nothing to save: this card already reads this way.' : SUBMITTED;
      st.msgKind = 'ok';
    } catch (e) {
      st.msg = e?.message || 'That save failed.';
      st.msgKind = 'server';
    }
    st.saving = false;
    this._revalidate();
    this.render();
  }

  // ---- events (delegated once on the shadow root, so a redraw never needs rewiring) ----------------------------------

  _listen() {
    const root = this.root;
    root.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-act]');
      if (!b || b.disabled) return;
      this._act(b.dataset.act, b);
    });
    root.addEventListener('input', (e) => this._input(e.target));
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches?.('[data-file]')) { const f = t.files?.[0]; t.value = ''; if (f && this._st) this._setImage(f); return; }
      if (t.type === 'checkbox') this._input(t);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches?.('[data-q="host"]')) { e.preventDefault(); this._addHost(); }
    });
    const onDrag = (on) => (e) => {
      const zone = e.target.closest?.('[data-drop]');
      if (!zone || !this._st) return;
      e.preventDefault();
      if (this._st.drag !== on) { this._st.drag = on; zone.classList.toggle('on', on); }
    };
    root.addEventListener('dragover', onDrag(true));
    root.addEventListener('dragleave', onDrag(false));
    root.addEventListener('drop', (e) => {
      const zone = e.target.closest?.('[data-drop]');
      if (!zone || !this._st) return;
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) this._setImage(f); else { this._st.drag = false; zone.classList.remove('on'); }
    });
  }

  _input(t) {
    const st = this._st;
    if (!st) return;
    if (t.dataset.f) {
      const k = t.dataset.f;
      st.d[k] = t.type === 'checkbox' ? t.checked : t.value;
      this._touched();
      this._refreshLive({ found: k === 'html' });
      return;
    }
    const q = t.dataset.q;
    if (q === 'icons') {
      st.iconQuery = t.value;
      clearTimeout(this._iconTimer);
      this._iconTimer = setTimeout(() => this._searchIcons(), 160);
    } else if (q === 'pages') {
      st.pageQuery = t.value;
      st.cands = pageCandidates(this._pages, st.pageQuery, st.d.items);
      const el = this.$('[data-region="cands"]');
      if (el) el.innerHTML = candidateList(st);
    } else if (q === 'host') {
      st.hostDraft = t.value;
      if (st.hostErr) { st.hostErr = ''; const el = this.$('[data-region="hosterr"]'); if (el) el.hidden = true; }
    }
  }

  _act(act, b) {
    const st = this._st;
    switch (act) {
      case 'retry': this.load(); return;
      case 'new': this._open(null); return;
      case 'edit': { const c = this._ctas.find((x) => x.id === b.dataset.id); if (c) this._open(c); return; }
      case 'toggle': this._toggle(b.dataset.id); return;
      default: break;
    }
    if (!st) return;
    switch (act) {
      case 'back': this._back(); return;
      case 'save': this._save(); return;
      case 'layout': st.d.layout = b.dataset.layout; st.pickerOpen = false; break;
      case 'remove-image': st.d.image = { kind: 'none' }; st.imageMsg = ''; break;
      case 'picker':
        st.pickerOpen = !st.pickerOpen;
        if (st.pickerOpen && st.icons.status !== 'ready') { st.icons = { ...st.icons, status: 'loading' }; this._searchIcons(); }
        this.render();
        return;
      case 'icons-retry': st.icons = { ...st.icons, status: 'loading' }; this.render(); this._searchIcons(); return;
      case 'icon-set': st.iconSet = b.dataset.set || ''; this.render(); this._searchIcons(); return;
      case 'icon': { const icon = st.icons.results[Number(b.dataset.i)]; if (!icon) return; st.d.icon = icon; st.pickerOpen = false; break; }
      case 'clear-icon': st.d.icon = null; st.pickerOpen = false; break;
      case 'host-add': this._addHost(); return;
      case 'host-allow': this._addHost(b.dataset.host); return;
      case 'host-remove': st.d.hosts = st.d.hosts.filter((h) => h !== b.dataset.host); break;
      case 'page-add': {
        const c = st.cands[Number(b.dataset.i)];
        if (!c) return;
        st.d.items = [...st.d.items, { type: c.type, ref: c.ref }];
        st.pageQuery = ''; st.cands = [];
        break;
      }
      case 'page-remove': st.d.items = st.d.items.filter((_, n) => n !== Number(b.dataset.i)); break;
      case 'pv-light': st.pvDark = false; this.render(); return;
      case 'pv-dark': st.pvDark = true; this.render(); return;
      case 'pv-side': st.pvPhone = false; this.render(); return;
      case 'pv-phone': st.pvPhone = true; this.render(); return;
      default: return;
    }
    this._touched();
    this.render();
  }
}

define('gbti-cta-manager', GbtiCtaManager);
export { GbtiCtaManager };
