#!/usr/bin/env node
// sow-383: render the digest's social icons to the black PNGs the EMAIL shows (an email cannot draw inline SVG;
// Gmail strips it). One PNG per account in membership/mail-social.mjs, drawn from the same simple-icons path the
// web edition and the site footer use, written to public/brand/social/<key>.png.
//
// 48px square for a 20px slot, so the mark stays sharp on a high-density screen. Black on transparent, as the
// owner approved (2026-09-21), plus a white `<key>-white.png` for the dark theme, which picks its icons the way
// it picks the masthead mark (black would vanish on the dark card). Deterministic: re-running it over unchanged
// paths rewrites identical files.
//
//   node scripts/build-digest-social-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DIGEST_SOCIAL } from '../membership/mail-social.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const OUT = path.join(ROOT, 'public/brand/social');
const SIZE = 48;

fs.mkdirSync(OUT, { recursive: true });
for (const s of DIGEST_SOCIAL) {
  for (const [suffix, fill] of [['', '#000000'], ['-white', '#ffffff']]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${SIZE}" height="${SIZE}"><path d="${s.path}" fill="${fill}"/></svg>`;
    const file = path.join(OUT, `${s.key}${suffix}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(file);
    console.log(`${path.relative(ROOT, file)}  ${fs.statSync(file).size} bytes`);
  }
}
