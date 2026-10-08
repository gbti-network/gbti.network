// sow-445: the news story page (/news/item/?g=<guid>&s=<source>) sent with the story's own card, so a story posted to
// LinkedIn, X, Facebook, Slack or Discord unfurls as "<headline> | <publication>" with its summary and picture,
// instead of the shell every story shared. The page itself is unchanged: it still draws the story in the browser.
//
// FAIL CLOSED TO THE PLAIN PAGE. No guid, a story the feed no longer holds, a slow or failed lookup, a non-HTML
// response, or a head that no longer matches: the visitor and the bot get exactly the static page. The story is
// found the way the page finds it (the public /news/feed for its source, newest 60), so the card describes a story
// exactly when the page can show it. Never logs.
//
// PREVIEW FETCHERS ONLY. A person's browser gets the static page at once and draws the story itself, as before; only a
// link-preview fetcher (isPreviewBot) waits for the lookup, so no visit is slowed down for a card nobody sees.

import { storyRequest, feedUrlFor, storyCard, newsItemHead, isPreviewBot } from '../../../src/lib/news-item-head.mjs';

const SIGNUP_BASE = 'https://signup.gbti.network';
// A preview fetcher waits several seconds for a page. One publication's stories can take the Worker a second to gather
// when that publication posts rarely (it reads back through the month), so the bound is generous; a person never waits.
const LOOKUP_TIMEOUT_MS = 3000;

async function json(fetcher, url) {
  try {
    const r = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const res = await context.next();
  if (context.request.method !== 'GET' || !isPreviewBot(context.request.headers.get('user-agent'))) return res;
  const req = storyRequest(context.request.url);
  if (!req || !res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res;

  const assets = context.env && context.env.ASSETS;
  const [feed, sources] = await Promise.all([
    json(fetch, feedUrlFor(SIGNUP_BASE, req)),
    assets ? json((u, o) => assets.fetch(u, o), new URL('/news-sources.json', context.request.url).toString()) : null,
  ]);
  const card = storyCard(feed, req, sources);
  if (!card) return res;

  const html = await res.text();
  const { html: out, changed } = newsItemHead(html, card);
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(changed ? out : html, { status: res.status, statusText: res.statusText, headers });
}
