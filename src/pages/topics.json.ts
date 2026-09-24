// SOW-054 Phase 3/4: emits /topics.json at build time, the followed-topic vocabulary (house/topics.yml via
// topicList()) PLUS each topic's mapped news categories (from house/topic-map.yml). The follow-topic grid and the
// share composer's category picker render the choices; the news view maps a member's followed topics -> news
// categories to prioritize the feed (Phase 4). Metadata only. CORS `*` for the extension.
// sow-227: `groups` lists the headings in display order, and each topic carries `group` (its heading's label, the
// field the published extension already reads) and `groupKey`.
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { topicList, topicGroups } from '../lib/taxonomy';
import { topicMapFromParsed } from '../../membership/topic-map.mjs';

export const prerender = true;

function loadTopicMap(): Record<string, string[]> {
  try {
    const parsed = yaml.load(fs.readFileSync(path.resolve(process.cwd(), 'house/topic-map.yml'), 'utf8'));
    return topicMapFromParsed(parsed);
  } catch {
    return {};
  }
}

export const GET: APIRoute = async () => {
  const map = loadTopicMap();
  const topics = topicList().map((t) => ({ ...t, newsCategories: map[t.key] ?? [] }));
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: topics.length, groups: topicGroups(), topics });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
