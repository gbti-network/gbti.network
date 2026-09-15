// sow-337: the markup of <gbti-cta-manager>, as pure string functions, from the approved design (the Manager
// artboard). The element owns state and events; this module only draws. Every value is escaped here except the card
// itself, which membership/cta-card-render.mjs draws and escapes (in preview mode, so partner code never runs in the
// admin). Regions the element refreshes while someone types carry data-region, and each field's message carries
// data-err, so a keystroke updates the preview and the messages without rebuilding the input under the cursor.
import { renderCtaCard, CTA_TOKENS, layoutUses, CTA_LAYOUTS, CTA_LAYOUT_NAMES } from '../../membership/cta-card-render.mjs';
import { iconSvg } from '../../membership/cta-icon.mjs';
import { LAYOUT_HINT, LAYOUT_TILE_TEXT, TYPE_LABEL, plural, rowSummary, previewNote } from './cta-manager-core.mjs';

export const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SVG = {
  back: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H6M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17h-19L12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><path d="M12 10v4M12 17.5v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
};
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';

// The layout tiles' little drawings, one per layout, as in the design.
const SKETCH = {
  below: '<div class="sk"><div class="ey"></div><div class="ln"></div><div class="im"><i></i></div><div class="bt"></div></div>',
  first: '<div class="sk"><div class="im top-im"><i></i></div><div class="ey"></div><div class="ln"></div><div class="bt"></div></div>',
  compact: '<div class="sk"><div class="row"><div class="im"><i></i></div><div class="col"><div class="ey"></div><div class="ln"></div><div class="ln s"></div></div></div><div class="bt"></div></div>',
  image: '<div class="sk io"><div class="im"><i></i></div><div class="ft"></div></div>',
  html: '<div class="sk"><div class="ey"></div><div class="code">&lt;/&gt;</div></div>',
  text: '<div class="sk"><div class="ey"></div><div class="ln"></div><div class="ln s"></div><div style="flex: 1"></div><div class="bt"></div></div>',
};

/** A card as the page draws it, in preview mode, inside a card box carrying the light or dark tokens. */
export function cardPreview(card, { image = null, dark = false, phone = false } = {}) {
  const cls = `pcta pv-card${phone ? ' phone' : ''}${card?.layout === 'image' ? ' io' : ''}`;
  return `<div class="${cls}" style="${dark ? CTA_TOKENS.dark : CTA_TOKENS.light}">${renderCtaCard(card, { image, preview: true })}</div>`;
}

export const loadingView = () => '<div class="mgr"><p class="hint">Loading call-to-actions&hellip;</p></div>';

export const failedView = (problem) => `<div class="mgr"><p class="msg bad">Could not load the call-to-actions (${esc(problem)}).</p>
  <button class="lk" type="button" data-act="retry">Try again</button></div>`;

/** The list. rows: [{ cta, image, busy }]. */
export function listView({ rows, msg = '', msgBad = false, dark = false }) {
  const items = rows.map(({ cta: c, image, busy }) => {
    const on = c.enabled === true;
    const n = Array.isArray(c.items) ? c.items.length : 0;
    return `<li class="${on ? 'c' : 'c off'}" data-cta="${esc(c.id)}">
      <div class="thumb"><div class="thumb-in">${cardPreview(c, { image, dark })}</div></div>
      <div class="meta">
        <div class="top"><span class="label">${esc(c.label || c.id)}</span><span class="${on ? 'badge on' : 'badge'}">${on ? 'Enabled' : 'Disabled'}</span><span class="badge">${esc(CTA_LAYOUT_NAMES[c.layout] || CTA_LAYOUT_NAMES.text)}</span></div>
        <p class="line">${esc(rowSummary(c))}</p>
        <p class="sub mono">${esc(c.partner || 'no partner')} · on ${plural(n)}</p>
      </div>
      <div class="acts-r">
        <button class="lk" type="button" data-act="edit" data-id="${esc(c.id)}"${busy ? ' disabled' : ''}>Edit</button>
        <button class="lk" type="button" data-act="toggle" data-id="${esc(c.id)}"${busy ? ' disabled' : ''}>${busy ? 'Saving…' : on ? 'Disable' : 'Enable'}</button>
      </div>
    </li>`;
  }).join('');
  return `<div class="mgr">
    <div class="head">
      <p class="hint">Partner cards in the sidebar of articles, prompts, projects and shares. Each change opens a pull request that merges on its own. Disable a card to retire it.</p>
      <button class="btn" type="button" data-act="new">New call-to-action</button>
    </div>
    ${msg ? `<p class="${msgBad ? 'msg bad' : 'msg'}">${esc(msg)}</p>` : ''}
    <ul class="list">${items || '<li class="empty">No call-to-actions yet.</li>'}</ul>
  </div>`;
}

