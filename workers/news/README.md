# GBTI News API

A self-updating, categorized developer-news feed that **costs nothing to run**.

An hourly Cloudflare Worker pulls a curated list of RSS/Atom sources, classifies each new item into a
fixed set of categories with **Workers AI**, stores the collection **day-sharded in KV** (30-day
retention), and serves it over a **bearer-authenticated JSON API**. Sources, source descriptions, and
categories are managed as **files in `config/`** — no database, no admin UI. A small **HTML test
console** is served at `/`.

## How it works

```
Cron (hourly) ─▶ scheduled() ─▶ fetch RSS subset ─▶ parse ─▶ dedupe ─▶ classify NEW items (AI)
                                                              └─▶ append to today's KV day-shard ─▶ prune >30d
HTTP request  ─▶ fetch()     ─▶ bearer auth ─▶ read recent day-shards ─▶ JSON
```

Everything fits inside Cloudflare's free tiers: 1 hourly cron (of 3 free); Workers AI ~1.3 Neurons per
classification against 10,000/day free; KV items sharded by UTC day so each request parses only what it
needs (no single multi-MB blob to blow the free CPU budget).

## Project layout

| Path | What it is |
|------|------------|
| `config/sources.mjs` | **Edit me.** The RSS/Atom sources (`id`, `name`, `description`, `url`). |
| `config/categories.mjs` | **Edit me.** The classification labels + descriptions; one marked `default`. |
| `src/feeds.mjs` | RSS 2.0 / RDF / Atom parser (`fast-xml-parser`). |
| `src/classify.mjs` | Workers AI classification + keyword/default fallback. |
| `src/store.mjs` | Day-sharded KV: `day:<date>` shards, a guid dedupe map, an index with counts. All KV access is here — swap to R2 in one file. |
| `src/ingest.mjs` | The hourly pipeline (fetch → dedupe → classify → commit → prune). |
| `src/api.mjs` | Pure filter/shape helpers for the API. |
| `src/auth.mjs` | Constant-time bearer-key check. |
| `src/dashboard.mjs` | The HTML test console served at `/`. |
| `src/index.mjs` | Worker entry: `scheduled()` + `fetch()` routes. |
| `test/*.test.mjs` | `node --test` unit tests for the pure modules. |

## Managing sources & categories

Edit `config/sources.mjs` / `config/categories.mjs` and redeploy (`npm run deploy`). That's the whole
management surface — it's version-controlled, reviewable, and needs no database. Keep `id`s stable
(changing one resets that source's dedupe history).

Three ways to populate `config/sources.mjs`:

| Command | What it does |
|---------|--------------|
| edit by hand | Add/remove `{ id, name, description, url }` entries directly. |
| `node scripts/add-curated.mjs [feedUrl…]` | Validate + add a built-in curated set (frameworks, libraries, blockchain, technology, hardware, energy), or any feed URLs you pass. |
| `node scripts/import-opml.mjs feeds.opml [--merge]` | Bulk-import any OPML export (Feedly, Inoreader, daily.dev Plus, NetNewsWire…). |
| `npm run discover [tabs…] [--merge]` | Discover real publisher feeds from daily.dev's highlights (dev-only; needs `npx playwright install chromium`). It follows each highlight → publisher domain → autodiscovers + confirms the RSS feed. daily.dev is never a source — only the underlying publishers are. |

**Free-tier note:** fetches + AI calls + KV ops share a **50-subrequest-per-invocation** budget on the
free plan. With ~80 sources, `SOURCE_CHUNK` (default `20`) polls a rotating subset each hour so the full
catalog refreshes over ~4 runs, and `MAX_CLASSIFY` (default `16`) caps AI calls per run — overflow items
get a keyword/default label immediately and are upgraded by AI on later runs. Both are in `wrangler.toml`.
Per-source cadence is ~4h on the free plan; the Workers Paid plan (1000 subrequests) allows all sources
hourly — raise `SOURCE_CHUNK`/`MAX_CLASSIFY` then.

## API

All endpoints except `/` and `/healthz` require `Authorization: Bearer <NEWS_API_KEY>`. Responses are
CORS-open (`*`) — safe because every data route is bearer-authenticated and carries no cookies.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | HTML test console (no auth) — paste your key, browse the feed. |
| GET | `/healthz` | Liveness (no auth). |
| GET | `/feed` | Newest-first items. Query: `category`, `source`, `since` (epoch s), `limit` (≤100, default 50). |
| GET | `/categories` | Configured categories + current counts. |
| GET | `/sources` | Configured sources + current counts. |
| POST | `/refresh` | Run an ingest cycle on demand (same path as the cron). |

```bash
curl -H "Authorization: Bearer $NEWS_API_KEY" "https://gbti-news.<subdomain>.workers.dev/feed?category=Security&limit=20"
```

### Test it from a local HTML page
Run `npm run dev`, open **http://localhost:8787/**, paste your API key, and click **Load feed**. The
page is same-origin so there's no CORS friction; it's the quickest way to eyeball categories and items.

## Setup & deploy

```bash
npm install

# 1. Create the KV namespace, paste the printed ids into wrangler.toml
npm run kv:create

# 2. Set the API key (production secret + local .dev.vars)
npx wrangler secret put NEWS_API_KEY
cp .dev.vars.example .dev.vars   # then edit it

# 3. Run tests
npm test

# 4. Local run (must be --remote so Workers AI + KV are reachable)
npm run dev
#   open http://localhost:8787/ for the test console, or:
curl -X POST -H "Authorization: Bearer <key>" http://localhost:8787/refresh   # ingest now
curl -H "Authorization: Bearer <key>" http://localhost:8787/feed

# 5. Deploy
npm run deploy            # sandbox worker `gbti-news`
npm run deploy:prod       # production
```

> **Automated updates ship disabled.** `wrangler.toml` has `crons = []`, so deploying does **not** start
> the hourly cron — data changes only when you call `POST /refresh`. To turn hourly ingestion on, set
> `crons = ["0 * * * *"]` in `wrangler.toml` and redeploy.

Deploys to the existing GBTI Cloudflare account (pinned `account_id` in `wrangler.toml`). Watch a live
cron fire with `npm run tail` and confirm Neuron usage stays well under 10k/day in the dashboard.

## Notes & future options

- **Storage is intentionally swappable.** Only `src/store.mjs` touches KV; moving to R2 object storage
  (JSON files) or another backend is a one-file change.
- The original idea of scraping daily.dev's "Happening Now" highlights was dropped: that page is a
  client-rendered SPA whose content only loads via daily.dev's private API, so scraping it for free
  isn't viable. This pulls the same kind of underlying sources directly instead.
- Possible later work: AI summaries, near-duplicate clustering, per-source category overrides, webhook
  push, or moving the source list into a small editable store if non-developers need to manage it.
