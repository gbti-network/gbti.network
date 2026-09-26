// sow-406 (owner, 2026-09-25): "We want to make sure there is no workbench support from the extension, but we do
// want members to be able to access their collections and favorites from the avatar menu dropdown." And: "we want
// the GBTI quick launch icon to launch the public website and have our icon as the icon."
//
// Owner's answers: favorites and collections open a small page in the extension; two avatar menu items for them;
// Following and Earnings as links to the website WorkBench; no left menu on any extension page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

import { resolveOpenPage } from '../extension/src/open-page.mjs';
import { savedSectionFromHash, SAVED_SECTIONS } from '../client-ui/src/saved-core.mjs';
import { submitAck, houseEditAck } from '../client-ui/src/workspace-core.mjs';
import { GbtiSaved } from '../client-ui/src/elements/gbti-saved.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const exists = (rel) => existsSync(new URL(`../${rel}`, import.meta.url));

// ---- the WorkBench is gone from the extension ----

test('the extension ships no WorkBench page, script or bundle', () => {
  for (const f of ['extension/workspace.html', 'extension/src/workspace.mjs', 'extension/dist/workspace.js']) {
    assert.equal(exists(f), false, `${f} is back`);
  }
  const build = read('extension/build.mjs');
  assert.equal(/src\('workspace\.mjs'\)/.test(build), false, 'the build still bundles the WorkBench');
  assert.match(build, /entryPoints: \[src\('saved\.mjs'\)\], format: 'iife', outfile: out\('saved\.js'\)/, 'the saved page is not built');
});