/** The editor's title line. */
export const editTitle = (st) => (st.isNew ? 'New call-to-action' : `Edit: ${st.d.label.trim() || 'call-to-action'}`);

/** The message a field shows now: after a save attempt, or at once for a message worth showing live. */
export const shownError = (st, k) => (st.v.errors[k] && (st.tried || st.v.live[k]) ? st.v.errors[k] : '');

function field(st, k, label, { wide = false, area = false, placeholder = '' } = {}) {
  const err = shownError(st, k);
  const cls = `fld${wide ? ' wide' : ''}${err ? ' err' : ''}`;
  const control = area
    ? `<textarea data-f="${k}" placeholder="${esc(placeholder)}">${esc(st.d[k])}</textarea>`
    : `<input type="text" data-f="${k}" value="${esc(st.d[k])}" placeholder="${esc(placeholder)}">`;
  return `<label class="${cls}" data-fld="${k}">${label}${control}<span class="et" data-err="${k}"${err ? '' : ' hidden'}>${esc(err)}</span></label>`;
}

function layoutSection(st) {
  const tiles = CTA_LAYOUTS.map((k) => `<button class="${st.d.layout === k ? 'tile on' : 'tile'}" type="button" data-act="layout" data-layout="${k}" aria-pressed="${st.d.layout === k}">
    ${SKETCH[k]}<div><p class="tile-n">${esc(CTA_LAYOUT_NAMES[k])}</p><p class="tile-d">${esc(LAYOUT_TILE_TEXT[k])}</p></div></button>`).join('');
  return `<div class="sec"><div class="sec-h"><h4>Layout</h4><span class="hint">${esc(LAYOUT_HINT[st.d.layout])}</span></div><div class="tiles">${tiles}</div></div>`;
}

function wordsSection(st) {
  const u = layoutUses(st.d.layout);
  return `<div class="sec"><div class="sec-h"><h4>Words and link</h4></div><div class="form">
    ${st.isNew ? field(st, 'id', 'Id, set once', { placeholder: 'stranger-in-a-strange-land' }) : ''}
    ${field(st, 'label', 'Title', { placeholder: 'Stranger in a Strange Land' })}
    ${field(st, 'partner', 'Partner', { placeholder: 'amazon' })}
    ${u.line ? field(st, 'line', 'Sentence', { wide: true, area: true, placeholder: 'The one sentence the card shows' }) : ''}
    ${u.button ? field(st, 'button', 'Button text', { placeholder: 'Get the book on Amazon' }) : ''}
    ${u.link ? field(st, 'destination', 'Link', { placeholder: 'https://www.amazon.com/dp/...?tag=...' }) : ''}
    <label class="fld wide">Note<textarea data-f="note" placeholder="Where the link came from, whose referral tag it carries">${esc(st.d.note)}</textarea></label>
    <label class="check fld wide"><input type="checkbox" data-f="enabled"${st.d.enabled ? ' checked' : ''}> Enabled: show this card on its pages</label>
  </div></div>`;
}

