// sow-149: one branded 1200x630 banner per NEWS category, the stand-in image for a news item that has none.
//
// The generic category-archive banner put its folder icon and label bottom-left, exactly where a feed card's
// cover crop throws them away, so every imageless news card showed the same anonymous green-and-ink slab.
// These follow the same composition (ink ground, the green glow top-right, the dot grid, the GBTI lockup
// top-left, GBTI.NETWORK bottom-left) EXCEPT that the category icon and its label sit in the CENTER, so any
// crop keeps them legible.
//
// One-off, like gen-nano-banana-prompts.mjs: run it by hand when the news worker's category list changes,
// commit the PNGs it writes, and let test/news-feature-image.test.mjs prove there is one per category.
//
//   node scripts/generate-news-feature-images.mjs
//
// Output: public/brand/feature/news/<slug>.png (committed) and the source SVG beside it under
// .product/brand/feature/news/ (local only). Fonts: the brand faces (Baloo Da 2 for the label and the lockup,
// JetBrains Mono for the small caps) are not on a stock machine, so the script fetches the two OFL-licensed
// files from Google Fonts into .product/brand/fonts/ the first time and hands them to librsvg through a
// generated fonts.conf. sharp must be loaded AFTER that environment is set, hence the dynamic import.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORIES } from '../workers/signup/news/config/categories.mjs';
import { newsCategorySlug } from '../client-ui/src/news-feature-image.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/brand/feature/news');
const SRC = path.join(ROOT, '.product/brand/feature/news');
const FONTS = path.join(ROOT, '.product/brand/fonts');
const MARK = path.join(ROOT, 'public/brand/logo/mark-white.png');

const W = 1200;
const H = 630;
const INK = '#25232b';
const GREEN = '#1f9e5f';
const MINT = '#5fd39a';
const MUTE = '#8f8d96';

