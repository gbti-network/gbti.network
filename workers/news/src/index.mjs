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
//   GET  /diag        content-richness coverage (full vs blurb-only) per source — Readability signal  [auth]
//   POST /refresh     run an ingest cycle on demand (same code path as the cron)                     [auth]
//   POST /backfill-images  fetch og:images for stored items lacking one (SOW-050 Tier 1; capped)     [auth]
//
// Config (sources, descriptions, categories) lives in config/*.mjs. The polled collection is stored
// day-sharded in KV (src/store.mjs). CORS is wildcard-open: every data route is bearer-authenticated
// and carries no cookies, so an external test page can call it safely.

import { isAuthorized } from './auth.mjs';
import { ingest } from './ingest.mjs';
import { backfillImages } from './backfill.mjs';
import { loadIndex, queryItems } from './store.mjs';
import { clampLimit, publicItem, categoriesWithCounts, sourcesWithCounts, contentDiagnostics } from './api.mjs';
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
  // Cron. Two schedules share this Worker (each gets its own 50-subrequest / 10 ms-CPU budget): the ingest schedule
  // runs collection + AI; the IMAGE_BACKFILL_CRON schedule (offset, e.g. ":30") fetches og:images for stored items
  // that lack one (SOW-050 Tier 1). Branch on controller.cron. Keep the handler quick; work runs via waitUntil.
  async scheduled(controller, env, ctx) {
    const onErr = (err) => console.error(JSON.stringify({ at: 'scheduled', cron: controller.cron, error: String(err?.message || err) }));
    const backfillCron = env.IMAGE_BACKFILL_CRON || '30 * * * *';
    const job = controller.cron === backfillCron ? backfillImages(env) : ingest(env);
    ctx.waitUntil(job.catch(onErr));
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

      // SOW-046 A diagnostics: content-richness coverage (full inline article text vs blurb-only), per source +
      // overall, plus the blurb-only sources a Readability fetch would most help. The Readability go/no-go signal.
      if (method === 'GET' && pathname === '/diag') {
        const index = await loadIndex(env);
        return json({ updatedAt: index.updatedAt, total: index.total, ...contentDiagnostics(index) }, 200, { 'Cache-Control': 'no-store' });
      }

      if (method === 'POST' && pathname === '/refresh') {
        const summary = await ingest(env);
        return json({ ok: true, summary });
      }

      // SOW-050 Tier 1: backfill og:images for already-stored items lacking one (same code path as the backfill cron).
      // Capped per call (MAX_IMAGE_BACKFILL); call repeatedly to drain the backlog faster than the hourly schedule.
      if (method === 'POST' && pathname === '/backfill-images') {
        const summary = await backfillImages(env);
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
