// sow-289: publish the git-native outbound partner link store (house/outbound-links.yml) as a build artifact the
// superadmin board reads. Same "static site is the published read-view" pattern as quotes.json.ts and
// news-sources.json.ts: the YAML is the source of truth in the repo (a fork carries its own partner links), and this
// endpoint is how the board consumes it without a GitHub token. The full store is emitted, retired and placeholder
// rows included, because the board exists to show them. Nothing here is secret: every destination is a public 301.
// The store is validated at build time so a malformed edit fails the build instead of shipping a broken redirect
// and a board that lies about it.
import type { APIRoute } from 'astro';
import { outboundLinkSummaries } from '../../scripts/lib/outbound-links-store.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const links = outboundLinkSummaries(process.cwd());
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: links.length, links });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
