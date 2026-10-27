// sow-483 Phase 3 (owner, 2026-10-27: uploads live in the git repository, beside the article): serves a member's
// uploaded recordings, committed in the audio/ folder beside the item they play in, at
// /media/audio/<author>/<dir>/<slug>/<file>, which is where every renderer resolves a block's `./audio/<file>`
// (client/src/content-blocks.mjs audioBaseFor). A PUBLIC item's only (isPublic: published AND visibility public, fail
// closed): a static site cannot hide a file, so a draft's or a members-only item's recording is never emitted, and
// scripts/check-build-secrets.mjs fails the build if one is. Only .mp3 and .ogg, the two Cloudflare serves with byte
// ranges, so a listener can skip ahead (AUDIO_SRC_RE), and the bytes are served as committed.
//
// And only a recording the item's PUBLIC body names. index.md carries the public part alone (a members-only section is
// encrypted beside it), so a recording a block names only inside that section is never given a public address.
import fs from 'node:fs';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublic } from '../../../lib/content-gating.mjs';
import { audioBaseFor, audioUploadNames } from '../../../../client/src/content-blocks.mjs';

export const prerender = true;

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,79}\.(mp3|ogg)$/;

export async function getStaticPaths() {
  const items = [...(await getCollection('post')), ...(await getCollection('project')), ...(await getCollection('prompt'))].filter(isPublic);
  const paths = [];
  for (const entry of items) {
    const base = audioBaseFor(entry.filePath || ''); // members/<author>/<dir>/<slug>/index.md only: house has no uploads
    if (!base) continue;
    const dir = path.join(process.cwd(), path.dirname(entry.filePath as string), 'audio');
    if (!fs.existsSync(dir)) continue;
    const named = new Set(audioUploadNames(entry.body || ''));
    for (const file of fs.readdirSync(dir)) {
      if (!NAME_RE.test(file) || !named.has(file)) continue;
      paths.push({ params: { path: `${base.slice('/media/audio/'.length)}/${file}` }, props: { abs: path.join(dir, file) } });
    }
  }
  return paths;
}

export const GET: APIRoute = ({ props }) => {
  const abs = (props as { abs: string }).abs;
  return new Response(fs.readFileSync(abs), { headers: { 'Content-Type': abs.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg' } });
};
