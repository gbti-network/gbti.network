// sow-483 Phase 2 (owner, 2026-10-27, "A, one form"; canvas board "Round 2, A, one form" and "A, states"): the WorkBench
// form for the ```audio block, in its own module because gbti-doc-editor.mjs sits close to the 900-line cap. Top to
// bottom: Label and Length, the Source (Upload, SoundCloud, Spotify, Apple Podcasts), that source's own field, the
// Player style for a file, and an optional link out. The block model stays the fence's text (b.lang + b.code); every
// control rewrites one line of it through client/src/audio-block-edit.mjs, so a block nobody touched saves unchanged.
//
// Form-only state rides on the block under underscore names, which serializeBlocks never writes:
//   _src       the chosen source while the block has no source line yet
//   _stash     each source's last value, so trying another source and coming back loses nothing
//   _autoLink  the link out this form filled in from a provider link, replaced while the author leaves it alone
//   _linkOpen  the link out fields are showing although both are empty
//   _file      what happened to the last file picked: a problem to show, or a file waiting on uploads
// Player style shows once the block has a file, as on the canvas: a provider brings its own player.
import { esc } from './base.mjs';
import { parseAudio, setAudioStyle, AUDIO_STYLES, audioLinkLabel } from '../../client/src/content-blocks.mjs';
import {
  AUDIO_SOURCES, SOURCE_NAMES, audioLabelOf, setAudioLabel, audioLineValue, setAudioLine, audioSourceOf, setAudioSource,
  audioLinkNote, audioFileProblem, audioExt,
} from '../../client/src/audio-block-edit.mjs';

const icon = (paths, w = 1.8) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
/** The music note the block wears in its header and in the Turn into palette. */
export const AUDIO_ICON_PATHS = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';
const NOTE = icon(AUDIO_ICON_PATHS);
const UPLOAD = icon('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>');
const CHECK = icon('<path d="M5 12l5 5 9-10"/>', 2.2);
const ALERT = icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>', 2);
const PLUS = icon('<path d="M12 5v14M5 12h14"/>', 2);

const PASTE = {
  soundcloud: 'Paste a SoundCloud track or playlist link',
  spotify: 'Paste a Spotify episode or show link',
  apple: 'Paste an Apple Podcasts episode or show link',
};
const WEB_ADDRESS = 'Paste a full web address, starting with https://.';
const isWebAddress = (v) => /^https?:\/\/\S+$/i.test(String(v ?? '').trim());

/** The source the form shows: the block's own source line, else the author's last choice, else Upload. */
export function audioSourceKind(b) {
  const s = audioSourceOf(b.code);
  return s ? s.kind : (AUDIO_SOURCES.includes(b._src) ? b._src : 'upload');
}

const lab = (text, forId) => `<label class="ab-lab" for="${forId}">${text}</label>`;
const seg = (name, items, on, attr, id) => `<div class="ab-seg" role="group" aria-label="${name}">${items.map(([k, words]) =>
  `<button type="button" ${attr}="${k}" data-id="${id}" aria-pressed="${k === on}">${words}</button>`).join('')}</div>`;

function uploadField(b, a) {
  const id = b._id;
  const pick = `<input type="file" accept=".mp3,.ogg,.opus,audio/mpeg,audio/ogg" hidden data-ab-file="${id}" />`;
  const p = b._file?.problem;
  if (p) {
    return `<div class="ab-alert" role="alert">${ALERT}<div><p class="ab-alert-t">${esc(p.title)}</p>`
      + `<p class="ab-alert-d"><span class="ab-mono">${esc(p.name)}</span>${esc(p.rest)}</p></div></div>`
      + `<button type="button" class="ab-btn ab-self" data-ab-pick="${id}">Choose another file</button>${pick}`;
  }
  const src = audioSourceOf(b.code)?.value || '';
  if (src) {
    const name = src.split('/').pop();
    const ok = a.sources.length > 0;
    const meta = ok ? `${audioExt(name).toUpperCase()} · published on gbti.network` : 'This path cannot be played. Choose the file again.';
    return `<div class="ab-file"><span class="ab-file-ic">${NOTE}</span><div class="ab-file-tx"><span class="ab-mono ab-file-n">${esc(name)}</span>`
      + `<span class="ab-file-m${ok ? '' : ' ab-bad-t'}">${esc(meta)}</span></div>`
      + `<button type="button" class="ab-btn" data-ab-pick="${id}">Replace</button><button type="button" class="ab-btn" data-ab-remove="${id}">Remove</button></div>`
      + `<p class="ab-hint">MP3 or Ogg, up to 20 MB. It is published with the article and played from gbti.network.</p>${pick}`;
  }
  const waiting = b._file?.waiting;
  return `<button type="button" class="ab-drop" data-ab-drop="${id}">${UPLOAD}<span class="ab-mono">Drop an MP3 or Ogg file here, or click to choose one</span></button>`
    + (waiting
      ? `<p class="ab-hint ab-wait" role="status">Uploads arrive in the next update. Choose <span class="ab-mono">${esc(waiting.name)}</span> again once it lands.</p>`
      : '<p class="ab-hint">Up to 20 MB, roughly an hour of speech as MP3.</p>')
    + pick;
}