/** The inside of the image section (a region: an upload or removal redraws it). */
export function imageBody(st) {
  const img = st.d.image;
  const err = shownError(st, 'image');
  let body;
  if (img.kind === 'none') {
    body = `<div class="${st.drag ? 'drop on' : err ? 'drop err' : 'drop'}" data-drop>
      <span class="drop-ic">${SVG.upload}</span>
      <div class="imgmeta"><p class="drop-t">Drop an image here, or choose one</p>
        <p class="imginfo">JPEG, PNG, WebP, GIF or AVIF. Saved as WebP, with camera and location data removed before it leaves your browser.</p></div>
      <label class="lk pick-file">Choose image<input type="file" accept="${ACCEPT}" data-file></label>
    </div>`;
  } else {
    const name = img.kind === 'upload' ? `${st.d.id.trim() || 'new-call-to-action'}.webp` : img.file;
    const dims = img.width && img.height ? ` · ${img.width} × ${img.height}` : '';
    const size = img.bytes ? ` · ${Math.max(1, Math.round(img.bytes / 1024))} KB` : '';
    body = `<div class="imgrow">
      ${img.url ? `<img src="${esc(img.url)}" alt="" data-stored-img>` : ''}
      <div class="imgmeta"><p class="imgname">${esc(name)}</p>
        <p class="imginfo"><span data-region="imginfo">WebP${dims}${size}</span></p>
        <p class="imginfo"><span class="shield">${SVG.shield}Camera and location data removed</span></p></div>
      <div class="acts-r"><label class="lk pick-file">Replace<input type="file" accept="${ACCEPT}" data-file></label>
        <button class="lk danger" type="button" data-act="remove-image">Remove</button></div>
    </div>`;
  }
  return `${body}${st.imageWork ? '<p class="imgwork">Preparing the image…</p>' : ''}
    <p class="et" style="margin-top: 6px" data-err="image"${err ? '' : ' hidden'}>${esc(err)}</p>
    ${st.imageMsg ? `<p class="et" style="margin-top: 6px">${esc(st.imageMsg)}</p>` : ''}`;
}

/** The icon grid and its count (a region: a search redraws it). */
export function iconResults(st) {
  const ic = st.icons;
  if (ic.status === 'failed') return `<p class="ip-count">Could not load the icon library (${esc(ic.problem)}).</p><button class="lk" type="button" data-act="icons-retry">Try again</button>`;
  if (ic.status !== 'ready') return '<p class="ip-count">Loading icons…</p>';
  const q = st.iconQuery.trim();
  const count = !q ? `${ic.total.toLocaleString('en-US')} icons` : ic.total === 0 ? 'No icons match.' : ic.total === 1 ? '1 icon matches' : `${ic.total.toLocaleString('en-US')} icons match`;
  const sel = st.d.icon;
  const cells = ic.results.map((i, n) => `<button class="${sel && sel.name === i.name && sel.set === i.set ? 'ic-cell on' : 'ic-cell'}" type="button" data-act="icon" data-i="${n}" title="${esc(`${i.name}, ${i.set}`)}">${iconSvg(i)}<span>${esc(i.name)}</span></button>`).join('');
  return `<p class="ip-count">${count}</p><div class="ip-grid">${cells}</div>`;
}

