#!/usr/bin/env node
// sow-478 (owner, 2026-10-27): the Discord tile beside "Join the Discord" in the welcome email. An email cannot draw
// inline SVG (Gmail strips it), so the mark is rendered once to a PNG served from the site at
// /brand/social/discord-tile.png, the folder the digest's social icons already use.
//
// Discord's blurple (#5865F2) rounded square with the white mark, the way Discord presents its own app tile, so it
// reads as Discord on the welcome email's light and dark cards alike. 96px for a 40px slot, so it stays sharp on a
// high-density screen. The corners are transparent in the file itself, because not every mail client honours a
// border-radius on an image. The glyph is the simple-icons path the site's social chips already use. Deterministic:
// re-running it over an unchanged path rewrites an identical file.
//
//   node scripts/build-mail-discord-tile.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SOCIAL_ICON_PATHS } from '../client-ui/src/social-icons.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
export const DISCORD_TILE = 'public/brand/social/discord-tile.png';
const SIZE = 96;
const BLURPLE = '#5865F2';

// The 24-unit glyph scaled to 58% of the tile and centred.
const scale = (SIZE * 0.58) / 24;
const offset = (SIZE - 24 * scale) / 2;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">`
  + `<rect width="${SIZE}" height="${SIZE}" rx="${SIZE * 0.22}" fill="${BLURPLE}"/>`
  + `<g transform="translate(${offset} ${offset + SIZE * 0.01}) scale(${scale})"><path d="${SOCIAL_ICON_PATHS.discord}" fill="#ffffff"/></g>`
  + `</svg>`;
const file = path.join(ROOT, DISCORD_TILE);
fs.mkdirSync(path.dirname(file), { recursive: true });
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
console.log(`${DISCORD_TILE}  ${fs.statSync(file).size} bytes`);
