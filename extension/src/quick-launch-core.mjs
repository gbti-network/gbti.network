// sow-397 (owner, 2026-09-24): the new tab's quick launch, the row of sites beside the GBTI chip. This file is PURE:
// the default destinations, the merge of what is stored over them, address checking, the cap, and the daily.dev rule.
// The bar and the settings popup are extension/src/quick-launch.mjs.
//
// Storage: the list lives in chrome.storage.sync under QL_SYNC_KEY, so it follows the member's Chrome profile. Sync
// allows 8 KB per item, which is why the stored shape is compact and custom entries are capped. Fetched icons for
// custom destinations live in chrome.storage.local under QL_ICONS_KEY, keyed by destination id, since images would
// blow the sync quota.

export const QL_CAP = 8;
export const QL_SYNC_KEY = 'quickLaunch';
export const QL_ICONS_KEY = 'quickLaunchIcons';
export const QL_MAX_CUSTOM = 16;
export const QL_NAME_MAX = 40;
export const QL_URL_MAX = 256;

// daily.dev is detected from the content script on gbti.network: an https page may load one of the files daily.dev
// exposes to every site (its manifest lists css/companion.css for *://*/*), and an extension page may not. The result
// is written to chrome.storage.local under DAILYDEV_SEEN_KEY. No new permission.
export const DAILYDEV_EXTENSION_ID = 'jlmpjdjjbgclbocgajdjefcidcncaied';
export const DAILYDEV_PROBE_URL = `chrome-extension://${DAILYDEV_EXTENSION_ID}/css/companion.css`;
export const DAILYDEV_SEEN_KEY = 'dailydevDetected';
export const DAILYDEV_CHECKED_KEY = 'dailydevCheckedAt';
const PROBE_EVERY_MS = 24 * 60 * 60 * 1000;

/** Whether the content script should look for daily.dev now. Never again once it was found (the switch-on happens
 *  once), and at most once a day otherwise: a miss logs a load error in the page console, which should not happen on
 *  every page a member opens. */
export function shouldProbeDailydev({ seen, checkedAt, now = Date.now() } = {}) {
  if (seen === true) return false;
  const at = Number(checkedAt);
  return !Number.isFinite(at) || at <= 0 || now - at >= PROBE_EVERY_MS || at > now;
}

export const GROUPS = Object.freeze([
  { key: 'ai', label: 'Frontier AI' },
  { key: 'social', label: 'Social' },
  { key: 'custom', label: 'Your destinations' },
]);

// Owner's intake (2026-09-24): the five frontier AI sites, and the social sites GBTI syndicates to plus Substack.
// Every one starts OFF; a first-install tour (sow-401) shows the member the bar. Discord is the GBTI server (the guild
// id is public, workers/signup/wrangler.toml).
export const DEFAULTS = Object.freeze([
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', group: 'ai' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/', group: 'ai' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/', group: 'ai' },
  { id: 'grok', name: 'Grok', url: 'https://grok.com/', group: 'ai' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', group: 'ai' },
  { id: 'x', name: 'X', url: 'https://x.com/', group: 'social' },
  { id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app/', group: 'social' },
  { id: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com/', group: 'social' },
  { id: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/', group: 'social' },
  { id: 'discord', name: 'Discord', url: 'https://discord.com/channels/1073029070411006053', group: 'social' },
  { id: 'devto', name: 'DEV', url: 'https://dev.to/', group: 'social' },
  { id: 'dailydev', name: 'daily.dev', url: 'https://app.daily.dev/', group: 'social' },
  { id: 'substack', name: 'Substack', url: 'https://substack.com/', group: 'social' },
]);
const DEFAULT_BY_ID = new Map(DEFAULTS.map((d) => [d.id, d]));
const GROUP_RANK = Object.fromEntries(GROUPS.map((g, i) => [g.key, i]));
const CUSTOM_ID_RE = /^c-[a-z0-9]{1,24}$/;

/** A destination address, or null. https only, no credentials, a real host name. A bare host gets https://. */
export function normalizeUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s || s.length > QL_URL_MAX) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return null;
  const href = u.toString();
  return href.length > QL_URL_MAX ? null : href;
}

/** The host as a member reads it: no scheme, no leading www. */
export function displayHost(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return ''; }
}

/** A name as stored: control characters out, whitespace collapsed, capped. */
export function cleanName(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, QL_NAME_MAX).trim();
}

/** The letter a custom destination shows when no icon was found. */
export function letterFor(name) {
  const m = String(name || '').match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '?';
}

function groupSort(items) {
  return items.map((it, i) => [it, i]).sort((a, b) => (GROUP_RANK[a[0].group] - GROUP_RANK[b[0].group]) || (a[1] - b[1])).map(([it]) => it);
}

