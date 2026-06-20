// SOW-031 fix: resolve a content item's list-row thumbnail to a URL the build ACTUALLY emits. The pure
// `thumbOf` returns an Astro image()'s `.src` (the ORIGINAL asset), but Astro only writes the OPTIMIZED variants
// referenced by <Image>/getImage to `dist/_astro`, so the original `.src` 404s in production (broken prompt
// thumbnails in the in-extension browser). Running the image through getImage() here registers a small optimized
// variant with the build, so the URL we ship is guaranteed to exist. A plain-string image (rare, a raw path)
// passes through unchanged for the client's resolveAsset to prefix. Used by the per-type index endpoints.
import { getImage } from 'astro:assets';
import { imageFieldOf } from './content-index.mjs';

// SOW-050: three derivatives per item. `thumb` feeds the dense list rows (compact/detailed, <=62px boxes);
// `thumbCard` feeds the card-grid box (~220-360px wide at 4:3), which previously upscaled the 96px list thumb
// ~2-4x and read blurry; `thumbWide` is the full-bleed reader cover (rendered width-contained, never cropped), so
// it carries the HIGHEST available resolution. Each width is clamped to the original so we never UPSCALE
// (downscaling stays crisp); a source narrower than the cap emits at its native width. All webp.
const THUMB_WIDTH = 96;
const CARD_WIDTH = 600; // covers the widest card box at 2x DPI; webp keeps it small + only visible cards load it
const WIDE_WIDTH = 1600; // the reader hero: effectively full-res for the web (clamped to the source, so no upscale)

export type ThumbSet = { thumb: string | null; thumbCard: string | null; thumbWide: string | null };

export async function resolveThumb(data: any, type: string): Promise<ThumbSet> {
  const v = imageFieldOf(data, type);
  if (!v) return { thumb: null, thumbCard: null, thumbWide: null };
  if (typeof v === 'string') return { thumb: v || null, thumbCard: v || null, thumbWide: v || null }; // raw path: client resolves it
  try {
    const orig = Number(v.width) || CARD_WIDTH;
    const [small, card, wide] = await Promise.all([
      getImage({ src: v, width: Math.min(orig, THUMB_WIDTH), format: 'webp' }),
      getImage({ src: v, width: Math.min(orig, CARD_WIDTH), format: 'webp' }),
      getImage({ src: v, width: Math.min(orig, WIDE_WIDTH), format: 'webp' }),
    ]);
    return { thumb: small.src, thumbCard: card.src, thumbWide: wide.src }; // emitted /_astro/... URLs that exist in dist
  } catch {
    return { thumb: null, thumbCard: null, thumbWide: null }; // never ship a thumb we could not optimize (renders with no image)
  }
}
