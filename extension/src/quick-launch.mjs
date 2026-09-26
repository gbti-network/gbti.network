// sow-397 (owner, 2026-09-24): the quick launch in the extension's top bar, and its settings popup.
//
// The bar is the pill beside the view-mode buttons: up to QL_CAP destinations the member has switched on (sow-411
// removed the GBTI chip that led it), each opening in a new tab. On hover or keyboard focus it grows to the LEFT (the cluster is right-aligned)
// and shows a settings button; while nothing is switched on, that button stays visible, since the bar starts empty.
// The popup follows the approved canvas (https://claude.ai/artifact/DpENQPTXFj4S19AHPrBhjV) and the share dialog's
// look (sow-395): the card is the dialog, square 2px corners, a round close button on its corner.
//
// The rules (defaults, merge, cap, daily.dev once) are pure, in quick-launch-core.mjs. This file is DOM + storage.

import {
  QL_CAP, QL_SYNC_KEY, QL_ICONS_KEY, DAILYDEV_SEEN_KEY, GROUPS,
  mergeState, toStored, barItems, overflowItems, setOn, move, moveBefore, addCustom, updateCustom, removeCustom,
  restoreDefaults, applyDailydevDetection, normalizeUrl, displayHost, letterFor,
} from './quick-launch-core.mjs';
import { BRAND_MARKS } from './quick-launch-marks.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const GLYPH = {
  gear: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  x: '<path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  open: '<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
};
const glyph = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${GLYPH[k]}</svg>`;

/** One destination's icon: the bundled official mark, the fetched icon of a custom site, or its letter. */
export function markHtml(item, icons = {}) {
  const m = !item.custom && BRAND_MARKS[item.id];
  if (m) return `<span class="ql-ic" style="--ql-c:${m.hex}" aria-hidden="true"><svg viewBox="${m.viewBox}" focusable="false">${m.paths.map((d) => `<path d="${d}"/>`).join('')}</svg></span>`;
  const icon = icons[item.id];
  if (typeof icon === 'string' && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(icon)) return `<span class="ql-ic ql-img" aria-hidden="true"><img src="${icon}" alt="" /></span>`;
  return `<span class="ql-ic ql-letter" aria-hidden="true">${esc(letterFor(item.name))}</span>`;
}

// ---------------------------------------------------------------------------------------------------- storage
const area = (name) => { try { return globalThis.chrome?.storage?.[name] || null; } catch { return null; } };
async function read(name, key) { try { const a = area(name); return a ? (await a.get(key))?.[key] : undefined; } catch { return undefined; } }
async function write(name, obj) { try { const a = area(name); if (a) await a.set(obj); } catch { /* quota or no storage: the page keeps working */ } }

let STATE = mergeState(null);
let ICONS = {};
const BARS = new Set();
const LISTENERS = new Set();
let saveTimer = null;
const written = []; // the last few values this page wrote, so their echoes are recognized
let listening = false;

function commit(next, { save = true } = {}) {
  STATE = next;
  renderBars();
  LISTENERS.forEach((fn) => fn());
  if (!save) return;
  clearTimeout(saveTimer);
  // Debounced: chrome.storage.sync allows 120 writes a minute, and a member flicking switches should cost one.
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const stored = toStored(STATE);
    written.push(JSON.stringify(stored));
    if (written.length > 6) written.shift();
    write('sync', { [QL_SYNC_KEY]: stored });
  }, 350);
}

async function saveIcon(id, dataUrl) {
  ICONS = { ...ICONS };
  if (dataUrl) ICONS[id] = dataUrl; else delete ICONS[id];
  await write('local', { [QL_ICONS_KEY]: ICONS });
}

/** Ask the Worker for a site's name and icon (POST /membership/og-preview with icon:true, via the background). */
async function lookupSite(url) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'POST', pathname: '/api/og-preview', query: {}, body: { url, icon: true } } });
    return r && r.status >= 200 && r.status < 300 ? (r.json || null) : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------- the bar
// sow-411 (owner, 2026-09-26): "remove GBTI site from the quick launch default 0 position". The GBTI chip sow-406 put
// first in the bar is gone; the logo at the top left opens gbti.network instead, so the bar holds only the member's
// own destinations.
function barHtml() {
  const links = barItems(STATE).map((it) => `<a class="nt-app ql-go" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" title="${esc(it.name)}" aria-label="${esc(it.name)}, opens in a new tab">${markHtml(it, ICONS)}</a>`).join('');
  return `<span class="ql-more"><button class="ql-gear" type="button" data-ql-settings aria-label="Quick launch settings" title="Quick launch settings" aria-haspopup="dialog">${glyph('gear')}</button><span class="ql-sep" aria-hidden="true"></span></span>${links}`;
}

