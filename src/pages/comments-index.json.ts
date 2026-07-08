// SOW-089: emits /comments-index.json at build time — every published comment across the network in ONE
// fetch, replacing the extension's per-comment GitHub reads (~60 sequential Contents calls per discussion
// open). Public comment bodies ship inline (already public data, rendered into the static pages);
// members-visibility rows ship '' with their encryptedBody pointer and decrypt on demand via the Worker.
// Erasure needs no special handling: a drafted comment fails the published filter at the next rebuild.
// CORS `*` for the extension cross-origin fetch.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { toCommentIndexRow, isPublishedComment } from '../lib/comments-index.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const items = (await getCollection('comment')).filter(isPublishedComment).map(toCommentIndexRow);
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: items.length, items });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
