// sow-337: one shard of the button icon library: up to ICON_SHARD_SIZE packed icons of one set, in names-index order.
// Converted at build from React Icons without running its code (scripts/lib/icon-catalog-store.mjs).
import type { APIRoute } from 'astro';
import { readIconCatalog } from '../../../scripts/lib/icon-catalog-store.mjs';

export const prerender = true;

export function getStaticPaths() {
  const c = readIconCatalog(process.cwd());
  return [...c.shards.keys()].map((shard) => ({ params: { shard }, props: { shard } }));
}

export const GET: APIRoute = ({ props }) => {
  const key = (props as { shard: string }).shard;
  const icons = readIconCatalog(process.cwd()).shards.get(key) || [];
  return new Response(JSON.stringify({ shard: key, icons }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
