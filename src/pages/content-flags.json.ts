// sow-409: emits /content-flags.json at build time, the superadmin stale / unindexed marks (house/content-flags.yml,
// sow-189) as booleans per `<type>:<slug>` key. The extension's superadmin "..." moderation menu reads it to offer the
// half of each pair that applies (Mark stale or Unmark stale, Unindex or Reindex). The file is public repository data
// already; this only makes it fetchable the way /topics.json is. CORS `*` for the extension.
import type { APIRoute } from 'astro';
import { allPublicContentFlags } from '../lib/content-flags';

export const prerender = true;

export const GET: APIRoute = async () => {
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), flags: allPublicContentFlags() });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
