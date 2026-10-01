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
  assert.match(bannerMarkup, /<div class=\{inline \? 'xbn-wrap xbn-inline' : 'wrap xbn-wrap'\}>\s*<a\s+class="xbn"/, 'the wrapper the installed rule hides (sow-435: inline drops only the page gutters)');
  // The attribute the rule keys on is the one the extension's content script actually sets.
  assert.match(read('extension/src/content.mjs'), /document\.documentElement\.dataset\.gbtiExtension = /);
});

test('sow-400: still behind the one extension CTA switch, gated inside the component', () => {
  assert.match(banner, /const show = extensionCtaEnabled\(\);/);
  assert.match(bannerMarkup, /^\s*\{show && \(\s*<div class=\{inline \? 'xbn-wrap xbn-inline' : 'wrap xbn-wrap'\}>/, 'the whole banner, wrapper included, is inside the gate');
  assert.ok(CTA_MARKERS.some(([, m]) => m === 'class="xbn"'), 'the build guard marker for this banner');
  assert.match(bannerMarkup, /class="xbn"/, 'the markup still carries the marker the build guard looks for');
});

// sow-433 (owner, 2026-09-30, design A2 on the canvas "Homepage Extension Banner"): much bigger, an angled screenshot of
// the extension's network feed, and a Chrome blue "Add to Chrome" with the colour Chrome logo. Driven in a browser in
// light, dark, a laptop, a tablet and a phone before shipping. (The screenshot follows the theme since sow-436, below.)
const css = banner.split('<style>')[1] || '';

test('sow-433: the button is Chrome blue and carries the colour Chrome logo', () => {
  assert.match(css, /\.xbn-cta \{[^}]*background: #1a73e8;[^}]*color: #fff;/);
  assert.match(css, /\.xbn:hover \.xbn-cta \{ background: #1765cc; \}/);
  for (const colour of ['#EA4335', '#34A853', '#FBBC04', '#1A73E8']) assert.ok(bannerMarkup.includes(`"${colour}"`), `the logo has ${colour}`);
  assert.match(bannerMarkup, /<span class="xbn-logo" aria-hidden="true">/);
});

test('sow-433: the screenshot is the shipped asset, decorative, inside the angled frame', () => {
  assert.match(banner, /import newtabShot from '\.\.\/\.\.\/assets\/extension\/newtab-network\.webp';/);
  assert.match(bannerMarkup, /<span class="xbn-shot" aria-hidden="true">[\s\S]*?<Image class="xbn-img xbn-img-dark" src=\{newtabShot\} alt="" widths=\{\[480, 720, 1280\]\}[^>]*loading="lazy" \/>/);
  assert.match(css, /\.xbn-shot \{[^}]*transform: perspective\(1800px\) rotateY\(-15deg\) rotateX\(6deg\) rotate\(-1deg\);/);
  const asset = new URL('../src/assets/extension/newtab-network.webp', import.meta.url);
  const size = readFileSync(asset).length;
  assert.ok(size > 10_000 && size < 250_000, `the screenshot is a real, optimized image (${size} bytes)`);
});

test('sow-433: the copy the owner kept (lead line rewritten by the owner, 2026-10-01)', () => {
  assert.match(bannerMarkup, /<span class="xbn-title">Launch the Chrome Extension<\/span>/);
  assert.match(bannerMarkup, /<span class="xbn-eyebrow">Thanks for paying attention<\/span>/);
  assert.match(bannerMarkup, /<span class="xbn-lead">Stay informed and up to date by installing our Chrome extension into your new tab page experience\.<\/span>/);
  assert.match(bannerMarkup, /<span class="xbn-note">Free · one click<\/span>/);
});

test('sow-433: dark mode keeps the near-black panel, and a phone stacks the text above the screenshot', () => {
  assert.match(css, /:global\(\[data-theme="dark"\]\) \.xbn \{\s*background: #141218;/);
  assert.match(css, /:global\(\[data-theme="dark"\]\) \.xbn-title \{ color: #f3f2f0; \}/);
  const phone = /@container \(max-width: 600px\) \{([\s\S]*?)\n  \}/.exec(css)?.[1] || '';
  assert.match(phone, /\.xbn \{ height: auto;/);
  assert.match(phone, /\.xbn-text \{ position: static;/);
  assert.match(phone, /\.xbn-shot \{\s*position: relative;/);
});

// sow-435 (owner, 2026-09-30): the same banner under the discussion on share pages. It measures itself, so the narrow
// layouts follow its own width (a share column, a tablet, a phone) rather than the window's.
test('sow-435: the banner follows its own width, and the inline form drops only the page gutters', () => {
  assert.match(css, /\.xbn-wrap \{ container-type: inline-size; \}/);
  assert.match(css, /@container \(max-width: 860px\) \{/);
  assert.match(css, /@container \(max-width: 600px\) \{/);
  assert.doesNotMatch(css, /@media \(max-width/, 'no viewport breakpoints left to disagree with the container ones');
  assert.ok(css.indexOf('@container (max-width: 860px)') > css.indexOf(':global([data-theme="dark"]) .xbn-title'), 'the container blocks come last');
  assert.match(banner, /const \{ inline = false \} = Astro\.props;/);
});

test('sow-435: share pages mount the inline banner right after the discussion', () => {
  const share = stripComments(read('src/pages/shares/[author]/[id].astro'));
  assert.match(share, /<Comments targetType="share" targetSlug=\{slug\} author=\{d\.author\} wide=\{true\} \/>\s*(\{\})?\s*<ExtensionBanner inline \/>/, 'the banner follows the discussion (the comment between them is stripped to {})');
  assert.equal([...home.matchAll(/<ExtensionBanner\s*\/>/g)].length, 1, 'the homepage still mounts the full-width form once');
});

// sow-436 (owner, 2026-10-01, after seeing it on the canvas): light mode shows the light screenshot and dark mode the
// dark one. Both are lazy and the hidden one is display:none, so a reader downloads only the picture for their theme.
test('sow-436: the light screenshot is a real asset, rendered beside the dark one with the same attributes', () => {
  assert.match(banner, /import newtabShotLight from '\.\.\/\.\.\/assets\/extension\/newtab-network-light\.webp';/);
  const shot = /<span class="xbn-shot" aria-hidden="true">([\s\S]*?)<\/span>\s*<\/a>/.exec(bannerMarkup)?.[1] || '';
  const attrs = ' alt="" widths={[480, 720, 1280]} sizes="(max-width: 640px) 420px, 700px" loading="lazy" />';
  assert.ok(shot.includes(`<Image class="xbn-img xbn-img-light" src={newtabShotLight}${attrs}`), 'the light image, lazy and responsive');
  assert.ok(shot.includes(`<Image class="xbn-img xbn-img-dark" src={newtabShot}${attrs}`), 'the dark image, the same attributes');
  assert.equal([...shot.matchAll(/<Image /g)].length, 2, 'exactly the two screenshots in the frame');
  const size = readFileSync(new URL('../src/assets/extension/newtab-network-light.webp', import.meta.url)).length;
  assert.ok(size > 10_000 && size < 250_000, `the light screenshot is a real, optimized image (${size} bytes)`);
});

test('sow-436: the theme decides which screenshot shows', () => {
  assert.match(css, /\n  \.xbn-shot :global\(\.xbn-img-dark\) \{ display: none; \}/, 'light (the default) hides the dark picture');
  assert.match(css, /\n  :global\(\[data-theme="dark"\]\) \.xbn-shot :global\(\.xbn-img-light\) \{ display: none; \}/, 'dark hides the light picture');
  assert.match(css, /\n  :global\(\[data-theme="dark"\]\) \.xbn-shot :global\(\.xbn-img-dark\) \{ display: block; \}/, 'and shows the dark one');
  for (const m of css.matchAll(/@container[^{]*\{([\s\S]*?)\n  \}/g)) assert.doesNotMatch(m[1], /xbn-img/, 'no layout block touches which picture shows');
});
