// SOW-134: the Hashnode syndication adapter. FULL-BODY crossposts of PUBLIC content items to the GBTI
// Hashnode publication (gbti.hashnode.dev), with `originalArticleURL` pointing back at gbti.network (the
// SEO-safe canonical pattern, same as dev.to). Hashnode's API is a single GraphQL endpoint:
//
//   POST https://gql.hashnode.com  (header `Authorization: <personal access token>`, NOT a Bearer prefix)
//   mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id url slug } } }
//   input: { title, contentMarkdown, publicationId, tags:[{name,slug}], originalArticleURL, coverImageOptions }
//
// GraphQL returns HTTP 200 even for errors, so a non-empty `errors` array is treated as a failure. The queue
// item is body-free (the SOW-058 leak guard), so post() FETCHES the canonical raw file and runs it through
// prepareHashnodeBody (fail-closed: published + public only, the members marker cut, relative images rewritten
// to the CDN). Shares + members items are SKIPPED, never failed. Thin injectable-fetch client; no SDK.
// Secrets: HASHNODE_TOKEN (a Hashnode PAT), HASHNODE_PUBLICATION_ID (the gbti.hashnode.dev publication id).

import { renderTemplate, defaultSyndicationCover } from '../../membership/syndication-format.mjs';
import { templateFor } from '../../membership/syndication-config-core.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';
import { contentPathFor, prepareHashnodeBody } from './hashnode-body.mjs';

const RAW_BASE = 'https://raw.githubusercontent.com/gbti-network/gbti.network/main';
// A Workers fetch sends no User-Agent by default; GitHub raw + some edges 403 UA-less requests.
const USER_AGENT = 'gbti-network-syndication/0.1 (+https://gbti.network)';
const SITE = 'https://gbti.network';
const HASHNODE_GQL = 'https://gql.hashnode.com';
const PUBLISH_MUTATION = 'mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id url slug } } }';
// The built-in byline; the Worker normally pre-renders the hashnode-intro template into item.hashnodeIntro.
const DEFAULT_INTRO = '**By [{fullName}]({member-url}), GBTI Network Member.** Originally published on [gbti.network]({url}).';

function absoluteImage(image) {
  const v = String(image || '').trim();
  if (!v) return undefined;
  if (/^https?:\/\//.test(v)) return v;
  if (/^\/\//.test(v)) return `https:${v}`;
  return `${SITE}${v.startsWith('/') ? '' : '/'}${v}`;
}

export function createHashnodeAdapter({ env = {}, fetchImpl = globalThis.fetch, cfg = null } = {}) {
  return {
    name: 'hashnode',
    enabled() { return secretsPresent(env, 'hashnode'); },
    async post(item) {
      // Content items only. The FULL-vs-STUB decision comes from the canonical FILE's visibility (the
      // authority), so no pre-skip on the queue item's visibility copy. Skips stay terminal no-ops.
      if (item.source === 'share') return { ok: true, skipped: true, reason: 'hashnode crossposts content items only' };
      const path = contentPathFor(item);
      if (!path) return { ok: true, skipped: true, reason: 'no canonical path for the item' };

      let raw;
      try {
        const res = await fetchImpl(`${RAW_BASE}/${path}`, { headers: { 'User-Agent': USER_AGENT } });
        if (!res?.ok) return { ok: false, error: `hashnode: could not read the canonical file (${res?.status ?? 'no response'})` };
        raw = await res.text();
      } catch (err) {
        return { ok: false, error: `hashnode: canonical read failed (${err?.message || 'fetch error'})`.slice(0, 160) };
      }

      // The byline + the CTA footer: the manual rail pre-renders them (item.hashnodeIntro/hashnodeFooter);
      // the AUTO rail falls back to the admin-stored channel templates via cfg, then the built-ins. The
      // queue item's visibility keys the TEMPLATE choice only; the canonical FILE stays the full-vs-stub authority.
      const stubish = item.membersOnly === true || String(item.visibility || '') === 'members';
      const intro = (typeof item.hashnodeIntro === 'string' && item.hashnodeIntro.trim())
        ? item.hashnodeIntro
        : renderTemplate(templateFor(cfg, 'hashnode-intro', 'hashnode', { stub: stubish }) || DEFAULT_INTRO, item, { limit: 800 });
      const footer = (typeof item.hashnodeFooter === 'string' && item.hashnodeFooter.trim())
        ? item.hashnodeFooter
        : renderTemplate(templateFor(cfg, 'hashnode-footer', 'hashnode', { stub: stubish }) || '', item, { limit: 1200 });
      const stubBody = (typeof item.hashnodeStub === 'string' && item.hashnodeStub.trim())
        ? item.hashnodeStub
        : renderTemplate(templateFor(cfg, 'hashnode-stub', 'hashnode', { stub: true }) || '', item, { limit: 1200 });
      // SOW-138: the PUBLIC body template stays a RAW string ({body} resolves inside prepareHashnodeBody). The
      // popup override wins (dev.to-only today), else the admin-stored template, else '{body}'.
      const bodyTemplate = (typeof item.hashnodeBodyTemplate === 'string' && item.hashnodeBodyTemplate.trim())
        ? item.hashnodeBodyTemplate
        : (templateFor(cfg, 'hashnode-body', 'hashnode') || '{body}');
      const prepared = prepareHashnodeBody(raw, item, { intro, footer, stubBody, bodyTemplate });
      if (!prepared.ok) return { ok: true, skipped: true, reason: `hashnode: ${prepared.reason}` };

      const title = ((typeof item.textOverride === 'string' && item.textOverride.trim()) ? item.textOverride : String(item.title || ''))
        .slice(0, channelLimit('hashnode'));
      if (!title) return { ok: false, error: 'hashnode: the item has no title' };

      const publicationId = String(env.HASHNODE_PUBLICATION_ID || '');
      if (!publicationId) return { ok: false, error: 'hashnode: no publication id configured' };

      const input = {
        title,
        contentMarkdown: prepared.body,
        publicationId,
        tags: prepared.tags,
        ...(String(item.url || '') ? { originalArticleURL: String(item.url) } : {}),
        // SOW-139: a custom cover wins, else the branded per-type feature card (never no cover), mirroring the
        // website's defaultFeatureImage fallback so an uncovered crosspost still reads as GBTI.
        coverImageOptions: { coverImageURL: absoluteImage(item.image) || defaultSyndicationCover(item.source) },
      };
      const res = await fetchImpl(HASHNODE_GQL, {
        method: 'POST',
        headers: { Authorization: String(env.HASHNODE_TOKEN || ''), 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify({ query: PUBLISH_MUTATION, variables: { input } }),
      });
      if (res.status === 429) return { ok: false, error: 'hashnode 429 (rate limited)' };
      const rawText = await res.text().catch(() => '');
      let body = {};
      try { body = JSON.parse(rawText); } catch { /* a non-JSON edge/block page */ }
      if (!res.ok) {
        const detail = body?.errors?.[0]?.message ? String(body.errors[0].message) : rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
        return { ok: false, error: `hashnode ${res.status}${detail ? ` ${detail}` : ''}`.slice(0, 160) };
      }
      // GraphQL answers 200 even on error; a non-empty errors[] is a real failure.
      if (Array.isArray(body?.errors) && body.errors.length) {
        return { ok: false, error: `hashnode: ${String(body.errors[0]?.message || 'graphql error')}`.slice(0, 160) };
      }
      const post = body?.data?.publishPost?.post || null;
      return { ok: true, id: post?.id != null ? String(post.id) : null, url: post?.url || null, stub: prepared.mode === 'stub' };
    },
  };
}
