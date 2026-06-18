# Embedded news worker (SOW-043)

This directory is the GBTI news service (`gbti-news-api`) **embedded as a self-contained subdirectory** of
gbti.network, per its [`INTEGRATION.md`](./INTEGRATION.md). It keeps its **own `package.json` + `wrangler.toml`**
and is **NOT an npm workspace** of the host — the host's `npm install` / tests / Astro + extension builds never
touch it. It is deployed **separately** as its own Cloudflare Worker (`gbti-news`), distinct from `gbti-signup`.

## What gbti.network changed on embed
- Moved `playwright` to `optionalDependencies` (only the dev-only `scripts/discover-sources.mjs` needs it), so a
  deploy `npm ci --omit=optional` does not pull Chromium.
- **Enabled the hourly cron** in [`wrangler.toml`](./wrangler.toml) (`crons = ["0 * * * *"]`) — the host wants the
  automated workflow. Set it back to `[]` to pause ingestion.
- Added `workers/news/{node_modules,.dev.vars,.wrangler,.snapshots,.playwright-mcp}` to the host `.gitignore`.

## Owner deploy steps (one-time)
From this directory (see INTEGRATION.md §2 for detail):
```bash
npm install
npm run kv:create                         # create NEWS_KV; paste the ids into wrangler.toml
npx wrangler secret put NEWS_API_KEY      # the bearer key clients must send (NEVER committed)
npm run deploy                            # -> worker `gbti-news`, hourly cron live
```
Then point the **signup Worker** at it so the members-only proxy (`/membership/news`) can reach `/feed`:
```bash
# in workers/signup/ :
npx wrangler secret put NEWS_API_KEY      # the SAME bearer key (held server-side; never reaches the client)
# and set NEWS_API_BASE (the deployed gbti-news URL) as a [vars] entry or a secret, e.g.
#   https://gbti-news.<your-subdomain>.workers.dev
```
The consumer side (the `/membership/news` proxy, `<gbti-news>`, the Browse News tab, the blended feed) is already
built in gbti.network and stays inert (a clean "news unavailable" / no-news state) until `NEWS_API_BASE` +
`NEWS_API_KEY` are set on the signup Worker.

## Keeping it in sync (the "its own repo" option)
This is a **vendored copy**, so changes you make in the upstream `gbti-news-api` repo do not flow here automatically.
To make `workers/news/` a true linked repo (no divergence), push `gbti-news-api` to a remote (e.g.
`github.com/gbti-network/gbti-news-api`) and convert this directory to a **git submodule** — ping me and I will
do the conversion. Until then, re-copy this directory when you change the source pool / categories upstream.
