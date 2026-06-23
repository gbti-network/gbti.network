// SOW-054 Phase 3: emits /topics.json at build time, the followed-topic vocabulary (the content-taxonomy PRIMARY
// categories + their labels, from house/taxonomy.yml via topicList()). The extension's onboarding Topics step and
// the settings topic picker fetch it to render the choices, so the bundle needs no taxonomy lookup. Metadata only
// (no content, no behavioral data). CORS `*` for the extension cross-origin fetch.
import type { APIRoute } from 'astro';
import { topicList } from '../lib/taxonomy';

export const prerender = true;

export const GET: APIRoute = async () => {
  const topics = topicList();
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: topics.length, topics });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