/** The state the bar and the popup read: every destination in order (grouped), each with `on`. */
export function mergeState(stored) {
  const st = stored && typeof stored === 'object' ? stored : {};
  const customs = [];
  const seen = new Set();
  for (const c of Array.isArray(st.custom) ? st.custom : []) {
    if (customs.length >= QL_MAX_CUSTOM) break;
    const id = String(c?.id || '');
    const url = normalizeUrl(c?.url);
    if (!CUSTOM_ID_RE.test(id) || seen.has(id) || !url) continue;
    seen.add(id);
    customs.push({ id, name: cleanName(c?.name) || displayHost(url), url, group: 'custom', custom: true });
  }
  const known = new Map([...DEFAULTS.map((d) => [d.id, { ...d, custom: false }]), ...customs.map((c) => [c.id, c])]);
  const order = [];
  for (const id of Array.isArray(st.order) ? st.order : []) if (known.has(id) && !order.includes(id)) order.push(id);
  for (const id of known.keys()) if (!order.includes(id)) order.push(id);
  const on = new Set((Array.isArray(st.on) ? st.on : []).filter((id) => known.has(id)));
  const items = groupSort(order.map((id) => ({ ...known.get(id), on: on.has(id) })));
  return { items, dailydevAuto: st.dailydevAuto === true };
}

/** The compact shape written to chrome.storage.sync. */
export function toStored(state) {
  return {
    v: 1,
    order: state.items.map((it) => it.id),
    on: state.items.filter((it) => it.on).map((it) => it.id),
    custom: state.items.filter((it) => it.custom).map(({ id, name, url }) => ({ id, name, url })),
    dailydevAuto: state.dailydevAuto === true,
  };
}

/** What the bar shows: the first QL_CAP switched-on destinations, in order. */
export function barItems(state) {
  return state.items.filter((it) => it.on).slice(0, QL_CAP);
}

/** Destinations switched on that the bar has no room for. */
export function overflowItems(state) {
  return state.items.filter((it) => it.on).slice(QL_CAP);
}

const withItems = (state, items) => ({ ...state, items: groupSort(items) });

export function setOn(state, id, on) {
  return withItems(state, state.items.map((it) => (it.id === id ? { ...it, on: on === true } : it)));
}

/** Move a destination one place up (-1) or down (+1) within its own group. */
export function move(state, id, delta) {
  const items = [...state.items];
  const i = items.findIndex((it) => it.id === id);
  if (i < 0) return state;
  const j = i + (delta < 0 ? -1 : 1);
  if (j < 0 || j >= items.length || items[j].group !== items[i].group) return state;
  [items[i], items[j]] = [items[j], items[i]];
  return withItems(state, items);
}

/** Move a destination to just before `beforeId` (or to the end of its group when beforeId is null). Same group only. */
export function moveBefore(state, id, beforeId) {
  const it = state.items.find((x) => x.id === id);
  if (!it || id === beforeId) return state;
  const rest = state.items.filter((x) => x.id !== id);
  let at;
  if (beforeId == null) {
    const lastOfGroup = rest.map((x) => x.group).lastIndexOf(it.group);
    at = lastOfGroup + 1;
  } else {
    at = rest.findIndex((x) => x.id === beforeId);
    if (at < 0 || rest[at].group !== it.group) return state;
  }
  rest.splice(at, 0, it);
  return withItems(state, rest);
}

/** Add a destination of the member's own. { state, item } or { error: 'invalid-url' | 'too-many' | 'duplicate' }. */
export function addCustom(state, { url, name } = {}, newId = () => `c-${Math.random().toString(36).slice(2, 12)}`) {
  const href = normalizeUrl(url);
  if (!href) return { error: 'invalid-url' };
  const customs = state.items.filter((it) => it.custom);
  if (customs.length >= QL_MAX_CUSTOM) return { error: 'too-many' };
  if (customs.some((it) => it.url === href)) return { error: 'duplicate' };
  let id = newId();
  while (state.items.some((it) => it.id === id) || !CUSTOM_ID_RE.test(id)) id = `c-${Math.random().toString(36).slice(2, 12)}`;
  const item = { id, name: cleanName(name) || displayHost(href), url: href, group: 'custom', custom: true, on: true };
  return { state: withItems(state, [...state.items, item]), item };
}

/** Change a custom destination's name or address. { state } or { error }. */
export function updateCustom(state, id, { url, name } = {}) {
  const cur = state.items.find((it) => it.id === id && it.custom);
  if (!cur) return { error: 'not-found' };
  const href = url === undefined ? cur.url : normalizeUrl(url);
  if (!href) return { error: 'invalid-url' };
  if (state.items.some((it) => it.custom && it.id !== id && it.url === href)) return { error: 'duplicate' };
  const next = { ...cur, url: href, name: cleanName(name ?? cur.name) || displayHost(href) };
  return { state: withItems(state, state.items.map((it) => (it.id === id ? next : it))) };
}

export function removeCustom(state, id) {
  return withItems(state, state.items.filter((it) => !(it.id === id && it.custom)));
}

/** Restore defaults: the built-in sites go back to their first order, all switched off. The member's own
 *  destinations stay as they are, and so does the record that daily.dev was already switched on once. */
export function restoreDefaults(state) {
  const customs = state.items.filter((it) => it.custom);
  return withItems(state, [...DEFAULTS.map((d) => ({ ...d, custom: false, on: false })), ...customs]);
}

/** Owner ruling (2026-09-24): daily.dev is switched on the FIRST time it is detected, and never again, so a member
 *  who switches it off keeps it off. { state, changed }. */
export function applyDailydevDetection(state, detected) {
  if (detected !== true || state.dailydevAuto === true) return { state, changed: false };
  const next = setOn(state, 'dailydev', true);
  return { state: { ...next, dailydevAuto: true }, changed: true };
}

export function isDefaultId(id) {
  return DEFAULT_BY_ID.has(id);
}
