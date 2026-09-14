// sow-283: serves the share cover copies the share-covers workflow commits under members/<author>/shares/images/,
// at /media/shares/<author>/<id>-<hash>.webp. PUBLIC shares ONLY (isPublicShare: published AND visibility public,
// fail closed): a static site cannot hide a file, so a members-only or draft share's copy is never emitted, and
// scripts/check-build-secrets.mjs fails the build if one is. Every copy of a public share is served, not only the
// one its `image` names, because the workflow downloads a NEW copy from here to prove it is live before it
// switches the share to it.
//
// The bytes are served as committed. The workflow already converted them to a WebP at most 1280px wide and 300 KB,
// so there is nothing for the image pipeline to do.
import fs from 'node:fs';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublicShare } from '../../../../lib/home-feed.mjs';
import { parseShareCoverUrl } from '../../../../../membership/share-cover-url.mjs';

export const prerender = true;

export async function getStaticPaths() {
  const shares = (await getCollection('share')).filter((s) => isPublicShare(s.data));
  const paths = [];
  for (const s of shares) {
    const { author, id } = s.data;
    const dir = path.join(process.cwd(), 'members', author, 'shares', 'images');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (parseShareCoverUrl(`/media/shares/${author}/${file}`)?.id !== id) continue;
      paths.push({ params: { author, file }, props: { abs: path.join(dir, file) } });
    }
  }
  return paths;
}

export const GET: APIRoute = ({ props }) => {
  const bytes = fs.readFileSync((props as { abs: string }).abs);
  return new Response(bytes, { headers: { 'Content-Type': 'image/webp' } });
};
