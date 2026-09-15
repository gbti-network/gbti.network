// sow-337: the button icon library's names index, for the superadmin icon picker. Every set with its display name,
// license and icon names in order; an icon's shard is its position divided by shardSize (membership/icon-catalog.mjs).
// When the package could not be read the index says so ({ available: false }) and the picker shows that.
import type { APIRoute } from 'astro';
import { readIconCatalog } from '../../../scripts/lib/icon-catalog-store.mjs';
import { ICON_SHARD_SIZE } from '../../../membership/icon-catalog.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const c = readIconCatalog(process.cwd());
  const total = c.sets.reduce((n, s) => n + s.names.length, 0);
  const body = JSON.stringify({ available: c.available, problem: c.problem, version: c.version, shardSize: ICON_SHARD_SIZE, total, sets: c.sets });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
