# Integrating the GBTI News API

How to embed this service into another project, consume its data, deploy it (cron included), and manage
the **master source pool**. For an architecture overview see [`README.md`](./README.md).

- [What you're integrating](#what-youre-integrating)
- [1. Embedding the repo](#1-embedding-the-repo)
- [2. Deploying (with the hourly cron)](#2-deploying-with-the-hourly-cron)
- [3. Consuming the data](#3-consuming-the-data)
- [4. Managing the source master pool](#4-managing-the-source-master-pool)
- [5. Managing categories](#5-managing-categories)
- [6. Configuration knobs](#6-configuration-knobs)
- [7. Operational behavior to know](#7-operational-behavior-to-know)

---

## What you're integrating

A standalone Cloudflare Worker that, **every hour**, pulls a curated pool of RSS/Atom feeds, classifies
each new item into a fixed category set with Workers AI, and stores it day-sharded in KV (30-day
retention). It exposes a **bearer-authenticated JSON API**. It runs entirely within Cloudflare free
tiers and is independent of any host application — your project just **consumes its API** (or a
snapshot of it).

Everything the service needs is in this repo. The only runtime dependency is `fast-xml-parser`;
`wrangler` (deploy) and `playwright` (the one-time source-discovery script) are dev-only.

---

## 1. Embedding the repo

Drop this in as a self-contained subdirectory of the host project, e.g. `workers/news/`.

**Keep it as its own `package.json` — do not make it an npm workspace of the host.** That avoids
hoisting its dev tooling (Playwright/Chromium, ~150 MB) into the host's root install.

Carry these over so local secrets and build state never get committed:

```gitignore
# in the host repo's ignore rules, scoped to this subdir
workers/news/node_modules/
workers/news/.dev.vars
workers/news/.wrangler/
```

**Lean deploy installs:** the deploy step only needs `wrangler` + `fast-xml-parser`; Playwright is only
for `scripts/discover-sources.mjs`. Move `playwright` to `optionalDependencies` and have CI run
`npm ci --omit=optional` so deploy pipelines don't pull Chromium. (Ask and this can be pre-set.)

---

## 2. Deploying (with the hourly cron)

> ⚠️ **Automated hourly updates ship DISABLED.** [`wrangler.toml`](./wrangler.toml) has `crons = []`, so
> deploying does **not** start any background ingestion — the data only changes when you call
> `POST /refresh` yourself. To enable the hourly cron, set `crons = ["0 * * * *"]` and redeploy.

The cron is **not** a separate resource — it's the `triggers.crons` line in
[`wrangler.toml`](./wrangler.toml); whatever schedule is listed there is registered (or cleared) on each
deploy. Deploys go to the account pinned as `account_id` in that file (currently the shared GBTI account).

One-time setup:

```bash
npm install
npm run kv:create                 # creates the NEWS_KV namespace; paste the printed ids into wrangler.toml
npx wrangler secret put NEWS_API_KEY            # the bearer key clients must send
# (repeat with --env production for the production environment)
```

Deploy (from this directory, or point at the config from the host's CI):

```bash
npm run deploy                    # -> worker `gbti-news`, cron live
npm run deploy:prod               # -> production environment
# from a monorepo root:
npx wrangler deploy --config workers/news/wrangler.toml
```

**CI requirements:** a `CLOUDFLARE_API_TOKEN` with Workers + KV + Workers AI + Cron edit scope, plus the
account id. The `NEWS_API_KEY` secret is set per-environment via `wrangler secret put` (or the CF
dashboard), never committed. The Worker deploys as `gbti-news`, distinct from any other Worker in the
account — no collision.

Verify after deploy: `npm run tail` (watch a live cron fire) and the Cloudflare dashboard → the Worker's
**Cron Events** + **Workers AI** usage.

---

## 3. Consuming the data

All endpoints except `/` and `/healthz` require `Authorization: Bearer <NEWS_API_KEY>`. Responses are
CORS-open (`*`) — safe because every data route is bearer-authenticated and cookie-free.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | HTML test console (no auth). |
| GET | `/healthz` | Liveness (no auth). |
| GET | `/feed` | Items, newest-first. Query: `category`, `source`, `since` (epoch s), `limit` (≤100, default 50). |
| GET | `/categories` | Category list + live counts. |
| GET | `/sources` | Source list + live counts. |
| POST | `/refresh` | Run an ingest cycle on demand (same pipeline as the cron). |

**Response shapes:**

```jsonc
// GET /feed?category=Security&limit=2
{
  "updatedAt": 1781642063,           // epoch seconds of last ingest
  "count": 2,
  "items": [
    {
      "guid": "https://site/a",       // stable dedupe key
      "source": "bleeping-computer",  // matches a config/sources.mjs id
      "title": "…",
      "link": "https://site/a",
      "summary": "…",                 // from the feed, tag-stripped, ≤500 chars
      "category": "Security",
      "publishedAt": 1781640000,      // epoch s (may be null)
      "fetchedAt": 1781642063
    }
  ]
}

// GET /categories -> { updatedAt, total, categories: [{ name, description, count }] }
// GET /sources    -> { updatedAt, total, sources: [{ id, name, description, url, count }] }
```

### Integration models

1. **Runtime API (default).** Your app/site calls `/feed` directly (server-side or at request time).
   Always fresh; nothing to store in your repo.
2. **Build-time snapshot (recommended for a git/static-site host).** Your build fetches the API and
   writes a JSON file that the site builds from — deterministic, offline-safe, versioned in git:

   ```js
   // scripts/fetch-news.mjs in the HOST repo — run during build
   import { writeFileSync } from 'node:fs';
   const BASE = process.env.NEWS_API_BASE; // https://gbti-news.<sub>.workers.dev
   const KEY = process.env.NEWS_API_KEY;
   const res = await fetch(`${BASE}/feed?limit=100`, { headers: { Authorization: `Bearer ${KEY}` } });
   writeFileSync('src/data/news.json', JSON.stringify(await res.json(), null, 2));
   ```

   `/feed` caps at 100 items per call; page deeper with `since`/`category`, or request a dedicated
   `/export` endpoint (full current dataset in one response) — easy to add.
3. **Cron-commits-to-git.** A scheduled job writes news files into the host repo via the GitHub API.
   Most git-native, but noisy (hourly commits) and more moving parts; only if you need the data itself
   versioned rather than just snapshotted at build.

---

## 4. Managing the source master pool

The master pool is **[`config/sources.mjs`](./config/sources.mjs)** — a plain array, version-controlled,
no database. Each entry:

```js
{
  id:          'bleeping-computer',                 // short, unique, STABLE slug (see warning below)
  name:        'BleepingComputer',                  // shown by GET /sources
  description: 'Security incidents, CVEs, exploits',// shown by GET /sources
  url:         'https://www.bleepingcomputer.com/feed/', // the RSS/Atom feed URL
}
```

**Changes take effect on the next deploy** (`npm run deploy`). Four ways to edit the pool:

### Add — by hand
Append an entry to the array. Pick a unique, lowercase, hyphenated `id` and give it a real `url`.

### Add — curated bulk set (validated)
```bash
node scripts/add-curated.mjs                    # adds a built-in dev/tech set, dropping dead feeds
node scripts/add-curated.mjs https://blog.example.com/feed/   # also validate + add specific URLs
```
Each candidate is fetched and confirmed to parse as RSS/Atom before being added; duplicates (by URL)
are skipped.

### Add — import an OPML export
```bash
node scripts/import-opml.mjs feeds.opml          # replace the pool from an OPML file
node scripts/import-opml.mjs feeds.opml --merge  # add onto the existing pool
```
Works with any RSS reader's OPML export (Feedly, Inoreader, NetNewsWire, daily.dev Plus…).

### Add — discover from daily.dev highlights (dev-only)
```bash
npm i -D playwright && npx playwright install chromium     # one-time
npm run discover                                  # default highlight tabs -> rewrites the pool
node scripts/discover-sources.mjs security rust --merge    # specific tabs, merge
```
Follows each highlight to its **original publisher**, autodiscovers + confirms that publisher's RSS,
and adds it. daily.dev is never a source — only the underlying publishers are.

### Remove a source
Delete its entry from `config/sources.mjs` and redeploy. Notes:
- Items already ingested from that source **remain** in the feed until they age out of the 30-day
  retention window (and their guids stay in the dedupe map until then). To purge immediately, wipe KV
  (below) or delete that source's items out of band.
- Removing a source frees room in the per-run fetch budget (see §6).

### ⚠️ Keep `id`s stable
The `id` is part of nothing's identity except filtering — but **changing an existing source's `id`** is
disruptive: items already stored keep the old id (orphaned from `/sources` filters), and nothing
re-dedupes by id (dedupe is by item `guid`, not source id, so history is *not* reset by an id change —
but your `?source=` filters and counts will split across old/new ids). Treat `id` as immutable once a
source is live; to rename, change `name` instead.

### Pool size vs the free tier
Fetches share the **50-subrequest-per-invocation** budget with AI + KV calls. The pool can be large
because `SOURCE_CHUNK` polls only a rotating subset each hour (see §6) — but the bigger the pool, the
longer the full-catalog refresh cycle. ~120 sources at `SOURCE_CHUNK=20` ≈ a 6-hour cycle.

---

## 5. Managing categories

The label set the classifier may choose from is **[`config/categories.mjs`](./config/categories.mjs)**:

```js
{ name: 'Security', description: 'Vulnerabilities, CVEs, exploits, breaches…' }
// exactly one entry sets `default: true` — the fallback when AI is unavailable/uncertain.
```

- **Add/rename/remove** an entry and redeploy. The AI prompt and validation are built from this array
  automatically (`CATEGORY_NAMES`).
- Optionally add a matching keyword rule in [`src/classify.mjs`](./src/classify.mjs) (`KEYWORD_RULES`) so
  the cheap fallback can also reach the new category when the AI budget is exhausted.
- Existing items keep their old label until reclassified or pruned; removing a category leaves old
  items tagged with the now-defunct label until they age out.

---

## 6. Configuration knobs

In [`wrangler.toml`](./wrangler.toml) `[vars]` (and `[env.production.vars]`):

| Var | Default | Meaning |
|-----|---------|---------|
| `RETENTION_DAYS` | `30` | Days of content kept; older day-shards are pruned each run. |
| `SOURCE_CHUNK` | `20` | Sources fetched per hourly run (rotates across the pool). `0` = all every run. |
| `MAX_CLASSIFY` | `16` | Max AI classifications per run. Overflow items get a keyword/default label, retried later. |
| `AI_MODEL` | `@cf/meta/llama-3.2-3b-instruct` | Workers AI model id used for classification. |
| `ENVIRONMENT` | `sandbox`/`production` | `production` blocks the `/__scheduled` test route. |

**Budget rule:** `SOURCE_CHUNK` (fetches) + `MAX_CLASSIFY` (AI) + ~9 KV ops must stay **< 50** on the
free plan. The defaults sum to ~45. On the Workers **Paid** plan (1000 subrequests) you can raise both
to poll the whole pool hourly.

---

## 7. Operational behavior to know

- **Dedupe** is exact, by item `guid` (the feed's `<guid>`/`<id>`, else the link), tracked in a KV map
  across the 30-day window. Re-runs and duplicate cron fires add nothing. It does **not** cluster the
  same story from *different* publishers (each is kept). Near-duplicate grouping can be added.
- **Summaries** come from the feed itself (tag-stripped, ≤500 chars) — no article fetching/Readability,
  no AI summarization (both cost extra subrequests/Neurons). A short AI summary can be folded into the
  classify call cheaply if wanted.
- **Cold start:** the first runs classify only `MAX_CLASSIFY` items each; the rest carry a keyword/
  default label and are upgraded to AI labels over subsequent hourly runs (so "Other" shrinks over
  time). Local `npm run dev` does **not** run the cron — trigger ingest with `POST /refresh`.
- **Wiping KV** (clean baseline / after removing sources): delete the `feed:v2:*` keys, e.g.
  `npx wrangler kv key list --binding NEWS_KV` then delete, or create a fresh namespace and swap the id.
- **Storage** is isolated in [`src/store.mjs`](./src/store.mjs) (day-shards + guid map + index). Moving
  from KV to R2 is a one-file change.