function providerField(b, kind) {
  const id = b._id;
  const value = audioSourceOf(b.code)?.value || '';
  const note = audioLinkNote(kind, value);
  const state = note ? (note.ok ? ' ab-ok' : ' ab-bad') : '';
  return `<div class="ab-f"><input id="ab-sv-${id}" class="ab-in${state}" data-ab="source" data-kind="${kind}" data-id="${id}" value="${esc(value)}"`
    + ` aria-label="${esc(SOURCE_NAMES[kind])} link" placeholder="${esc(PASTE[kind])}" aria-describedby="ab-note-${id}"${note && !note.ok ? ' aria-invalid="true"' : ''} />`
    + `<p class="ab-note${note ? (note.ok ? ' ab-ok-t' : ' ab-bad-t') : ''}" id="ab-note-${id}" data-ab-note="${id}">${noteHtml(note)}</p></div>`;
}
const noteHtml = (note) => (note ? `${note.ok ? CHECK : ALERT}<span>${esc(note.text)}</span>` : '');

function linkOut(b, a) {
  const id = b._id;
  const raw = audioLineValue(b.code, 'link');
  const words = audioLineValue(b.code, 'link-label');
  if (!raw && !words && !b._linkOpen) return `<button type="button" class="ab-add" data-ab-linkopen="${id}">${PLUS} Add a link out</button>`;
  const bad = raw && !isWebAddress(raw);
  return `<div class="ab-out"><span class="ab-lab" id="ab-out-${id}">Link out, optional</span><div class="ab-two">`
    + `<input class="ab-in${bad ? ' ab-bad' : ''}" data-ab="link" data-id="${id}" value="${esc(raw)}" aria-label="Link out address" placeholder="https://"`
    + ` aria-describedby="ab-lnote-${id}"${bad ? ' aria-invalid="true"' : ''} />`
    + `<input class="ab-in" data-ab="link-label" data-id="${id}" value="${esc(words)}" aria-label="Link out words" placeholder="${esc(a.link ? audioLinkLabel(a.link, '') : 'Words, such as Listen on Spotify')}" />`
    + `</div><p class="ab-note ab-bad-t" id="ab-lnote-${id}" data-ab-lnote="${id}">${bad ? `${ALERT}<span>${WEB_ADDRESS}</span>` : ''}</p></div>`;
}

/** The whole form for one block. */
export function audioBlockHtml(b) {
  const id = b._id;
  const a = parseAudio(b.code || '', audioLabelOf(b.lang));
  const kind = audioSourceKind(b);
  return `<section class="card ab" aria-label="Podcast player block"><div class="card-h">${NOTE} Podcast player</div>`
    + `<div class="ab-two"><div class="ab-f">${lab('Label', `ab-l-${id}`)}<input id="ab-l-${id}" class="ab-in" data-ab="label" data-id="${id}" value="${esc(audioLabelOf(b.lang))}" placeholder="Label, such as Listen to the podcast version" /></div>`
    + `<div class="ab-f">${lab('Length', `ab-n-${id}`)}<input id="ab-n-${id}" class="ab-in" data-ab="length" data-id="${id}" value="${esc(audioLineValue(b.code, 'length'))}" placeholder="Length, such as 22 minutes" /></div></div>`
    + `<div class="ab-f"><span class="ab-lab">Source</span>${seg('Source', AUDIO_SOURCES.map((k) => [k, SOURCE_NAMES[k]]), kind, 'data-ab-src', id)}</div>`
    + (kind === 'upload' ? uploadField(b, a) : providerField(b, kind))
    + (kind === 'upload' && audioSourceOf(b.code) ? `<div class="ab-row"><span class="ab-lab">Player style</span>${seg('Player style', AUDIO_STYLES.map((s) => [s, s === 'bar' ? 'Bar' : 'Card']), a.style, 'data-ab-style', id)}</div>` : '')
    + linkOut(b, a)
    + '</section>';
}

