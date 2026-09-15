// sow-281: publish the CTA registry (house/ctas.yml) as a build artifact with every assignment RESOLVED against the
// real content collections. The superadmin manager reads it to show, beside each CTA, which items carry it, each
// with its title and link, and which assignments name nothing (resolved: false, in red there). The full registry
// is emitted, disabled CTAs included, because the manager exists to show them; nothing here is secret (every
// destination is already in the rendered pages). Same "static site is the published read-view" pattern as
// quotes.json.ts. The registry is validated on read, so a malformed edit fails the build rather than shipping.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { readCtas } from '../../scripts/lib/ctas-store.mjs';
import { resolveAssignments } from '../lib/ctas.mjs';
import { hasPublicPage } from '../lib/content';
import { isPublicShare } from '../lib/home-feed.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const items: { type: string; ref: string; title: string; live: boolean }[] = [];
  for (const type of ['post', 'project', 'prompt'] as const) {
    for (const e of await getCollection(type)) {
      items.push({ type, ref: String((e.data as any).slug), title: String((e.data as any).title ?? ''), live: hasPublicPage(e as any) });
    }
  }
  for (const s of await getCollection('share')) {
    const d = s.data as any;
    items.push({ type: 'share', ref: `${d.author}/${d.id}`, title: String(d.title ?? d.shortDescription ?? 'A member share'), live: isPublicShare(d) });
  }
  const ctas = resolveAssignments(readCtas(process.cwd()), items);
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: ctas.length, types: ['prompt', 'post', 'project', 'share'], ctas });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
