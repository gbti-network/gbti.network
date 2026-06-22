// SOW-056: publish the git-native news source pool (house/news-sources.yml) as a build artifact the gbti-news
// worker reads each cron (NEWS_SOURCES_URL). This is the "static site is the published read-view" pattern applied
// to curation: the YAML is the source of truth in the repo (portable — a fork carries its own), and this endpoint
// is how the worker consumes it without a GitHub token (a public, CDN-cached URL that works even while the repo is
// private). The full pool is emitted (including disabled entries + the `enabled` flag) so the future admin panel can
// show them; the worker filters to enabled. Metadata only (RSS URLs are not secret). CORS `*` for the worker fetch.
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const prerender = true;

type Source = { id: string; name: string; url: string; description: string; enabled: boolean };

function loadSources(): Source[] {
  const file = path.resolve(process.cwd(), 'house', 'news-sources.yml');
  const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { sources?: unknown } | null;
  const raw = Array.isArray(parsed?.sources) ? parsed!.sources : [];
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of raw as any[]) {
    // Validate shape at build time so a malformed edit fails the build instead of shipping a broken pool.
    const id = String(s?.id || '').trim();
    const url = String(s?.url || '').trim();
    if (!id || !/^https?:\/\//i.test(url)) throw new Error(`news-sources.yml: each source needs an id and an http(s) url (got id="${id}", url="${url}")`);
    if (seen.has(id)) throw new Error(`news-sources.yml: duplicate source id "${id}"`);
    seen.add(id);
    out.push({ id, name: String(s?.name || id), url, description: String(s?.description || ''), enabled: s?.enabled !== false });
  }
  return out;
}

export const GET: APIRoute = async () => {
  const sources = loadSources();
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: sources.length, sources });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