function renderBars() {
  const html = barHtml();
  const empty = barItems(STATE).length === 0;
  for (const el of BARS) {
    if (!el.isConnected) { BARS.delete(el); continue; }
    el.innerHTML = html;
    el.classList.toggle('is-empty', empty);
  }
}

/** Mount the quick launch into a [data-apps] pill. Reads storage, applies the daily.dev rule, and wires settings. */
export async function mountQuickLaunch(el) {
  if (!el) return;
  BARS.add(el);
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Quick launch');
  el.addEventListener('click', (e) => { if (e.target.closest('[data-ql-settings]')) openQuickLaunchSettings(e.target.closest('[data-ql-settings]')); });
  const [stored, icons, seen] = await Promise.all([read('sync', QL_SYNC_KEY), read('local', QL_ICONS_KEY), read('local', DAILYDEV_SEEN_KEY)]);
  ICONS = icons && typeof icons === 'object' ? icons : {};
  const { state, changed } = applyDailydevDetection(mergeState(stored), seen === true);
  commit(state, { save: changed });
  el.classList.add('show');
  if (listening) return;
  listening = true;
  try {
    // Another tab, or another device on the same Chrome profile, changed the list: follow it. Our own write comes back
    // here too, and so can an older one while a newer edit waits to be saved; neither may overwrite what is on screen.
    chrome.storage.onChanged.addListener((changes, name) => {
      if (name === 'sync' && changes[QL_SYNC_KEY] && !saveTimer && !written.includes(JSON.stringify(changes[QL_SYNC_KEY].newValue))) {
        commit(mergeState(changes[QL_SYNC_KEY].newValue), { save: false });
      }
      if (name === 'local' && changes[QL_ICONS_KEY]) { ICONS = changes[QL_ICONS_KEY].newValue || {}; commit(STATE, { save: false }); }
      if (name === 'local' && changes[DAILYDEV_SEEN_KEY]?.newValue === true) {
        const r = applyDailydevDetection(STATE, true);
        if (r.changed) commit(r.state);
      }
    });
  } catch { /* no storage events outside the extension */ }
}

// ---------------------------------------------------------------------------------------------------- the popup
const ADD_COPY = {
  'invalid-url': 'Enter a web address that starts with https://, like https://news.ycombinator.com.',
  'too-many': 'You have added as many of your own sites as the bar can keep. Remove one to add another.',
  duplicate: 'That site is already in your list.',
};

function rowHtml(it, rank) {
  const inBar = it.on && rank < QL_CAP;
  const left = it.on && !inBar;
  const tools = it.custom
    ? `<button class="ql-tool" type="button" data-ql-edit="${esc(it.id)}" aria-label="Edit ${esc(it.name)}" title="Edit">${glyph('pencil')}</button><button class="ql-tool" type="button" data-ql-remove="${esc(it.id)}" aria-label="Remove ${esc(it.name)}" title="Remove">${glyph('trash')}</button>`
    : '';
  const open = left ? `<a class="ql-tool" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(it.name)} in a new tab" title="Open">${glyph('open')}</a>` : '';
  return `<li class="ql-row" data-ql-row="${esc(it.id)}" data-group="${esc(it.group)}" draggable="true">
    <button class="ql-grip" type="button" data-ql-grip="${esc(it.id)}" aria-label="Move ${esc(it.name)}. Use the up and down arrow keys." title="Drag to reorder">${glyph('grip')}</button>
    ${markHtml(it, ICONS)}
    <span class="ql-txt"><b>${esc(it.name)}</b><small>${esc(displayHost(it.url))}${left ? ' · not in the bar, which holds 8' : ''}</small></span>
    ${open}${tools}
    <button class="ql-sw" type="button" role="switch" data-ql-toggle="${esc(it.id)}" aria-checked="${it.on ? 'true' : 'false'}" aria-label="Show ${esc(it.name)} in the bar"><span></span></button>
  </li>`;
}

