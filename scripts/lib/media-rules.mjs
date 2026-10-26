// The size floor for content artwork, pure so the decision is unit-tested (check-media.mjs does the walking and
// the measuring).
//
// Why a FLOOR and not just the 1 MB ceiling check-media already had: on 2026-10-10 a project shipped with every
// gallery image at 320x200. The thumbnail looked right, because the gallery slot is about 320 wide, and the page
// passed every check. The defect only shows when a reader clicks a screenshot: the lightbox opens the original
// asset at its natural size, so a 320px file opens as a postage stamp, and the committed file is the permanent
// one. The ceiling could not catch it. Nothing could, because no check looked at how small an image was.
//
// What the floor covers, and what it deliberately does not:
//   - `featuredImage` and `gallery[].src` are covered. They are the artwork a reader opens.
//   - `icon` is exempt. Every project icon in the repository is 128x128 by convention.
//   - a post's `coverImage` is exempt. The covers migrated from the old WordPress site run from 512 to 800 px
//     wide, they are never opened in a lightbox, and a floor there would fail the build on content that is fine.
//   - SVG and remote URLs are exempt: one has no fixed raster size, the other is not ours to measure.
//
// The floor is on the LONGEST side, so a tall portrait screenshot (799x1145 is the narrowest one in the
// repository) passes on its height.

import { AUDIO_SRC_RE, parseAudio } from '../../client/src/content-blocks.mjs';

/** The smallest acceptable long edge, in pixels, for a featured or gallery image. */
export const MIN_LONG_EDGE = 1000;

/** The frontmatter fields the floor applies to. Everything else is out of scope by design, see above. */
export const SIZED_ROLES = Object.freeze(['featuredImage', 'gallery']);

const isRemote = (s) => /^(https?:)?\/\//i.test(s);
const isVector = (s) => /\.svg(\?|#|$)/i.test(s);

/**
 * Every image reference in one frontmatter object that the floor applies to, as `{ role, src }`. Returns an empty
 * array for frontmatter with none, so a caller cannot tell "no artwork" from "not checked" by the result alone.
 */
export function sizedImageRefs(frontmatter) {
  const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {};
  const refs = [];
  if (typeof fm.featuredImage === 'string' && fm.featuredImage.trim()) {
    refs.push({ role: 'featuredImage', src: fm.featuredImage.trim() });
  }
  if (Array.isArray(fm.gallery)) {
    fm.gallery.forEach((entry, i) => {
      const src = typeof entry === 'string' ? entry : entry && typeof entry.src === 'string' ? entry.src : '';
      if (src.trim()) refs.push({ role: `gallery[${i}]`, src: src.trim() });
    });
  }
  return refs.filter((r) => !isRemote(r.src) && !isVector(r.src));
}

/**
 * The verdict on one measured image: a message when it is under the floor, or null. `width` and `height` are what
 * the decoder reported; a missing or unreadable dimension is a problem, not a pass, because an image nobody could
 * measure is not an image anybody checked.
 */
export function undersizeProblem({ role, rel, width, height }) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return `${role} could not be measured, so nothing about it was checked: ${rel}. Re-export it as a valid webp, jpg or png.`;
  }
  const long = Math.max(w, h);
  if (long < MIN_LONG_EDGE) {
    return `${role} is too small (${w}x${h}, needs ${MIN_LONG_EDGE}px on its longest side): ${rel}. `
      + 'The lightbox opens this file at its natural size, so export it bigger rather than scaling it down to the card.';
  }
  return null;
}

// The ```audio block's files (2026-10-26, the podcast version of an article). Audio is served by gbti.network itself
// from public/media/podcasts/. A content folder is the wrong place: the site build copies a folder's images and
// nothing else, so a recording committed beside its article would 404 on the page. Each file stays under 20 MB,
// because Cloudflare Pages refuses a whole deploy that carries any file over 25 MiB.
export const PODCAST_DIR = 'public/media/podcasts';
export const PODCAST_MAX_BYTES = 20 * 1024 * 1024;
export const AUDIO_FILE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i;

/** The problem with one audio file under public/media/ (rel is repo-relative, forward slashes), or null. */
export function podcastFileProblem({ rel, bytes }) {
  const served = `/${String(rel).replace(/^public\//, '')}`;
  if (!AUDIO_SRC_RE.test(served)) {
    return `audio file ${rel}: recordings go in ${PODCAST_DIR}/ as a lowercase .ogg (Opus) or .mp3 file (letters, digits, - and _)`;
  }
  if (bytes > PODCAST_MAX_BYTES) return `audio file over 20 MB (${(bytes / 1024 / 1024).toFixed(1)} MB): ${rel}, which Cloudflare Pages would refuse past 25 MiB`;
  return null;
}

/** Every well-formed source the ```audio blocks in one markdown body name, as served paths (/media/podcasts/x.ogg). */
export function audioBlockSources(markdown) {
  const out = [];
  const src = String(markdown ?? '').split('\n');
  for (let i = 0; i < src.length; i++) {
    const open = src[i].match(/^```audio(?:[ \t]+(.*))?$/);
    if (!open) continue;
    const body = [];
    let j = i + 1;
    while (j < src.length && !/^```\s*$/.test(src[j])) body.push(src[j++]);
    for (const s of parseAudio(body.join('\n'), open[1] || '').sources) out.push(s.src);
    i = j;
  }
  return out;
}
