// sow-411 (owner, 2026-09-26): "remove network from GBTI Network", "remove GBTI site from the quick launch default 0
// position", "make the top left icon of the main header go to the public site", and "audit all extension settings pages
// that are not the feed and add a breadcrumb back to the feed". Answers: the site's breadcrumb style, on all four pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const PAGES = { 'account.html': 'Settings', 'saved.html': 'Favorites and collections', 'admin.html': 'Admin tools', 'shares.html': 'Shares' };

test('the logo reads GBTI and opens the public site in a new tab', () => {
  const shell = read('extension/src/shell.mjs');
  const brand = shell.slice(shell.indexOf('function brandHtml() {'), shell.indexOf('/** GET /api/* via the background worker'));
  assert.match(brand, /<a class="nt-brand" href="https:\/\/gbti\.network\/" target="_blank" rel="noopener" aria-label="GBTI Network website, opens in a new tab">/);
  assert.match(brand, /<span class="nt-brand-tx">GBTI<\/span>/);
  assert.doesNotMatch(brand, /Network<\/b>|href="newtab\.html"/, 'no "Network" in the wordmark, and it no longer goes to the feed');
});

test('the quick launch has no GBTI chip, in the bar or in its preview', () => {
  const ql = read('extension/src/quick-launch.mjs');
  assert.doesNotMatch(ql, /GBTI_CHIP|GBTI_MARK|nt-app gbti|gbti\.network\/"/);
  assert.match(ql, /aria-hidden="true"><\/span><\/span>\$\{links\}`;/, 'the bar is the gear, then the member\'s own sites');
  const preview = ql.slice(ql.indexOf('function previewHtml() {'), ql.indexOf('function formHtml('));
  assert.match(preview, /\n  return icons;\n\}/, 'the preview is only the member\'s own sites');
  assert.doesNotMatch(read('extension/shell.css'), /\.nt-app\.gbti/);
});

test('every page besides the feed leads back to it with one breadcrumb naming the page', () => {
  const html = readdirSync(new URL('../extension/', import.meta.url)).filter((f) => f.endsWith('.html')).sort();
  assert.deepEqual(html, ['account.html', 'admin.html', 'newtab.html', 'saved.html', 'shares.html'], 'a new page must be added here, with or without a breadcrumb');
  for (const [page, label] of Object.entries(PAGES)) {
    const s = read(`extension/${page}`);
    const crumbs = s.match(/<nav class="crumbs" aria-label="Breadcrumb">[\s\S]*?<\/nav>/g) || [];
    assert.equal(crumbs.length, 1, `${page} has one breadcrumb`);
    assert.equal(crumbs[0], `<nav class="crumbs" aria-label="Breadcrumb"><a class="cc-crumb" href="newtab.html">Feed</a><span class="cc-sep" aria-hidden="true">›</span><span aria-current="page">${label}</span></nav>`);
    const h1 = s.match(/<h1 class="hub-h">(?:<span[^>]*><\/span>)?([^<]+)<\/h1>/);
    assert.equal(h1?.[1], label, `${page}: the crumb names the page's own heading`);
    assert.ok(s.indexOf('<nav class="crumbs"') < s.indexOf('<h1 class="hub-h">'), `${page}: the crumb sits above the heading`);
  }
  assert.doesNotMatch(read('extension/newtab.html'), /class="crumbs"/, 'the feed itself has none');
});

test('the breadcrumb looks like the site\'s: mono, tracked, uppercase, a 35% underline, a faint separator', () => {
  const css = read('extension/shell.css');
  assert.match(css, /\.crumbs \{ display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 \.4em; margin: 0 0 8px; font-family: var\(--f-mono\);\s+font-size: 11px; letter-spacing: \.12em; text-transform: uppercase; color: var\(--green-700\); \}/);
  assert.match(css, /border-bottom: 1px solid color-mix\(in srgb, currentColor 35%, transparent\)/);
  assert.match(css, /\.crumbs \.cc-crumb:hover, \.crumbs \.cc-crumb:focus-visible \{ border-bottom-color: currentColor; \}/);
  assert.match(css, /\.crumbs \.cc-sep \{ opacity: \.55; \}/);
  // The same values the site uses (src/styles/gbti-v3.css, sow-174).
  const site = read('src/styles/gbti-v3.css');
  assert.match(site, /border-bottom: 1px solid color-mix\(in srgb, currentColor 35%, transparent\);/);
  assert.match(site, /\.cc-sep \{ opacity: \.55; \}/);
});