function listsHtml() {
  const onRank = new Map(STATE.items.filter((it) => it.on).map((it, i) => [it.id, i]));
  return GROUPS.map((g) => {
    const rows = STATE.items.filter((it) => it.group === g.key);
    const body = rows.length
      ? `<ul class="ql-list" data-ql-group="${g.key}">${rows.map((it) => rowHtml(it, onRank.get(it.id) ?? -1)).join('')}</ul>`
      : '<p class="ql-empty">Sites you add show here.</p>';
    return `<section class="ql-sec"><h3 class="ql-eyebrow">${esc(g.label)}</h3>${body}</section>`;
  }).join('');
}

function previewHtml() {
  const items = barItems(STATE);
  const icons = items.map((it) => `<span class="ql-pv" title="${esc(it.name)}">${markHtml(it, ICONS)}</span>`).join('');
  return icons;
}

function formHtml({ id = '', url = '', name = '' } = {}) {
  return `<form class="ql-form" data-ql-form="${esc(id)}" novalidate>
    <b class="ql-form-h">${id ? 'Edit destination' : 'Add a destination'}</b>
    <label class="ql-field"><span>Address</span><input type="url" name="url" inputmode="url" autocomplete="url" placeholder="https://" value="${esc(url)}" required /></label>
    <div class="ql-form-row">
      <span class="ql-form-ic" data-ql-form-ic>${markHtml({ id: id || 'new', name: name || displayHost(url) || '?', custom: true }, ICONS)}</span>
      <label class="ql-field ql-grow"><span>Name</span><input type="text" name="name" maxlength="40" value="${esc(name)}" placeholder="Found from the site" /></label>
    </div>
    <p class="ql-status" data-ql-status aria-live="polite"></p>
    <div class="ql-form-acts"><button class="ql-btn" type="button" data-ql-cancel>Cancel</button><button class="ql-btn ql-primary" type="submit">${id ? 'Save' : 'Add to your bar'}</button></div>
  </form>`;
}

let dialogOpen = null;

