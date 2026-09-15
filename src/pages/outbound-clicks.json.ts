// sow-289: publish the daily outbound click history (house/outbound-clicks.yml, written by reconcile) as a build
// artifact the superadmin board reads beside /outbound-links.json. Same "static site is the published read-view"
// pattern as quotes.json.ts. The file is read through the rollup's own normalizer, so the board sees the shape the
// rollup wrote: `coverage` (the dates that were queried) and per-path rows keyed by date. A date outside coverage is
// "not measured", never zero, and the board is what holds that line. Aggregate request counts only; nothing
// personal, nothing secret.
import type { APIRoute } from 'astro';
import { readClicksFromDisk } from '../../scripts/lib/outbound-clicks.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const store = readClicksFromDisk(process.cwd());
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), coverage: store.coverage, clicks: store.clicks });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
