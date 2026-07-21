// SOW-134: the Hashnode full-body crosspost pipeline (pure). Mirrors the dev.to pipeline: fetching the raw
// canonical file is the adapter's job; this turns it into { ok, mode, body, tags } for the Hashnode
// publishPost mutation. It REUSES the shared dev.to-body helpers so the fail-closed publish gate, the
// SOW-016 members-marker cut, and the relative-image CDN rewrite stay byte-identical to dev.to. The ONLY
// difference is the tag SHAPE: Hashnode wants [{ name, slug }] (max 5), not dev.to's flat lowercase strings.

import { contentPathFor, parsePublishedFile, rewriteRelativeImages, MEMBERS_MARKER } from './devto-body.mjs';

export { contentPathFor };

/** Hashnode tags: [{ name, slug }] with lowercase-alphanumeric-dash slugs, deduped by slug, max 5.
 *  Fallback (no free tags): the taxonomy path leaves. */
export function normalizeHashnodeTags(tags, categoryPath) {
  const src = (Array.isArray(tags) && tags.length ? tags : (Array.isArray(categoryPath) ? categoryPath : []));
  const out = [];
  const seen = new Set();
  for (const t of src) {
    const name = String(t ?? '').trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, name: name || slug });
    if (out.length === 5) break;
  }
  return out;
}

/**
 * Transform the raw canonical file into { ok, mode, body, tags } or { ok: false, reason } (fail-closed).
 * `intro` / `footer` / `stubBody` arrive PRE-RENDERED (the caller renders the templates; no tokens here).
 * Mode comes from the FILE's visibility (the authority, never the queue item's copy), exactly like dev.to:
 *   public  -> 'full': the whole public body (members marker cut) between the byline and the CTA footer;
 *   members -> 'stub': the byline + the rendered stub template + the CTA footer, NEVER any of the body.
 */
export function prepareHashnodeBody(rawFileText, item, { intro = '', footer = '', stubBody = '' } = {}) {
  const parsed = parsePublishedFile(rawFileText);
  if (!parsed.ok) return parsed;
  const fm = parsed.fm;

  const tags = normalizeHashnodeTags(fm.tags, item?.categoryPath);
  const lead = String(intro || '').trim();
  const tail = String(footer || '').trim();

  if (String(fm.visibility ?? 'public') !== 'public') {
    const parts = [lead, String(stubBody || '').trim(), tail].filter(Boolean);
    if (!parts.length) return { ok: false, reason: 'nothing public to post for the members-only item' };
    return { ok: true, mode: 'stub', body: parts.join('\n\n'), tags };
  }

  let body = parsed.body;
  const marker = body.indexOf(MEMBERS_MARKER);
  if (marker !== -1) body = body.slice(0, marker); // the public part only, defense in depth
  body = body.trim();
  if (!body) return { ok: false, reason: 'the public body is empty' };

  body = rewriteRelativeImages(body, item); // relative targets -> the CDN over the item's folder

  body = [lead, body, tail].filter(Boolean).join('\n\n');
  return { ok: true, mode: 'full', body, tags };
}
