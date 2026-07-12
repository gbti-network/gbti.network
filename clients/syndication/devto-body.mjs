// SOW-088: the dev.to full-body crosspost pipeline (pure; the adapter feeds it the raw canonical file).
// Queue items are structurally body-free (the SOW-058 leak guard), so the dev.to adapter fetches the
// PUBLIC item's raw index.md at post time and this module turns it into a dev.to article body:
//   1. split the frontmatter (status/visibility/tags come from it, never trusted from the queue item);
//   2. FAIL CLOSED unless `status: published` and `visibility: public` — and CUT everything at/after the
//      SOW-016 `<!-- members-only -->` marker, so a members-only section can never crosspost;
//   3. rewrite RELATIVE image/link targets `](./x)` to the jsDelivr CDN over the canonical repo (the
//      house media style), because dev.to cannot resolve repo-relative paths;
//   4. prepend the rendered byline intro (the {fullName}/{member-url} template) + a blank line;
//   5. normalize tags for dev.to (lowercase alphanumeric, max 4; fallback: the taxonomy path leaves).

import yaml from 'js-yaml';

export const DEVTO_CDN_BASE = 'https://cdn.jsdelivr.net/gh/gbti-network/gbti.network@main';
const MEMBERS_MARKER = '<!-- members-only -->';
const SUB = { post: 'posts', product: 'products', prompt: 'prompts' };

/** The canonical repo path for a content item; null for shares (a share has no article body). */
export function contentPathFor(item) {
  const sub = SUB[item?.source];
  const author = String(item?.author || '').trim();
  const slug = String(item?.targetSlug || '').trim();
  if (!sub || !author || !slug) return null;
  return `members/${author}/${sub}/${slug}/index.md`;
}

/** dev.to tags: lowercase alphanumeric only, deduped, max 4. Fallback: the taxonomy path leaves. */
export function normalizeDevtoTags(tags, categoryPath) {
  const src = (Array.isArray(tags) && tags.length ? tags : (Array.isArray(categoryPath) ? categoryPath : []));
  const out = [];
  for (const t of src) {
    const clean = String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length === 4) break;
  }
  return out;
}

/**
 * Transform the raw canonical file into { ok, mode, body, tags } or { ok: false, reason } (fail-closed).
 * `intro` / `footer` / `readMore` arrive PRE-RENDERED (the caller renders the templates; no tokens here).
 * Mode comes from the FILE's visibility (the authority, never the queue item's copy):
 *   public  -> 'full': the whole public body (members marker cut) between the byline and the CTA footer;
 *   members -> 'stub' (owner-directed): the byline + the rendered devto-stub template +
 *              the CTA footer — the description and link only, NEVER any of the body.
 */
export function prepareDevtoBody(rawFileText, item, { intro = '', footer = '', stubBody = '' } = {}) {
  const text = String(rawFileText ?? '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { ok: false, reason: 'no frontmatter in the canonical file' };
  let fm;
  try { fm = yaml.load(m[1]) ?? {}; } catch { return { ok: false, reason: 'unparseable frontmatter' }; }
  if (String(fm.status ?? '') !== 'published') return { ok: false, reason: 'the item is not published' };

  const tags = normalizeDevtoTags(fm.tags, item?.categoryPath);
  const lead = String(intro || '').trim();
  const tail = String(footer || '').trim();

  if (String(fm.visibility ?? 'public') !== 'public') {
    // The middle of a stub is the pre-rendered devto-stub TEMPLATE (which normally carries the
    // description + the read-more link); nothing from the body ever enters a stub.
    const parts = [lead, String(stubBody || '').trim(), tail].filter(Boolean);
    if (!parts.length) return { ok: false, reason: 'nothing public to post for the members-only item' };
    return { ok: true, mode: 'stub', body: parts.join('\n\n'), tags };
  }

  let body = text.slice(m[0].length);
  const marker = body.indexOf(MEMBERS_MARKER);
  if (marker !== -1) body = body.slice(0, marker); // the public part only, defense in depth
  body = body.trim();
  if (!body) return { ok: false, reason: 'the public body is empty' };

  // Relative image/link targets -> the CDN over the item's folder ("](./images/x.webp)" and "](images/x)").
  const path = contentPathFor(item);
  const dir = path ? path.replace(/\/index\.md$/, '') : null;
  if (dir) {
    body = body.replace(/\]\(\.\/([^)\s]+)\)/g, `](${DEVTO_CDN_BASE}/${dir}/$1)`);
    body = body.replace(/\]\((images\/[^)\s]+)\)/g, `](${DEVTO_CDN_BASE}/${dir}/$1)`);
  }

  body = [lead, body, tail].filter(Boolean).join('\n\n');
  return { ok: true, mode: 'full', body, tags };
}
