// sow-400 (owner, 2026-09-26): the homepage extension banner moves from above the feed to BETWEEN the end of the
// feed and the Articles section. The owner's answers, pinned here:
//   - one banner (moved, not duplicated);
//   - shown to everyone WITHOUT the extension, signed-in members included, hidden once it is installed;
//   - content width and the same look;
//   - still governed by the one extension CTA site setting;
//   - hidden with the sections when a content tab narrows the feed.
// The switch itself is proven in both positions over the built HTML by scripts/check-extension-cta.mjs, whose
// 'class="xbn"' marker this move must keep matching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CTA_MARKERS } from '../scripts/check-extension-cta.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const home = stripComments(read('src/pages/index.astro'));
const banner = read('src/components/home/ExtensionBanner.astro');
const bannerMarkup = stripComments(banner.split('---')[2] || '');

test('sow-400: mounted once, as the first thing inside the section blocks, and not above the feed', () => {
  const mounts = [...home.matchAll(/<ExtensionBanner\s*\/>/g)];
  assert.equal(mounts.length, 1, 'one banner, moved rather than duplicated');
  const sections = home.indexOf('<div data-home-sections>');
  const feed = home.indexOf('<div class="wrap feedwrap">');
  assert.ok(feed > -1 && sections > feed, 'the page shape this test reads has changed');
  const at = mounts[0].index;
  assert.ok(at > sections, 'the banner must sit inside [data-home-sections], so a content tab hides it with them');
  const firstSection = home.indexOf('<section', sections);
  assert.ok(at < firstSection, 'the banner must come before Articles, the first section');
});

test('sow-400: signed-in members see it; only an installed extension hides it', () => {
  assert.equal(/data-home-joincard/.test(bannerMarkup), false, 'the join-card hook hides it for every signed-in member');
  assert.match(banner, /:global\(html\[data-gbti-extension\]\) \.xbn-wrap \{ display: none; \}/);
  assert.match(bannerMarkup, /<div class="wrap xbn-wrap">\s*<a\s+class="xbn"/, 'the wrapper the installed rule hides');
  // The attribute the rule keys on is the one the extension's content script actually sets.
  assert.match(read('extension/src/content.mjs'), /document\.documentElement\.dataset\.gbtiExtension = /);
});

test('sow-400: still behind the one extension CTA switch, gated inside the component', () => {
  assert.match(banner, /const show = extensionCtaEnabled\(\);/);
  assert.match(bannerMarkup, /^\s*\{show && \(\s*<div class="wrap xbn-wrap">/, 'the whole banner, wrapper included, is inside the gate');
  assert.ok(CTA_MARKERS.some(([, m]) => m === 'class="xbn"'), 'the build guard marker for this banner');
  assert.match(bannerMarkup, /class="xbn"/, 'the markup still carries the marker the build guard looks for');
});