// The two faces the banner sets type in, by the CSS-API request that resolves to a TTF (the API answers with
// a WOFF2 for a browser user agent; a bare one gets the TrueType file librsvg can read).
const FONT_FILES = [
  { file: 'BalooDa2-ExtraBold.ttf', css: 'https://fonts.googleapis.com/css2?family=Baloo+Da+2:wght@800' },
  { file: 'JetBrainsMono-Medium.ttf', css: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500' },
];

// One line icon per category, on the sprite's 24-unit grid with its stroke conventions (round joins, ~1.8
// stroke). Nine reuse a shape from src/components/IconSprite.astro; cloud, chip and bolt are drawn here.
const ICONS = {
  'ai-ml': '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4.5M12 4.5h-1.5M9 13h.01M15 13h.01M9.5 16.5h5"/>',
  'web-dev': '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16"/>',
  'frameworks-libraries': '<path d="M9 4.5a1.8 1.8 0 0 1 3.6 0c0 .5.4.9.9.9H16a1 1 0 0 1 1 1v2.5c0 .5.4.9.9.9a1.8 1.8 0 0 1 0 3.6c-.5 0-.9.4-.9.9V17a1 1 0 0 1-1 1h-2.6c-.5 0-.9.4-.9.9a1.8 1.8 0 0 1-3.6 0c0-.5-.4-.9-.9-.9H5a1 1 0 0 1-1-1v-2.4c0-.5-.4-.9-.9-.9a1.8 1.8 0 0 1 0-3.6c.5 0 .9-.4.9-.9V6.4a1 1 0 0 1 1-1h3.1c.5 0 .9-.4.9-.9z"/>',
  'open-source': '<circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="8" r="2.4"/><path d="M6 8.4v7.2M15.7 8.6c-.3 3-2.4 4.4-6 4.9"/>',
  security: '<rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  'devops-cloud': '<path d="M7.5 18.5h9.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.6a4.5 4.5 0 0 0 1.5 8.9z"/>',
  'programming-languages': '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
  hardware: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="10.5" y="10.5" width="3" height="3" rx=".5"/><path d="M9.5 4v3M14.5 4v3M9.5 17v3M14.5 17v3M4 9.5h3M4 14.5h3M17 9.5h3M17 14.5h3"/>',
  blockchain: '<path d="M10.5 13.5a3 3 0 0 0 4.5.3l2.4-2.4a3.2 3.2 0 0 0-4.5-4.5l-1.4 1.4M13.5 10.5a3 3 0 0 0-4.5-.3l-2.4 2.4a3.2 3.2 0 0 0 4.5 4.5l1.4-1.4"/>',
  energy: '<path d="M13 2.5L5.5 13h6l-1 8.5L18 11h-6l1-8.5z"/>',
  'business-funding': '<circle cx="12" cy="12" r="8"/><path d="M12 7.5v9M14.5 9.3c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.9 0 2.6 5 1.4 5 4 0 1.2-1.1 2-2.5 2-1 0-2-.4-2.6-1.1"/>',
  other: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function ensureFonts() {
  fs.mkdirSync(FONTS, { recursive: true });
  for (const f of FONT_FILES) {
    const p = path.join(FONTS, f.file);
    if (fs.existsSync(p) && fs.statSync(p).size > 10_000) continue;
    const css = await (await fetch(f.css, { headers: { 'user-agent': 'curl/8' } })).text();
    const url = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+\.ttf)\)/)?.[1];
    if (!url) throw new Error(`could not resolve a TTF for ${f.file} from the Google Fonts CSS API`);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    if (buf.length < 10_000) throw new Error(`${f.file}: ${buf.length} bytes is not a font`);
    fs.writeFileSync(p, buf);
    console.log(`fetched ${f.file} (${buf.length} bytes)`);
  }
  const conf = path.join(FONTS, 'fonts.conf');
  fs.writeFileSync(conf, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${FONTS}</dir>\n  <cachedir>${path.join(FONTS, 'cache')}</cachedir>\n</fontconfig>\n`);
  process.env.FONTCONFIG_FILE = conf;
}

/** The label's font size: as large as the brand face allows while the whole word fits inside a card crop. */
function labelSize(label) {
  // Baloo Da 2 ExtraBold caps run about 0.66em wide; 820px is the width a 4:3 crop of the 1200px canvas keeps.
  return Math.max(44, Math.min(76, Math.floor(820 / (label.length * 0.66))));
}

function svgFor(name, slug) {
  const label = name.toUpperCase();
  const size = labelSize(label);
  const icon = ICONS[slug];
  if (!icon) throw new Error(`no icon for ${name} (${slug}); add one to ICONS`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="0.86" cy="0.06" r="0.64">
      <stop offset="0" stop-color="${GREEN}" stop-opacity="0.60"/>
      <stop offset="0.5" stop-color="${GREEN}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${GREEN}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">
      <circle cx="1.5" cy="1.5" r="1.3" fill="#ffffff" fill-opacity="0.07"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="${INK}"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="132" y="97" font-family="Baloo Da 2" font-weight="800" font-size="38" fill="#ffffff">GBTI</text>
  <text x="600" y="206" text-anchor="middle" font-family="JetBrains Mono" font-weight="500" font-size="19" letter-spacing="7" fill="#45c08d">GBTI NEWS</text>
  <g transform="translate(552 230) scale(4)" fill="none" stroke="${MINT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</g>
  <text x="600" y="405" text-anchor="middle" font-family="Baloo Da 2" font-weight="800" font-size="${size}" letter-spacing="1" fill="#ffffff">${esc(label)}</text>
  <text x="60" y="566" font-family="JetBrains Mono" font-weight="500" font-size="20" letter-spacing="6" fill="${MUTE}">GBTI.NETWORK</text>
</svg>
`;
}

async function main() {
  await ensureFonts();
  const { default: sharp } = await import('sharp'); // after FONTCONFIG_FILE, or librsvg never sees the faces
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SRC, { recursive: true });
  const mark = await sharp(MARK).resize(60, 60).png().toBuffer();
  for (const c of CATEGORIES) {
    const slug = newsCategorySlug(c.name);
    const svg = svgFor(c.name, slug);
    fs.writeFileSync(path.join(SRC, `${slug}.svg`), svg);
    const out = path.join(OUT, `${slug}.png`);
    await sharp(Buffer.from(svg))
      .composite([{ input: mark, left: 58, top: 52 }])
      .png({ palette: true, quality: 90, compressionLevel: 9 })
      .toFile(out);
    console.log(`${slug}.png  ${fs.statSync(out).size} bytes  (${c.name})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
