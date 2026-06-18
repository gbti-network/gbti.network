// GBTI news feed API — Worker entrypoint.
//
// Two entry points share the same modules:
//   scheduled()  hourly cron (wrangler.toml triggers.crons). Runs the ingest pipeline in the
//                background via ctx.waitUntil so the handler returns promptly.
//   fetch()      the JSON REST API + a local test dashboard at /.
//
// Routes:
//   GET  /            HTML test console (no auth; calls the API with a key you paste in)
//   GET  /healthz     liveness (no auth)
//   GET  /feed        items newest-first. Query: category, source, since (epoch s), limit (<=100)   [auth]
//   GET  /categories  configured categories + current counts                                        [auth]
//   GET  /sources     configured sources + current counts                                           [auth]
//   POST /refresh     run an ingest cycle on demand (same code path as the cron)                     [auth]
//
// Config (sources, descriptions, categories) lives in config/*.mjs. The polled collection is stored
// day-sharded in KV (src/store.mjs). CORS is wildcard-open: every data route is bearer-authenticated
// and carries no cookies, so an external test page can call it safely.

import { isAuthorized } from './auth.mjs';
import { ingest } from './ingest.mjs';
import { loadIndex, queryItems } from './store.mjs';
import { clampLimit, publicItem, categoriesWithCounts, sourcesWithCounts } from './api.mjs';
import { DASHBOARD_HTML } from './dashboard.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders },
  });
}

export default {
  // Hourly cron. Keep the handler quick; do the work in the background but never float the promise.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      ingest(env).catch((err) =>
        console.error(JSON.stringify({ at: 'scheduled', cron: controller.cron, error: String(err?.message || err) })),
      ),
    );
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    try {
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      // Public, data-free routes.
      if (method === 'GET' && pathname === '/') {
        return new Response(DASHBOARD_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      if (method === 'GET' && pathname === '/healthz') return json({ ok: true });

      // Never expose the local cron test route in production.
      if (pathname === '/__scheduled' && env.ENVIRONMENT === 'production') return json({ error: 'not_found' }, 404);

      // Everything below requires a valid API key. Fail closed before any data access.
      if (!(await isAuthorized(request, env))) {
        return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
      }

      if (method === 'GET' && pathname === '/feed') {
        const { items, updatedAt } = await queryItems(env, {
          category: url.searchParams.get('category') || undefined,
          source: url.searchParams.get('source') || undefined,
          since: url.searchParams.get('since') || undefined,
          limit: clampLimit(url.searchParams.get('limit')),
        });
        return json({ updatedAt, count: items.length, items: items.map(publicItem) }, 200, { 'Cache-Control': 'no-store' });
      }

      if (method === 'GET' && pathname === '/categories') {
        const index = await loadIndex(env);
        return json({ updatedAt: index.updatedAt, total: index.total, categories: categoriesWithCounts(index.counts.category) });
      }

      if (method === 'GET' && pathname === '/sources') {
        const index = await loadIndex(env);
        return json({ updatedAt: index.updatedAt, total: index.total, sources: sourcesWithCounts(index.counts.source) });
      }

      if (method === 'POST' && pathname === '/refresh') {
        const summary = await ingest(env);
        return json({ ok: true, summary });
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      // Never leak internals; log server-side. Fail closed.
      console.error(JSON.stringify({ at: 'fetch', pathname, error: String(err?.message || err) }));
      return json({ error: 'internal_error' }, 500);
    }
  },
};
