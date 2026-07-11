// SOW-088: the dev.to (Forem) syndication adapter — FULL-BODY crossposts of PUBLIC content items to the
// GBTI organization, with `canonical_url` pointing back at gbti.network (the SEO-safe pattern; the
// owner's example post is the shape authority: byline line up top, real tags, a cover image, org-owned).
//
//   POST https://dev.to/api/articles  (header `api-key`; no OAuth, the key is permanent)
//   { article: { title, body_markdown, canonical_url, tags, published, organization_id, main_image } }
//
// The queue item is structurally body-free (the SOW-058 leak guard), so post() FETCHES the canonical
// raw file and runs it through prepareDevtoBody (fail-closed: published + public only, the members
// marker cut, relative images rewritten to the CDN). Shares and members items are SKIPPED, never failed.
// Thin injectable-fetch client; no SDK. Secrets: DEVTO_API_KEY, DEVTO_ORG_ID (the gbti-network org).

import { renderTemplate } from '../../membership/syndication-format.mjs';
import { templateFor } from '../../membership/syndication-config-core.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';
import { contentPathFor, prepareDevtoBody } from './devto-body.mjs';

const RAW_BASE = 'https://raw.githubusercontent.com/gbti-network/gbti.network/main';
// dev.to's edge 403s UA-less requests (a Workers fetch sends no User-Agent by default; the 403 comes back
// as an HTML block page, not API JSON) — the same lesson as Reddit's required UA.
const USER_AGENT = 'gbti-network-syndication/0.1 (+https://gbti.network)';
const SITE = 'https://gbti.network';
// The built-in byline; the Worker normally pre-renders the devto-intro template into item.devtoIntro.
const DEFAULT_INTRO = '**By [{fullName}]({member-url}), GBTI Network Member.** Originally published on [gbti.network]({url}).';
const READ_MORE = '**[Read the full {content-type} on gbti.network]({url})**';

function absoluteImage(image) {
  const v = String(image || '').trim();
  if (!v) return undefined;
  if (/^https?:\/\//.test(v)) return v;
  if (/^\/\//.test(v)) return `https:${v}`;
  return `${SITE}${v.startsWith('/') ? '' : '/'}${v}`;
}

export function createDevtoAdapter({ env = {}, fetchImpl = globalThis.fetch, cfg = null } = {}) {
  return {
    name: 'devto',
    enabled() { return secretsPresent(env, 'devto'); },
    async post(item) {
      // Content items only. The FULL-vs-STUB decision comes from the canonical FILE's visibility
      // (owner-directed: a members-only item posts its description + a link, never any body), so no
      // pre-skip on the queue item's visibility copy. Skips stay terminal no-ops.
      if (item.source === 'share') return { ok: true, skipped: true, reason: 'dev.to crossposts content items only' };
      const path = contentPathFor(item);
      if (!path) return { ok: true, skipped: true, reason: 'no canonical path for the item' };

      let raw;
      try {
        const res = await fetchImpl(`${RAW_BASE}/${path}`, { headers: { 'User-Agent': USER_AGENT } });
        if (!res?.ok) return { ok: false, error: `devto: could not read the canonical file (${res?.status ?? 'no response'})` };
        raw = await res.text();
      } catch (err) {
        return { ok: false, error: `devto: canonical read failed (${err?.message || 'fetch error'})`.slice(0, 160) };
      }

      // The byline + the CTA footer: the manual rail pre-renders them (item.devtoIntro/devtoFooter);
      // the AUTO rail falls back to the admin-stored channel templates via cfg, then the built-ins.
      const intro = (typeof item.devtoIntro === 'string' && item.devtoIntro.trim())
        ? item.devtoIntro
        : renderTemplate(templateFor(cfg, 'devto-intro', 'devto') || DEFAULT_INTRO, item, { limit: 800 });
      const footer = (typeof item.devtoFooter === 'string' && item.devtoFooter.trim())
        ? item.devtoFooter
        : renderTemplate(templateFor(cfg, 'devto-footer', 'devto') || '', item, { limit: 1200 });
      const prepared = prepareDevtoBody(raw, item, { intro, footer, readMore: renderTemplate(READ_MORE, item, { limit: 300 }) });
      if (!prepared.ok) return { ok: true, skipped: true, reason: `devto: ${prepared.reason}` };

      const title = ((typeof item.textOverride === 'string' && item.textOverride.trim()) ? item.textOverride : String(item.title || ''))
        .slice(0, channelLimit('devto'));
      if (!title) return { ok: false, error: 'devto: the item has no title' };

      const article = {
        title,
        body_markdown: prepared.body,
        canonical_url: String(item.url || '') || undefined,
        tags: prepared.tags,
        published: item.devtoDraft ? false : true,
        ...(Number(env.DEVTO_ORG_ID) ? { organization_id: Number(env.DEVTO_ORG_ID) } : {}),
        ...(absoluteImage(item.image) ? { main_image: absoluteImage(item.image) } : {}),
      };
      const res = await fetchImpl('https://dev.to/api/articles', {
        method: 'POST',
        headers: { 'api-key': String(env.DEVTO_API_KEY || ''), 'Content-Type': 'application/json', Accept: 'application/vnd.forem.api-v1+json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ article }),
      });
      if (res.status === 429) return { ok: false, error: 'devto 429 (rate limited)' };
      const rawText = await res.text().catch(() => '');
      let body = {};
      try { body = JSON.parse(rawText); } catch { /* an edge block page is HTML, not JSON */ }
      if (!res.ok) {
        // Forem carries a readable `error` (e.g. a 422 duplicate-title); an HTML page means the edge
        // blocked the request before the API — surface a snippet either way so the popup says WHY.
        const detail = body?.error ? String(body.error) : rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
        return { ok: false, error: `devto ${res.status}${detail ? ` ${detail}` : ''}`.slice(0, 160) };
      }
      return { ok: true, id: body?.id != null ? String(body.id) : null, url: body?.url || null, draft: article.published === false, stub: prepared.mode === 'stub' };
    },
  };
}