function iconSection(st) {
  const sel = st.d.icon;
  const chips = st.icons.status === 'ready'
    ? [{ id: '', name: 'All' }, ...st.icons.sets].map((s) => `<button class="${st.iconSet === s.id ? 'chip on' : 'chip'}" type="button" data-act="icon-set" data-set="${esc(s.id)}">${esc(s.name)}</button>`).join('')
    : '';
  const pop = st.pickerOpen ? `<div class="ip-pop">
      <label class="srch">${SVG.search}<input type="text" data-q="icons" value="${esc(st.iconQuery)}" placeholder="Search about 50,000 icons, for example amazon" aria-label="Search icons"></label>
      <div class="chips">${chips}</div>
      <div data-region="icons">${iconResults(st)}</div>
    </div>` : '';
  return `<div class="sec"><div class="sec-h"><h4>Button icon</h4><span class="hint">Optional. Shown left of the button text.</span></div>
    <div class="ip-row">
      <button class="${st.pickerOpen ? 'ip-trig open' : 'ip-trig'}" type="button" data-act="picker" aria-expanded="${st.pickerOpen}">
        <span class="ip-sw">${sel ? iconSvg(sel) : ''}</span>
        <span class="ip-name"><b>${esc(sel ? sel.name : 'Choose an icon')}</b><span>${esc(sel ? sel.set : 'No icon on the button')}</span></span>${SVG.chev}
      </button>
      ${sel ? '<button class="lk" type="button" data-act="clear-icon">No icon</button>' : ''}
    </div>${pop}</div>`;
}

/** The "found in the code" line (a region: typing in the code redraws it). */
export function foundLine(found) {
  if (!found.length) return '';
  return `<div class="found">Found in the code: ${found.map((h) => `<span class="mono">${esc(h)}</span><button class="lk" type="button" data-act="host-allow" data-host="${esc(h)}">Allow</button>`).join('')}</div>`;
}

function htmlSection(st, found) {
  const d = st.d;
  const hosts = d.hosts.length
    ? `<ul class="hosts">${d.hosts.map((h) => `<li class="host"><span class="mono">${esc(h)}</span><button class="lk danger" type="button" data-act="host-remove" data-host="${esc(h)}">Remove</button></li>`).join('')}</ul>`
    : '<p class="empty">None. Code that loads from another site will be blocked.</p>';
  const err = shownError(st, 'html');
  return `<div class="sec"><div class="sec-h"><h4>HTML block</h4></div>
    <div class="warnbox">${SVG.warn}<span><b>This code runs on every page this card is on (<span data-count>${plural(d.items.length)}</span>).</b> Scripts run for every visitor to those pages, so a mistake here affects all of them.</span></div>
    <div class="form" style="margin-top: 14px">
      <label class="check fld wide"><input type="checkbox" data-f="showTitle"${d.showTitle ? ' checked' : ''}> Show the title above the code</label>
      <label class="${err ? 'fld wide err' : 'fld wide'}" data-fld="html">Partner code
        <textarea class="code" data-f="html" spellcheck="false" placeholder="Paste the partner's HTML, including any script tags">${esc(d.html)}</textarea>
        <span class="et" data-err="html"${err ? '' : ' hidden'}>${esc(err)}</span></label>
    </div>
    <div style="margin-top: 16px">
      <div class="sec-h" style="margin-bottom: 8px"><h4>Outside addresses</h4><span class="hint">Only these load, and only on this card's pages.</span></div>
      ${hosts}
      <div data-region="found">${foundLine(found)}</div>
      <div class="hostadd"><input type="text" data-q="host" value="${esc(st.hostDraft)}" placeholder="https://widgets.partner.com" aria-label="Outside address"><button class="lk" type="button" data-act="host-add">Add</button></div>
      <p class="et" style="margin-top: 6px" data-region="hosterr"${st.hostErr ? '' : ' hidden'}>${esc(st.hostErr)}</p>
    </div></div>`;
}

/** The page search results (a region: typing redraws it). */
export function candidateList(st) {
  if (!st.pageQuery.trim()) return '';
  if (!st.cands.length) return '<p class="empty">No pages match.</p>';
  return `<ul class="results">${st.cands.map((c, n) => `<li><button class="res" type="button" data-act="page-add" data-i="${n}"><span class="ty">${esc(TYPE_LABEL[c.type] || c.type)}</span><span>${esc(c.title)}</span><span class="add">Add</span></button></li>`).join('')}</ul>`;
}

