// sow-337: serves the call-to-action card images committed under house/images/ctas/, at /media/ctas/<file>.webp.
// Every image a card in house/ctas.yml names is served, a disabled card's included, because the superadmin manager
// shows each card's thumbnail and the file already sits in the public repository; a file no card names is not.
// The bytes are served as committed: the admin re-encoded them to a WebP in the browser and the shared check
// (membership/cta-image.mjs) refused anything that still carried metadata, so there is nothing for the image
// pipeline to do. The check runs again here, so a hand-made commit that slipped past fails the build.
import fs from 'node:fs';
import type { APIRoute } from 'astro';
import { readCtas, ctaImageInfo } from '../../../../scripts/lib/ctas-store.mjs';
import { ctasOf } from '../../../../membership/cta-edits.mjs';

export const prerender = true;

export async function getStaticPaths() {
  const root = process.cwd();
  const files = new Set();
  for (const c of ctasOf(readCtas(root))) if (c && typeof c.image === 'string') files.add(c.image);
  return [...files].sort().map((file) => {
    const info = ctaImageInfo(root, file);
    if (!info.ok) throw new Error(`house/ctas.yml names image ${file}: ${info.problem}`);
    return { params: { file }, props: { abs: info.abs } };
  });
}

export const GET: APIRoute = ({ props }) => {
  const bytes = fs.readFileSync((props as { abs: string }).abs);
  return new Response(bytes, { headers: { 'Content-Type': 'image/webp' } });
};
