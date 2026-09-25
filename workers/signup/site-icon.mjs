// sow-397: a site's NAME and ICON for the extension's quick launch, where a member adds a destination of their own.
// The extension cannot fetch an arbitrary site (its host permissions are gbti.network, the Worker and GitHub), so the
// Worker reads the page once, finds the icon the page declares, fetches it, and hands it back as a data URL. The
// extension stores that in chrome.storage.local, so nothing is requested again when a new tab opens.
//
// Reached through POST /membership/og-preview with { url, icon: true } (membership-og.mjs), which has already
// authenticated the member and SSRF-checked the page address. Every icon address is checked again here, because the
// page names it and the page is not trusted. Pure over the injected fetch; never throws.

import { attr } from '../lib/og-scrape.mjs';
import { decodeHtmlEntities } from '../../membership/html-entities.mjs';

export const ICON_MAX_BYTES = 64 * 1024;
const PAGE_MAX_BYTES = 60000;
const NAME_MAX = 40;
const MAX_ICON_TRIES = 3;
const UA = 'gbti-link-preview/0.1 (+https://gbti.network)';
// Image types a browser draws in an <img>. An SVG in an <img> runs no script, so it is safe to hand back.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/avif']);

/** The site's name: og:site_name, then application-name, then <title>. Trimmed and capped. '' when none. */
export function siteNameFrom(html) {
  const head = String(html || '').slice(0, PAGE_MAX_BYTES);
  const meta = (key) => {
    for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
      const k = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
      if (k === key) return attr(tag, 'content');
    }
    return '';
  };
  const title = (head.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const raw = meta('og:site_name') || meta('application-name') || title;
  return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** The icons a page declares, best first: apple-touch-icon (large, square), then icons by declared size, then
 *  /favicon.ico at the page's origin. Absolute http(s) URLs only. */
export function iconCandidates(html, pageUrl) {
  const head = String(html || '').slice(0, PAGE_MAX_BYTES);
  const found = [];
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/);
    const href = attr(tag, 'href');
    if (!href || !(rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed'))) continue;
    let abs;
    try { abs = new URL(decodeHtmlEntities(href), pageUrl); } catch { continue; }
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue;
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    const size = Math.max(0, ...String(attr(tag, 'sizes')).split(/\s+/).map((s) => parseInt(s, 10) || 0));
    found.push({ url: abs.toString(), rank: (touch ? 1000 : 0) + Math.min(size, 512) });
  }
  found.sort((a, b) => b.rank - a.rank);
  const out = [...new Set(found.map((f) => f.url))];
  try { out.push(new URL('/favicon.ico', pageUrl).toString()); } catch { /* no origin */ }
  return [...new Set(out)];
}

function base64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function timed(fetchImpl, url, init, timeoutMs) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}

/** Fetch one icon as a data URL, or null: refused host, not an image, empty, or over the size cap. */
async function fetchIcon(url, { fetchImpl, timeoutMs, safeTarget }) {
  const target = safeTarget(url);
  if (!target.ok) return null;
  try {
    const res = await timed(fetchImpl, target.url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'image/*' }, cf: { cacheTtl: 86400, cacheEverything: true } }, timeoutMs);
    if (!res || !res.ok) return null;
    const type = String(res.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) return null;
    const declared = Number(res.headers?.get?.('content-length') || 0);
    if (declared > ICON_MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > ICON_MAX_BYTES) return null;
    return `data:${type};base64,${base64(bytes)}`;
  } catch {
    return null;
  }
}

/** { ok: true, title, icon, reason }. `icon` is a data URL or null; `reason` says why it is null. */
export async function resolveSiteIcon(pageUrl, { fetchImpl = globalThis.fetch, timeoutMs = 8000, safeTarget } = {}) {
  let html = '';
  let base = pageUrl;
  try {
    const res = await timed(fetchImpl, pageUrl, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, cf: { cacheTtl: 1800, cacheEverything: true } }, timeoutMs);
    if (res && res.ok && /html|xml/i.test(res.headers?.get?.('content-type') || 'text/html')) {
      html = String(await res.text()).slice(0, PAGE_MAX_BYTES);
      if (res.url) base = res.url;
    }
  } catch { /* unreachable: fall back to /favicon.ico below */ }
  const title = siteNameFrom(html) || null;
  const tries = iconCandidates(html, base).slice(0, MAX_ICON_TRIES);
  for (const url of tries) {
    const icon = await fetchIcon(url, { fetchImpl, timeoutMs, safeTarget });
    if (icon) return { ok: true, title, icon, reason: null };
  }
  return { ok: true, title, icon: null, reason: 'no-icon' };
}