/** Leave one source for another, keeping what the old one held so coming back restores it. */
export function switchAudioSource(b, next) {
  const cur = audioSourceKind(b);
  if (cur === next || !AUDIO_SOURCES.includes(next)) return false;
  const stash = (b._stash ||= {});
  const link = audioLineValue(b.code, 'link');
  const auto = link && link === b._autoLink;
  stash[cur] = { value: audioSourceOf(b.code)?.value || '', style: cur === 'upload' ? audioLineValue(b.code, 'style') : '', link: auto ? link : '' };
  let code = setAudioSource(b.code, next, stash[next]?.value || '');
  // A link out this form filled in from the old source's link leaves with it; one the author typed stays.
  if (auto) { code = setAudioLine(code, 'link', ''); b._autoLink = null; }
  if (stash[next]?.link && !audioLineValue(code, 'link')) { code = setAudioLine(code, 'link', stash[next].link); b._autoLink = stash[next].link; }
  code = setAudioLine(code, 'style', next === 'upload' ? (stash.upload?.style || '') : '');
  b.code = code;
  b._src = next;
  b._file = null;
  return true;
}

/** A provider link typed or pasted: set the source line, and fill the link out while the author has not set one. */
export function setAudioProviderLink(b, kind, value) {
  b.code = setAudioSource(b.code, kind, value);
  const note = audioLinkNote(kind, value);
  const link = audioLineValue(b.code, 'link');
  if (note?.ok && (!link || link === b._autoLink) && link !== note.page) {
    b.code = setAudioLine(b.code, 'link', note.page);
    b._autoLink = note.page;
    return { note, linkChanged: true };
  }
  return { note, linkChanged: false };
}

/**
 * Wire every podcast form in `root`. `ctx` is the doc editor's: byId, render, change, and focus(selector) to put the
 * caret back after a re-render. `stageAudio(b, file)`, when the host has one, uploads a picked file (sow-483 Phase 3).
 */
export function wireAudioBlocks(root, ctx) {
  const all = (sel) => Array.from(root.querySelectorAll(sel));
  const redraw = (b, focusSel) => { ctx.render(); ctx.change(); if (focusSel) ctx.focus(focusSel); };
  // In a narrow editor the block's toolbar appears at its top when the block takes focus (doc-editor-css.mjs, the
  // 560px container rule), which moved every button below it 36px between the mouse press and the release, so the
  // click landed on nothing (measured 2026-10-27). A mouse press here leaves focus where it is; the keyboard and touch
  // are unaffected, and the redraw puts focus on the control afterwards.
  for (const btn of all('.ab button')) btn.addEventListener('mousedown', (e) => e.preventDefault());
  for (const el of all('input[data-ab]')) {
    el.addEventListener('input', () => {
      const b = ctx.byId(el.dataset.id);
      if (!b) return;
      const v = el.value;
      const f = el.dataset.ab;
      if (f === 'label') b.lang = setAudioLabel(b.lang, v);
      else if (f === 'length') b.code = setAudioLine(b.code, 'length', v);
      else if (f === 'link-label') b.code = setAudioLine(b.code, 'link-label', v);
      else if (f === 'link') {
        b.code = setAudioLine(b.code, 'link', v);
        b._autoLink = null; // the author's own address now; a provider link no longer replaces it
        const bad = v.trim() && !isWebAddress(v);
        el.classList.toggle('ab-bad', !!bad);
        if (bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
        const n = root.querySelector(`[data-ab-lnote="${b._id}"]`);
        if (n) n.innerHTML = bad ? `${ALERT}<span>${WEB_ADDRESS}</span>` : '';
        const words = root.querySelector(`input[data-ab="link-label"][data-id="${b._id}"]`);
        if (words) words.placeholder = isWebAddress(v) ? audioLinkLabel(v.trim(), '') : 'Words, such as Listen on Spotify';
      } else if (f === 'source') {
        const { note, linkChanged } = setAudioProviderLink(b, el.dataset.kind, v);
        if (linkChanged) { b._linkOpen = true; redraw(b, `#ab-sv-${b._id}`); return; }
        el.classList.toggle('ab-ok', !!note?.ok);
        el.classList.toggle('ab-bad', !!note && !note.ok);
        if (note && !note.ok) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
        const n = root.querySelector(`[data-ab-note="${b._id}"]`);
        if (n) { n.className = `ab-note${note ? (note.ok ? ' ab-ok-t' : ' ab-bad-t') : ''}`; n.innerHTML = noteHtml(note); }
      }
      ctx.change();
    });
  }
  for (const btn of all('[data-ab-src]')) btn.addEventListener('click', () => {
    const b = ctx.byId(btn.dataset.id);
    if (b && switchAudioSource(b, btn.dataset.abSrc)) redraw(b, `[data-ab-src="${btn.dataset.abSrc}"][data-id="${b._id}"]`);
  });
  for (const btn of all('[data-ab-style]')) btn.addEventListener('click', () => {
    const b = ctx.byId(btn.dataset.id);
    if (b) { b.code = setAudioStyle(b.code, btn.dataset.abStyle); redraw(b, `[data-ab-style="${btn.dataset.abStyle}"][data-id="${b._id}"]`); }
  });
  for (const btn of all('[data-ab-linkopen]')) btn.addEventListener('click', () => {
    const b = ctx.byId(btn.dataset.abLinkopen);
    if (b) { b._linkOpen = true; ctx.render(); ctx.focus(`input[data-ab="link"][data-id="${b._id}"]`); }
  });
  for (const btn of all('[data-ab-remove]')) btn.addEventListener('click', () => {
    const b = ctx.byId(btn.dataset.abRemove);
    if (b) { b.code = setAudioSource(b.code, 'upload', ''); b._file = null; redraw(b, `[data-ab-drop="${b._id}"]`); }
  });
  const take = (b, file) => {
    if (!b || !file) return;
    const problem = audioFileProblem({ name: file.name, size: file.size });
    if (problem) { b._file = { problem }; ctx.render(); ctx.focus(`[data-ab-pick="${b._id}"]`); return; }
    if (typeof ctx.stageAudio === 'function') { ctx.stageAudio(b, file); return; }
    b._file = { waiting: { name: file.name } };
    ctx.render();
  };
  for (const input of all('input[data-ab-file]')) input.addEventListener('change', () => take(ctx.byId(input.dataset.abFile), input.files?.[0]));
  const openPicker = (id) => root.querySelector(`input[data-ab-file="${id}"]`)?.click();
  for (const btn of all('[data-ab-pick]')) btn.addEventListener('click', () => openPicker(btn.dataset.abPick));
  for (const zone of all('[data-ab-drop]')) {
    zone.addEventListener('click', () => openPicker(zone.dataset.abDrop));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); zone.classList.remove('drag');
      take(ctx.byId(zone.dataset.abDrop), e.dataTransfer?.files?.[0]);
    });
  }
}

