// SOW-031: emits /blog-index.json at build time, the full newest-first post directory the extension's
// in-extension Browse + reader reads (mirrors activity-index.json.ts but per-type, uncapped, carrying the repo
// `path` so the reader knows what to fetch). Metadata only (no body); member bodies are fetched + decrypted on
// demand via the Worker, never shipped here. Mode A items are excluded by isListed; Mode B stubs are included
// (visibility: members) so they render as a locked card. CORS `*` for the extension cross-origin fetch.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isListed, byNewest } from '../lib/content';
import { toIndexItem } from '../lib/content-index.mjs';
import { resolveThumb } from '../lib/index-thumb';

export const prerender = true;

export const GET: APIRoute = async () => {
  const items = await Promise.all(
    (await getCollection('post'))
      .filter(isListed)
      .sort(byNewest)
      .map(async (e) => ({ ...toIndexItem(e, 'post'), thumb: await resolveThumb(e.data, 'post') })),
  );
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: items.length, items });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
