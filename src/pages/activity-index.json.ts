// SOW-017: emits /activity-index.json at build time, the newest-first list of published works the extension
// new-tab "Latest Activity" feed reads. Published-works metadata only (title/author/date/url), no behavioral
// data; Mode A (no public page) items are excluded by isListed (SOW-016). The extension fetches this over its
// gbti.network host permission (no CORS needed). Refreshes on each deploy (two-tier freshness, like counts).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isListed } from '../lib/content';
import { buildActivityIndex } from '../lib/activity.mjs';

// SOW-023: `visibility` lets the extension "Following" feed know which entries are member-only (a Mode B stub)
// so it renders them locked until decrypted via the SOW-016 Worker. Mode A items are already excluded (isListed).
type ActivityEntry = { type: 'post' | 'product' | 'prompt'; slug: string; title: string; author: string; url: string; publishedAt: number | null; visibility: 'public' | 'members' };

export const prerender = true;

const ms = (d: Date | undefined) => (d ? Number(d) : null);

export const GET: APIRoute = async () => {
  const posts = (await getCollection('post')).filter(isListed).map((p): ActivityEntry => ({
    type: 'post', slug: p.data.slug, title: p.data.title, author: p.data.author, url: `/blog/${p.data.slug}/`, publishedAt: ms(p.data.publishedAt), visibility: p.data.visibility,
  }));
  const products = (await getCollection('product')).filter(isListed).map((p): ActivityEntry => ({
    type: 'product', slug: p.data.slug, title: p.data.title, author: p.data.author, url: `/products/${p.data.slug}/`, publishedAt: ms(p.data.publishedAt), visibility: p.data.visibility,
  }));
  const prompts = (await getCollection('prompt')).filter(isListed).map((p): ActivityEntry => ({
    type: 'prompt', slug: p.data.slug, title: p.data.title, author: p.data.author, url: `/prompts/${p.data.slug}/`, publishedAt: ms(p.data.publishedAt), visibility: p.data.visibility,
  }));
  // SOW-018: Shares are deliberately EXCLUDED here. Shares are an extension-only experience (no public website
  // surface), so they never appear in this public activity index; the extension reads them directly (authenticated).

  const entries = buildActivityIndex([...posts, ...products, ...prompts]);
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, entries });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
