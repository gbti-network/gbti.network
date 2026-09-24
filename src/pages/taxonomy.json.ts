// sow-227: emits /taxonomy.json at build time, the content category tree (house/taxonomy.yml) the editor's category
// picker offers. Before this a member's browser had no way to read the tree at all: the only route was the admin-only
// Worker read behind the Categories screen. Categories are already public on every item page, so this exposes
// nothing new. The picker fetches the absolute gbti.network URL from every host, hence CORS `*`, as /topics.json.
import type { APIRoute } from 'astro';
import { TAXONOMY_TREE } from '../lib/taxonomy';

export const prerender = true;

export const GET: APIRoute = async () => {
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), tree: TAXONOMY_TREE });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
