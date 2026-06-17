// SOW-031 fix: resolve a content item's list-row thumbnail to a URL the build ACTUALLY emits. The pure
// `thumbOf` returns an Astro image()'s `.src` (the ORIGINAL asset), but Astro only writes the OPTIMIZED variants
// referenced by <Image>/getImage to `dist/_astro`, so the original `.src` 404s in production (broken prompt
// thumbnails in the in-extension browser). Running the image through getImage() here registers a small optimized
// variant with the build, so the URL we ship is guaranteed to exist. A plain-string image (rare, a raw path)
// passes through unchanged for the client's resolveAsset to prefix. Used by the per-type index endpoints.
import { getImage } from 'astro:assets';
import { imageFieldOf } from './content-index.mjs';

const THUMB_WIDTH = 96; // list rows render at <=46px; 96px covers retina without shipping the full image

export async function resolveThumb(data: any, type: string): Promise<string | null> {
  const v = imageFieldOf(data, type);
  if (!v) return null;
  if (typeof v === 'string') return v || null; // a raw path: leave it for the client to resolve
  try {
    const width = Math.min(Number(v.width) || THUMB_WIDTH, THUMB_WIDTH);
    const img = await getImage({ src: v, width, format: 'webp' });
    return img.src; // an emitted /_astro/... URL that exists in dist
  } catch {
    return null; // never ship a thumb we could not optimize (the row renders with no image)
  }
}
