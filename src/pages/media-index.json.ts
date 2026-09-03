// sow-165 (Q36, owner-answered 2026-08-29): /media-index.json, the source for the editor's image reuse picker.
//
// Every image referenced by a member's own PUBLISHED items, grouped by author, so the picker can offer reuse
// without a second storage convention. See src/lib/media-index.mjs for why the per-user folder is not the
// source (nothing writes it any more, so it holds one file against 380 co-located ones).
//
// `isListed` is load-bearing, not boilerplate. A Mode A item (members-only, no public page) must not appear
// here: this JSON ships in dist, and listing a Mode A item's image path would disclose that the item exists.
//
// That filter now HAS a guard, and it did not when this file was first written. The comment here originally
// claimed scripts/check-build-secrets.mjs already covered it. It did not: planting a Mode A path into
// dist/media-index.json passed the whole guard green. The guard was extended in the same change, with a
// vacuity control so an empty or absent index fails rather than passing for free.
//
// The picker consequence is stated rather than hidden: a member cannot reuse an image that only ever
// appeared in a Mode A item. The file is still in the repo and can be referenced by hand.
//
// Metadata only, same privacy posture as the other index endpoints: names and repo paths of images that are
// ALREADY public (committed to a public repo and served over jsDelivr), never a body. CORS `*` because the
// extension fetches it cross-origin.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isListed, byNewest } from '../lib/content';
import { readFileSync } from 'node:fs';
import { mediaRecordsFromSource, groupMediaByAuthor } from '../lib/media-index.mjs';
import { contentItemPath } from '../lib/content-index.mjs';

export const prerender = true;

const TYPES = ['post', 'project', 'prompt'] as const;

export const GET: APIRoute = async () => {
  const records = [];
  for (const type of TYPES) {
    const entries = (await getCollection(type as 'post')).filter(isListed).sort(byNewest);
    for (const e of entries) {
      // The RAW file, not e.data: Astro resolves image() fields into ImageMetadata objects, so the canonical
      // `./images/<name>` string is gone by the time a collection entry is handed over. See media-index.mjs.
      const path = contentItemPath(type, e.data.author || 'gbti', e.data.slug);
      if (!path) continue;
      let source = '';
      try { source = readFileSync(path, 'utf8'); } catch { continue; } // a missing file yields no images, never a crash
      records.push(...mediaRecordsFromSource(source, { type, author: e.data.author, slug: e.data.slug, title: e.data.title }));
    }
  }
  const byAuthor = groupMediaByAuthor(records);
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: records.length, byAuthor });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