/** Open the settings popup. `opener` gets focus back when it closes. */
export function openQuickLaunchSettings(opener = null) {
  if (dialogOpen) return dialogOpen;
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal ql-overlay';
  overlay.innerHTML = `<div class="ql-dialog" role="dialog" aria-modal="true" aria-labelledby="ql-title">
    <button class="share-x" type="button" data-ql-close aria-label="Close">${glyph('x')}</button>
    <div class="ql-head"><h2 id="ql-title">Quick launch</h2><p>Choose what sits in your bar. Drag to change the order, or add a site of your own.</p></div>
    <div class="ql-preview"><span class="ql-eyebrow">Your bar</span><div class="ql-pbar" data-ql-preview></div><p class="ql-note" data-ql-note hidden></p></div>
    <div data-ql-lists></div>
    <div data-ql-add><button class="ql-addbtn" type="button" data-ql-add-open>${glyph('plus')}Add a destination</button></div>
    <div class="ql-foot"><div data-ql-restore-slot><button class="ql-link" type="button" data-ql-restore>Restore defaults</button></div><button class="ql-btn ql-primary" type="button" data-ql-close>Done</button></div>
    <p class="ql-sr" aria-live="polite" data-ql-live></p>
  </div>`;
  const $ = (sel) => overlay.querySelector(sel);
  const say = (msg) => { const l = $('[data-ql-live]'); if (l) l.textContent = msg; };
  let editing = null; // id of the custom row being edited, or '' for a new one

  const paint = () => {
    const focusKey = document.activeElement?.closest?.('.ql-dialog') ? keyOf(document.activeElement) : null;
    $('[data-ql-preview]').innerHTML = previewHtml();
    const extra = overflowItems(STATE).length;
    const note = $('[data-ql-note]');
    note.hidden = extra === 0;
    note.textContent = extra ? `The bar holds ${QL_CAP}. ${extra === 1 ? 'One more site is' : `${extra} more sites are`} switched on: move ${extra === 1 ? 'it' : 'them'} up to show ${extra === 1 ? 'it' : 'them'}, or open ${extra === 1 ? 'it' : 'them'} from the list.` : '';
    $('[data-ql-lists]').innerHTML = listsHtml();
    if (focusKey) overlay.querySelector(focusKey)?.focus();
  };
  const keyOf = (el) => {
    for (const a of ['data-ql-toggle', 'data-ql-grip', 'data-ql-edit', 'data-ql-remove']) if (el.hasAttribute?.(a)) return `[${a}="${CSS.escape(el.getAttribute(a))}"]`;
    return null;
  };

  const closeForm = () => { editing = null; $('[data-ql-add]').innerHTML = `<button class="ql-addbtn" type="button" data-ql-add-open>${glyph('plus')}Add a destination</button>`; };
  const openForm = (it = null) => {
    editing = it ? it.id : '';
    const slot = $('[data-ql-add]');
    slot.innerHTML = formHtml(it || {});
    wireForm(slot.querySelector('form'), it);
    slot.querySelector('input[name="url"]').focus();
  };

  function wireForm(form, current) {
    const urlIn = form.querySelector('input[name="url"]');
    const nameIn = form.querySelector('input[name="name"]');
    const status = form.querySelector('[data-ql-status]');
    const icSlot = form.querySelector('[data-ql-form-ic]');
    let found = { url: current?.url || '', icon: current ? ICONS[current.id] || null : null };
    let nameTouched = Boolean(current);
    let seq = 0;
    nameIn.addEventListener('input', () => { nameTouched = true; });
    const showIcon = () => { icSlot.innerHTML = markHtml({ id: 'preview', name: nameIn.value || displayHost(found.url) || '?', custom: true }, found.icon ? { preview: found.icon } : {}); };
    const look = async () => {
      const href = normalizeUrl(urlIn.value);
      if (!href) { if (urlIn.value.trim()) status.textContent = ADD_COPY['invalid-url']; return; }
      if (href === found.url && (found.icon || found.done)) return;
      const mine = ++seq;
      found = { url: href, icon: null };
      status.textContent = 'Looking up the site...';
      showIcon();
      const r = await lookupSite(href);
      if (mine !== seq) return;
      found = { url: href, icon: r?.icon || null, done: true };
      if (!nameTouched && r?.title) nameIn.value = r.title;
      if (!nameIn.value) nameIn.value = displayHost(href);
      status.innerHTML = r?.icon ? `${glyph('check')}Found its name and icon` : 'No icon found, so it shows as a letter.';
      status.classList.toggle('ok', Boolean(r?.icon));
      showIcon();
    };
    let t = null;
    urlIn.addEventListener('input', () => { status.textContent = ''; clearTimeout(t); t = setTimeout(look, 700); });
    urlIn.addEventListener('change', look);
    form.querySelector('[data-ql-cancel]').addEventListener('click', () => { closeForm(); $('[data-ql-add-open]')?.focus(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const href = normalizeUrl(urlIn.value);
      if (!href) { status.textContent = ADD_COPY['invalid-url']; urlIn.focus(); return; }
      if (href !== found.url) await look();
      const res = current ? updateCustom(STATE, current.id, { url: href, name: nameIn.value }) : addCustom(STATE, { url: href, name: nameIn.value });
      if (res.error) { status.textContent = ADD_COPY[res.error] || 'That did not work. Check the address and try again.'; return; }
      const id = current ? current.id : res.item.id;
      if (!current || href !== current.url) await saveIcon(id, found.icon);
      closeForm();
      commit(res.state);
      say(current ? `${nameIn.value || displayHost(href)} saved.` : `${res.item.name} added to your bar.`);
      overlay.querySelector(`[data-ql-toggle="${CSS.escape(id)}"]`)?.focus();
    });
  }

  overlay.addEventListener('click', async (e) => {
    const t = e.target;
    if (t === overlay) { if (editing === null) close(); return; } // an open form keeps the popup, so typing is not lost
    const hit = (a) => t.closest(`[${a}]`)?.getAttribute(a);
    if (t.closest('[data-ql-close]')) { close(); return; }
    if (t.closest('[data-ql-add-open]')) { openForm(); return; }
    const tog = hit('data-ql-toggle');
    if (tog != null) {
      const it = STATE.items.find((x) => x.id === tog);
      commit(setOn(STATE, tog, !it.on));
      const now = barItems(STATE).some((x) => x.id === tog);
      say(it.on ? `${it.name} is off.` : now ? `${it.name} is in your bar.` : `${it.name} is on, but the bar holds ${QL_CAP}.`);
      return;
    }
    const ed = hit('data-ql-edit');
    if (ed != null) { openForm(STATE.items.find((x) => x.id === ed)); return; }
    const rm = hit('data-ql-remove');
    if (rm != null) {
      const it = STATE.items.find((x) => x.id === rm);
      commit(removeCustom(STATE, rm));
      await saveIcon(rm, null);
      say(`${it?.name || 'The site'} removed.`);
      $('[data-ql-add-open]')?.focus();
      return;
    }
    if (t.closest('[data-ql-restore]')) {
      $('[data-ql-restore-slot]').innerHTML = '<span class="ql-confirm">Switch every built-in site off and reset their order? Your own sites stay. <button class="ql-link" type="button" data-ql-restore-yes>Restore</button> <button class="ql-link" type="button" data-ql-restore-no>Keep</button></span>';
      $('[data-ql-restore-no]').focus();
      return;
    }
    if (t.closest('[data-ql-restore-yes]') || t.closest('[data-ql-restore-no]')) {
      if (t.closest('[data-ql-restore-yes]')) { commit(restoreDefaults(STATE)); say('Defaults restored.'); }
      $('[data-ql-restore-slot]').innerHTML = '<button class="ql-link" type="button" data-ql-restore>Restore defaults</button>';
      $('[data-ql-restore]').focus();
    }
  });

  // Keyboard reorder on the grip: up and down move the row within its group.
  overlay.addEventListener('keydown', (e) => {
    const id = e.target.closest?.('[data-ql-grip]')?.getAttribute('data-ql-grip');
    if (!id || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const next = move(STATE, id, e.key === 'ArrowUp' ? -1 : 1);
    if (next === STATE) return;
    commit(next);
    const it = STATE.items.find((x) => x.id === id);
    const group = STATE.items.filter((x) => x.group === it.group);
    say(`${it.name}, position ${group.findIndex((x) => x.id === id) + 1} of ${group.length}.`);
    overlay.querySelector(`[data-ql-grip="${CSS.escape(id)}"]`)?.focus();
  });

  // Drag to reorder, within a group.
  let dragId = null;
  overlay.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('[data-ql-row]');
    if (!row) return;
    dragId = row.getAttribute('data-ql-row');
    row.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch { /* ok */ }
  });
  overlay.addEventListener('dragover', (e) => {
    const row = e.target.closest?.('[data-ql-row]');
    const src = dragId && STATE.items.find((x) => x.id === dragId);
    if (!row || !src || row.dataset.group !== src.group) return;
    e.preventDefault();
    overlay.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  overlay.addEventListener('drop', (e) => {
    const row = e.target.closest?.('[data-ql-row]');
    if (!row || !dragId) return;
    e.preventDefault();
    const after = row.classList.contains('drop-after');
    let beforeId = row.getAttribute('data-ql-row');
    if (after) { const nx = row.nextElementSibling; beforeId = nx ? nx.getAttribute('data-ql-row') : null; }
    if (beforeId !== dragId) commit(moveBefore(STATE, dragId, beforeId));
  });
  overlay.addEventListener('dragend', () => {
    dragId = null;
    overlay.querySelectorAll('.dragging, .drop-before, .drop-after').forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after'));
  });

  const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (editing !== null) { closeForm(); $('[data-ql-add-open]')?.focus(); } else close(); } };
  // Every change repaints the preview and the lists (the add form lives outside them, so typing is never lost): this
  // popup's own edits, and one made in another tab or on another device on the same Chrome profile.
  const onChange = () => paint();
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onEsc, true);
    LISTENERS.delete(onChange);
    dialogOpen = null;
    // Every change re-renders the bar, so the button that opened the popup is usually gone by now: focus its successor.
    (opener?.isConnected ? opener : document.querySelector('[data-apps] [data-ql-settings]'))?.focus?.();
  }
  document.addEventListener('keydown', onEsc, true);
  LISTENERS.add(onChange);
  document.body.appendChild(overlay);
  paint();
  $('.ql-dialog [data-ql-close]').focus();
  dialogOpen = { overlay, close };
  return dialogOpen;
}
