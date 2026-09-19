// SOW-056: publish the git-native news source pool (house/news-sources.yml) as a build artifact the gbti-news
// worker reads each cron (NEWS_SOURCES_URL). This is the "static site is the published read-view" pattern applied
// to curation: the YAML is the source of truth in the repo (portable — a fork carries its own), and this endpoint
// is how the worker consumes it without a GitHub token (a public, CDN-cached URL that works even while the repo is
// private). The full pool is emitted (including disabled entries + the `enabled` flag) so the future admin panel can
// show them; the worker filters to enabled. Metadata only (RSS URLs are not secret). CORS `*` for the worker fetch.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { mergeMemberSources } from '../lib/member-news-sources.mjs';
import { readBanwords } from '../../membership/news-banwords.mjs'; // sow-372: the words that keep a story out of the stream

export const prerender = true;

type Source = { id: string; name: string; url: string; description: string; enabled: boolean; weight: number };

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
    out.push({ id, name: String(s?.name || id), url, description: String(s?.description || ''), enabled: s?.enabled !== false, weight: 0 });
  }
  return out;
}

// sow-338: the superadmin weights, from their own file. Merged here rather than stored beside the source, because
// house/news-sources.yml is admin-owned and a weight is a superadmin's call. A missing file, a malformed one or an
// id nobody recognises all mean NEUTRAL, which is the behaviour the pipeline had before weights existed.
function loadWeights(): Record<string, number> {
  const file = path.resolve(process.cwd(), 'house', 'news-source-weights.yml');
  let parsed: { weights?: unknown } | null = null;
  try { parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { weights?: unknown } | null; } catch { return {}; }
  const raw = parsed?.weights;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n === 0) continue;
    if (n < -2 || n > 2) throw new Error(`news-source-weights.yml: "${id}" is ${n}; a weight is a step from -2 to +2`);
    out[id] = n;
  }
  return out;
}

// sow-372: the superadmin's blocked words, published in THIS artifact rather than one of their own. The ingest
// already fetches this file every hour, and the free Workers plan counts every fetch and KV operation against a
// 50-subrequest budget per run, so a second artifact would buy nothing and cost one. A missing or malformed file
// means an EMPTY list, which is the behaviour the pipeline had before blocking existed: fail OPEN here is right,
// because the alternative is a broken parse silently blocking every story in the feed.
function loadBanwords(): string[] {
  const file = path.resolve(process.cwd(), 'house', 'news-banwords.yml');
  try {
    const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { words?: unknown } | null;
    return readBanwords(parsed);
  } catch { return []; }
}

// sow-140: admin-approved MEMBER sources (an RSS feed declared on a member-owned project and approved in
// the admin-owned house/member-news-sources.yml) merge into the same pool. Fail closed in the pure helper:
// only an approved slug resolving to a published + public project with an https newsFeed is emitted.
function loadMemberApprovals(): Array<{ project?: string }> {
  const file = path.resolve(process.cwd(), 'house', 'member-news-sources.yml');
  if (!fs.existsSync(file)) return [];
  const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { approved?: unknown } | null;
  return Array.isArray(parsed?.approved) ? (parsed!.approved as Array<{ project?: string }>) : [];
}

export const GET: APIRoute = async () => {
  const houseSources = loadSources();
  const approvals = loadMemberApprovals();
  const projects = (await getCollection('project')).map((p) => ({
    slug: p.data.slug,
    title: p.data.title,
    author: p.data.author,
    status: p.data.status,
    visibility: p.data.visibility,
    newsFeed: p.data.newsFeed,
  }));
  const weights = loadWeights();
  const sources = mergeMemberSources(houseSources, approvals, projects)
    .map((s: Source) => ({ ...s, weight: weights[s.id] ?? 0 }));
  const banwords = loadBanwords();
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: sources.length, sources, banwords });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