test('no extension page or script links to the WorkBench page', () => {
  const files = [
    ...readdirSync(new URL('../extension/', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => `extension/${f}`),
    ...readdirSync(new URL('../extension/src/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `extension/src/${f}`),
  ];
  assert.ok(files.length > 10, 'control: the sweep found the extension sources');
  for (const f of files) assert.equal(/workspace\.html/.test(read(f)), false, `${f} names workspace.html`);
});

test('the open-page relay no longer opens the WorkBench, and opens the saved page', () => {
  assert.equal(resolveOpenPage({ page: 'workspace.html' }), null);
  assert.equal(resolveOpenPage({ page: 'saved.html', hash: 'collections' }), 'saved.html#collections');
});

test('no extension page has a left menu', () => {
  const shell = read('extension/src/shell.mjs');
  for (const gone of ['RAIL_WORKBENCH', 'function railHtml', 'export function setRailActive', 'function wireDrawer', 'data-drawer-toggle']) {
    assert.equal(shell.includes(gone), false, `shell.mjs still has ${gone}`);
  }
  assert.match(shell, /root\.classList\.add\('nt-norail'\);/, 'every page takes the railless layout');
  for (const f of ['newtab', 'shares', 'saved', 'admin', 'account']) {
    const src = read(`extension/src/${f}.mjs`);
    assert.equal(/nav: 'workbench'/.test(src), false, `${f}.mjs still asks for the WorkBench menu`);
    assert.match(src, /initShell\(/, `${f}.mjs does not mount the shell`);
  }
  assert.equal(/\.nt-rail\b|\.nav-i\b|\.nt-burger\b/.test(read('extension/shell.css')), false, 'dead left menu styles are back');
});

test('the Shares and Admin tools pages keep the "+", the new tab does not', () => {
  assert.match(read('extension/src/shares.mjs'), /initShell\(\{ compose: true \}\)/);
  assert.match(read('extension/src/admin.mjs'), /initShell\(\{ compose: true \}\)/);
  assert.match(read('extension/src/shell.mjs'), /function controlsHtml\(\{ compose = false \} = \{\}\)/);
});

// ---- the avatar menu ----

test('the avatar menu: Favorites, Collections, Following, Earnings, Profile, Settings, then staff, no WorkBench', () => {
  const shell = read('extension/src/shell.mjs');
  const menu = shell.slice(shell.indexOf('<div class="me-menu"'), shell.indexOf('data-me-signout'));
  const labels = [...menu.matchAll(/role="menuitem"[^>]*>([^<]+)<\/(?:a|button)>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Favorites', 'Collections', 'Following', 'Earnings', 'Profile', 'Settings', 'Admin tools', 'Debug']);
  assert.equal(/WorkBench<\/a>/.test(menu), false);
  assert.match(menu, /href="saved\.html#favorites"/);
  assert.match(menu, /href="saved\.html#collections"/);
  assert.match(menu, /href="\$\{SITE\}\/workbench\/#tab=subs" target="_blank" rel="noopener">Following</);
  assert.match(menu, /href="\$\{SITE\}\/workbench\/#tab=earnings" target="_blank" rel="noopener">Earnings</);
});

// ---- the saved page ----

test('the saved page mounts the Saved view outside the lock gate', () => {
  const html = read('extension/saved.html');
  // Created by the script after the client is set, never in the markup (it would upgrade first and never load).
  assert.equal(/<gbti-saved>/.test(html.replace(/<!--[\s\S]*?-->/g, '')), false, 'the element is back in the markup');
  assert.match(html, /<div data-saved-slot><\/div>/);
  const js = read('extension/src/saved.mjs');
  assert.ok(js.indexOf('mountPageClient();') < js.indexOf("document.createElement('gbti-saved')"), 'the element is created before the client is set');
  assert.equal(/gbti-lock-gate/.test(html.replace(/<!--[\s\S]*?-->/g, '')), false, 'saving is a free perk: no lock gate');
  assert.match(html, /<script src="dist\/saved\.js"><\/script>/);
  assert.match(read('extension/src/saved.mjs'), /el\.setAttribute\('section', s\)/);
});

test('the hash picks a section, and nothing else does', () => {
  assert.deepEqual(SAVED_SECTIONS, ['favorites', 'collections']);
  assert.equal(savedSectionFromHash('#favorites'), 'favorites');
  assert.equal(savedSectionFromHash('collections'), 'collections');
  assert.equal(savedSectionFromHash('#Collections '), 'collections');
  for (const h of ['', '#', '#saved', '#tab=saved', null, undefined, '#collections&x']) assert.equal(savedSectionFromHash(h), null, String(h));
});

test('the Saved view scrolls to the named section once it has rendered, and once per choice', () => {
  const src = read('client-ui/src/elements/gbti-saved.mjs');
  assert.match(src, /<section class="sec" data-sec="favorites">/);
  assert.match(src, /<section class="sec" data-sec="collections">/);
  const el = new GbtiSaved();
  const scrolled = [];
  el.getAttribute = (k) => (k === 'section' ? 'collections' : null);
  el.$ = (sel) => ({ scrollIntoView: () => scrolled.push(sel) });
  el._activity = null;
  el._scrollToSection();
  assert.deepEqual(scrolled, [], 'nothing to scroll before the list has loaded');
  el._activity = { favorites: [], collections: [] };
  el._scrollToSection();
  el._scrollToSection();
  assert.deepEqual(scrolled, ['[data-sec="collections"]'], 'scrolled exactly once');
  el.attributeChangedCallback();
  assert.equal(scrolled.length, 2, 'choosing again scrolls again');
  el._activity = { favorites: [], collections: [], error: 'not-authenticated' };
  el.attributeChangedCallback();
  assert.equal(scrolled.length, 2, 'no scroll over a sign-in message');
});

// ---- the GBTI quick launch chip ----
// sow-406 made the chip open gbti.network. sow-411 (owner, 2026-09-26) removed it: the logo at the top left opens the
// site now, and the bar holds only the member's own destinations. test/extension-header-crumbs.test.mjs pins both.

// ---- member-facing confirmations name no pull request and no WorkBench ----

test('a member\'s confirmation names no pull request and no WorkBench; staff keep the number', () => {
  for (const autoMerge of [true, false]) {
    const t = submitAck({ prNumber: 597, autoMerge });
    assert.equal(/PR|pull request|#597|WorkBench/i.test(t), false, t);
  }
  assert.equal(submitAck({ prNumber: 597 }), 'Submitted. It appears in about 2 to 3 minutes.');
  assert.match(houseEditAck({ prNumber: 42, autoMerge: true }), /\(PR #42\)\. It merges automatically/);
  assert.equal(/WorkBench/.test(houseEditAck({ prNumber: 42 })), false);
});

test('the reader\'s Edit link leaves the extension for the website WorkBench', () => {
  const src = read('client-ui/src/elements/gbti-reader.mjs');
  assert.match(src, /const wsBase = inExt \? `\$\{SITE\}\/workbench\/` : '\/workbench\/';/);
  assert.match(src, /inExt \? 'Edit on gbti\.network' : 'Edit in workspace'/);
});

test('a role-gated avatar menu item stays hidden for a member', () => {
  // The drive caught Admin tools and Debug showing to a plain member: .mi's display:block beat the [hidden] default.
  const css = read('extension/shell.css');
  assert.match(css, /\.mi \{ display: block;/, 'control: the rule that overrides [hidden] is still there');
  assert.match(css, /\.mi\[hidden\] \{ display: none; \}/);
});
