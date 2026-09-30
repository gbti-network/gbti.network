// sow-428: one blobatar file per known member folder, so a page that shows a member many times downloads their
// creature once (src/lib/blob-seeds.mjs). The drawing is the same one the inline `data:` URL carries.
import type { APIRoute } from 'astro';
import { blobSeeds } from '../../lib/blob-seeds.mjs';
import { memberBlobSvg } from '../../../membership/member-blob.mjs';

export const prerender = true;

export function getStaticPaths() {
  return [...blobSeeds()].sort().map((seed) => ({ params: { seed } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(memberBlobSvg(String(params.seed)), { headers: { 'Content-Type': 'image/svg+xml' } });