function pagesSection(st) {
  const d = st.d;
  const assigned = d.items.length
    ? `<ul class="items">${d.items.map((it, n) => `<li class="it"><span class="ty">${esc(TYPE_LABEL[it.type] || it.type)}</span><span class="t">${esc(st.titleOf(it))}</span><button class="lk danger" type="button" data-act="page-remove" data-i="${n}">Remove</button></li>`).join('')}</ul>`
    : '<p class="empty">Not on any page yet.</p>';
  return `<div class="sec"><div class="sec-h"><h4>Pages showing this card</h4><span class="hint" data-count>${plural(d.items.length)}</span></div>
    ${assigned}
    <label class="srch">${SVG.search}<input type="text" data-q="pages" value="${esc(st.pageQuery)}" placeholder="Add a page: search articles, prompts, projects and shares" aria-label="Search pages"></label>
    <div data-region="cands">${candidateList(st)}</div></div>`;
}

/** The preview stage's card (a region: every keystroke redraws it). */
export function previewCard(st) {
  const d = st.d;
  const u = layoutUses(d.layout);
  const card = {
    id: d.id, layout: d.layout, partner: d.partner, destination: d.destination, showTitle: d.showTitle, hosts: d.hosts, icon: d.icon,
    label: d.label.trim() || 'Title', line: d.line.trim() || 'The sentence the card shows.', button: d.button.trim() || 'Button text',
  };
  const img = d.image;
  const image = u.image && img.kind !== 'none' && img.url ? { url: img.url, width: img.width, height: img.height } : null;
  return cardPreview(card, { image, dark: st.pvDark, phone: st.pvPhone });
}

function previewAside(st) {
  const seg = (on, act, text) => `<button class="${on ? 'seg on' : 'seg'}" type="button" data-act="${act}" aria-pressed="${on}">${text}</button>`;
  return `<aside class="ed-prev">
    <div class="pv-bar"><h4>Preview</h4>
      <div class="segs">${seg(!st.pvDark, 'pv-light', 'Light')}${seg(st.pvDark, 'pv-dark', 'Dark')}</div>
      <div class="segs">${seg(!st.pvPhone, 'pv-side', 'Sidebar')}${seg(st.pvPhone, 'pv-phone', 'Phone')}</div>
    </div>
    <div class="${st.pvDark ? 'pv-stage dk' : 'pv-stage'}" data-region="stage">${previewCard(st)}</div>
    <p class="pv-note" data-region="pvnote">${esc(previewNote(st.d))}</p>
  </aside>`;
}

/** The whole editor. `found` is the list foundHosts gives for the current code. */
export function editorView(st, found = []) {
  const u = layoutUses(st.d.layout);
  return `<div class="mgr">
    <div class="ed-head">
      <button class="lk" type="button" data-act="back">${SVG.back}All call-to-actions</button>
      <h3 class="ed-title" data-region="title">${esc(editTitle(st))}</h3>
      <div class="acts-r"><button class="lk" type="button" data-act="back">Cancel</button>
        <button class="btn" type="button" data-act="save"${st.saving ? ' disabled' : ''}>${st.saving ? 'Saving…' : st.isNew ? 'Add call-to-action' : 'Save'}</button></div>
    </div>
    <p class="${st.msgKind === 'err' || st.msgKind === 'server' ? 'msg bad' : 'msg'}" data-region="banner"${st.msg ? '' : ' hidden'}>${esc(st.msg)}</p>
    <div class="ed-grid">
      <div class="ed-form">
        ${layoutSection(st)}
        ${wordsSection(st)}
        ${u.image ? `<div class="sec"><div class="sec-h"><h4>Image</h4><span class="hint">Tall images are capped in height on the card.</span></div><div data-region="image">${imageBody(st)}</div></div>` : ''}
        ${u.icon ? iconSection(st) : ''}
        ${u.html ? htmlSection(st, found) : ''}
        ${pagesSection(st)}
      </div>
      ${previewAside(st)}
    </div>
  </div>`;
}