// The form's look, from the canvas. Selected buttons use the accessible green (#0f6f40, 4.5:1 or better with white) in
// light and the brighter green with dark text in dark. Every rule is scoped under .ab, which also beats the shared
// bare button and input rules in BASE_CSS.
export const AUDIO_BLOCK_CSS = `
  .ab { gap:12px; padding:14px; }
  .ab .ab-two { display:grid; grid-template-columns:3fr 2fr; gap:10px; }
  .ab .ab-f { display:flex; flex-direction:column; gap:5px; min-width:0; }
  .ab .ab-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .ab .ab-lab { display:block; margin:0; font-family:var(--font-mono,monospace); font-size:10px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--s-fg-mute); }
  .ab input.ab-in { width:100%; box-sizing:border-box; font:inherit; font-size:13.5px; padding:8px 10px; border:1.5px solid var(--s-line); border-radius:9px; background:var(--s-surface); color:var(--s-fg); }
  .ab input.ab-in:focus { outline:none; border-color:var(--s-green); box-shadow:0 0 0 3px var(--s-sel); }
  .ab input.ab-in.ab-ok { border-color:var(--s-green); }
  .ab input.ab-in.ab-bad { border-color:#c0392b; }
  .ab .ab-seg { display:inline-flex; align-self:flex-start; gap:4px; padding:4px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:8px; }
  .ab .ab-seg button { font:inherit; font-size:12px; font-weight:600; padding:5px 11px; border:0; border-radius:6px; background:transparent; color:var(--s-fg-soft); cursor:pointer; }
  .ab .ab-seg button:hover { background:var(--s-surface-3); color:var(--s-fg); }
  .ab .ab-seg button[aria-pressed="true"] { background:#0f6f40; color:#fff; }
  .ab .ab-seg button:focus-visible, .ab .ab-btn:focus-visible, .ab .ab-drop:focus-visible, .ab .ab-add:focus-visible { outline:2px solid var(--s-green); outline-offset:2px; }
  .ab .ab-drop { height:108px; width:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; font:inherit; border:1.5px dashed var(--s-line-2); border-radius:9px; background:var(--s-surface-2); color:var(--s-fg-soft); cursor:pointer; padding:0 12px; }
  .ab .ab-drop:hover, .ab .ab-drop.drag { color:var(--s-green-fg); border-color:var(--s-green); background:var(--s-tint); }
  .ab .ab-drop svg { width:26px; height:26px; }
  .ab .ab-mono { font-family:var(--font-mono,monospace); font-size:12px; }
  .ab .ab-hint, .ab .ab-note { margin:-4px 0 0; font-size:12px; line-height:1.45; color:var(--s-fg-mute); }
  .ab .ab-note { margin:0; display:flex; align-items:flex-start; gap:6px; font-size:12.5px; }
  .ab .ab-note:empty { display:none; }
  .ab .ab-note svg { flex:none; width:15px; height:15px; margin-top:1px; }
  .ab .ab-ok-t { color:var(--s-green-fg); }
  .ab .ab-bad-t { color:#b03224; }
  .ab .ab-wait { color:var(--s-fg-soft); }
  .ab .ab-file { display:flex; align-items:center; gap:12px; padding:10px 12px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:9px; }
  .ab .ab-file-ic { flex:none; width:34px; height:34px; border-radius:8px; background:var(--s-tint); color:var(--s-green-fg); display:flex; align-items:center; justify-content:center; }
  .ab .ab-file-ic svg { width:18px; height:18px; }
  .ab .ab-file-tx { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .ab .ab-file-n { font-size:12.5px; font-weight:500; color:var(--s-fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ab .ab-file-m { font-size:12px; color:var(--s-fg-mute); }
  .ab .ab-btn { flex:none; font:inherit; font-size:13px; font-weight:600; padding:7px 12px; border:1.5px solid var(--s-line); border-radius:9px; background:var(--s-surface); color:var(--s-fg); cursor:pointer; }
  .ab .ab-btn:hover { border-color:var(--s-green); color:var(--s-green-fg); background:var(--s-surface); }
  .ab .ab-self { align-self:flex-start; }
  .ab .ab-alert { display:flex; align-items:flex-start; gap:12px; padding:12px; background:#fdf0ee; border:1.5px solid #f0c4bd; border-radius:9px; }
  .ab .ab-alert > svg { flex:none; width:18px; height:18px; margin-top:1px; color:#b03224; }
  .ab .ab-alert p { margin:0; }
  .ab .ab-alert-t { font-size:13.5px; font-weight:600; color:#8f2318; }
  .ab .ab-alert p.ab-alert-d { margin-top:4px; font-size:12.5px; line-height:1.5; color:var(--s-fg-soft); }
  .ab .ab-out { display:flex; flex-direction:column; gap:6px; padding-top:12px; border-top:1.5px solid var(--s-surface-3); }
  .ab .ab-add { align-self:flex-start; display:inline-flex; align-items:center; gap:6px; font:inherit; font-size:13px; font-weight:600; padding:6px 2px; border:0; background:transparent; color:var(--s-green-fg); cursor:pointer; }
  .ab .ab-add:hover { background:transparent; text-decoration:underline; text-underline-offset:3px; }
  .ab .ab-add svg { width:14px; height:14px; }
  :host-context([data-theme="dark"]) .ab .ab-seg button[aria-pressed="true"] { background:var(--s-green); color:#10120f; }
  :host-context([data-theme="dark"]) .ab input.ab-in { background:var(--s-surface-2); border-color:var(--s-line-2); }
  :host-context([data-theme="dark"]) .ab input.ab-in.ab-ok { border-color:var(--s-green); }
  :host-context([data-theme="dark"]) .ab input.ab-in.ab-bad { border-color:#e0735f; }
  :host-context([data-theme="dark"]) .ab .ab-bad-t { color:#f0a59a; }
  :host-context([data-theme="dark"]) .ab .ab-alert { background:rgba(224,90,72,.12); border-color:rgba(224,90,72,.38); }
  :host-context([data-theme="dark"]) .ab .ab-alert > svg { color:#f08a7c; }
  :host-context([data-theme="dark"]) .ab .ab-alert-t { color:#f0a59a; }
  /* A phone (the editor's own width): Label and Length stacked, the Source a two by two grid with 40px targets. */
  @container (max-width: 560px) {
    .ab .ab-two { grid-template-columns:1fr; }
    .ab .ab-seg { display:grid; grid-template-columns:1fr 1fr; align-self:stretch; }
    .ab .ab-seg button { min-height:40px; font-size:13px; }
    .ab input.ab-in { font-size:15px; padding:10px; }
    .ab .ab-file { flex-wrap:wrap; }
    .ab .ab-file-tx { flex-basis:calc(100% - 46px); }
  }
`;
