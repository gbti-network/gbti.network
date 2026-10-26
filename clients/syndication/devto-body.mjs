// SOW-088: the dev.to full-body crosspost pipeline (pure; the adapter feeds it the raw canonical file).
// Queue items are structurally body-free (the SOW-058 leak guard), so the dev.to adapter fetches the
// PUBLIC item's raw index.md at post time and this module turns it into a dev.to article body:
//   1. split the frontmatter (status/visibility/tags come from it, never trusted from the queue item);
//   2. FAIL CLOSED unless `status: published` and `visibility: public` — and CUT everything at/after the
//      SOW-016 `<!-- members-only -->` marker, so a members-only section can never crosspost;
//   3. rewrite RELATIVE image/link targets `](./x)` to GitHub's raw host over the canonical repo (sow-450:
//      jsDelivr refuses this repo, over its 50 MB limit), because dev.to cannot resolve repo-relative paths;
//   4. prepend the rendered byline intro (the {fullName}/{member-url} template) + a blank line;
//   5. normalize tags for dev.to (lowercase alphanumeric, max 4; fallback: the taxonomy path leaves).

import { DATA_BLOCKS, dataBlockToMarkdown } from '../../client/src/content-blocks.mjs';
import yaml from 'js-yaml';
import { renderBodyTemplate } from '../../membership/syndication-format.mjs';

export const DEVTO_CDN_BASE = 'https://raw.githubusercontent.com/gbti-network/gbti.network/main';
export const MEMBERS_MARKER = '<!-- members-only -->';
const SUB = { post: 'posts', project: 'projects', product: 'projects', prompt: 'prompts' };

/**
 * The canonical repo path for a content item; null for shares (a share has no article body).
 *
 * `targetSlug` arrives in TWO shapes. The manual rail passes a BARE slug ("my-post"), while the auto rail
 * passes the queue path-key, which is already the full folder path ("members/alice/posts/my-post", see
 * pathKey in scripts/enqueue-syndication.mjs). Wrapping the second shape produced a doubled path and a
 * hard 404 on every auto-rail crosspost, so accept either.
 */
export function contentPathFor(item) {
  const sub = SUB[item?.source];
  const author = String(item?.author || '').trim();
  const slug = String(item?.targetSlug || '').trim();
  if (!sub || !author || !slug) return null;
  const base = (slug.startsWith('members/') || slug.startsWith('house/')) ? slug : `members/${author}/${sub}/${slug}`;
  return `${base}/index.md`;
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

/** Split frontmatter and FAIL CLOSED unless `status: published`. Shared by the dev.to + Hashnode pipelines.
 *  Returns { ok:true, fm, body } (body = everything after the frontmatter) or { ok:false, reason }. */
export function parsePublishedFile(rawFileText) {
  const text = String(rawFileText ?? '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { ok: false, reason: 'no frontmatter in the canonical file' };
  let fm;
  try { fm = yaml.load(m[1]) ?? {}; } catch { return { ok: false, reason: 'unparseable frontmatter' }; }
  if (String(fm.status ?? '') !== 'published') return { ok: false, reason: 'the item is not published' };
  return { ok: true, fm, body: text.slice(m[0].length) };
}

/** sow-452: site-only fences (```directory, a sortable list) mean nothing on dev.to or Hashnode, where they would
 *  show as a code block. Drop them; the entries after them read in their source order. */
export function stripSiteOnlyFences(body) {
  return dataBlocksToMarkdown(embedFencesToLinks(String(body))).replace(/^```directory[^\n]*\n[\s\S]*?^```[ \t]*\n?/gm, '').replace(/\n{3,}/g, '\n\n');
}

/** sow-453: ```tags, ```bar, ```facts and ```button as plain markdown (an italic line, a bold figure, a list, a link).
 *  sow-455: a ```reveal is written out open (its weights, note and body). An ```audio player becomes a link to the
 *  file. The names come from DATA_BLOCKS, so a new block cannot reach a cross-post as a code block. */
const DATA_FENCE_RE = new RegExp(`^\`\`\`(${DATA_BLOCKS.join('|')})(?:[ \\t]([^\\n]*))?\\n([\\s\\S]*?)^\`\`\`[ \\t]*$`, 'gm');
export function dataBlocksToMarkdown(body) {
  return String(body).replace(DATA_FENCE_RE, (m, name, meta, inner) => dataBlockToMarkdown(name, inner, meta || '') ?? m);
}

/** A ```embed fence (with or without `lightbox`) is a player on the site and a code block anywhere else. Cross-posts
 *  get the video's thumbnail linking to it (YouTube), or the plain link for other providers. */
export function embedFencesToLinks(body) {
  return String(body).replace(/^```embed(?:[ \t][^\n]*)?\n([\s\S]*?)^```[ \t]*$/gm, (_m, inner) => {
    const url = String(inner).trim();
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    return yt ? `[![Video](https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg)](${url})` : `<${url}>`;
  });
}

/** Rewrite repo-relative image/link targets ("](./x)" and "](images/x)") to GitHub's raw host over the item's
 *  folder. Shared by the dev.to + Hashnode pipelines (neither can resolve repo-relative paths). */
export function rewriteRelativeImages(body, item, cdnBase = DEVTO_CDN_BASE) {
  const path = contentPathFor(item);
  const dir = path ? path.replace(/\/index\.md$/, '') : null;
  if (!dir) return String(body);
  return String(body)
    .replace(/\]\(\.\/([^)\s]+)\)/g, `](${cdnBase}/${dir}/$1)`)
    .replace(/\]\((images\/[^)\s]+)\)/g, `](${cdnBase}/${dir}/$1)`);
}

/**
 * Transform the raw canonical file into { ok, mode, body, tags } or { ok: false, reason } (fail-closed).
 * `intro` / `footer` / `stubBody` arrive PRE-RENDERED (the caller renders the templates; no tokens here).
 * `bodyTemplate` (SOW-138) is the RAW public-body template string: its `{body}` token expands to the public
 * article VERBATIM here (where the fetched body is available), the rest renders through renderBodyTemplate.
 * Mode comes from the FILE's visibility (the authority, never the queue item's copy):
 *   public  -> 'full': the public body run through bodyTemplate, between the byline and the CTA footer;
 *   members -> 'stub' (owner-directed): the byline + the rendered devto-stub template +
 *              the CTA footer — the description and link only, NEVER any of the body (bodyTemplate ignored).
 */
export function prepareDevtoBody(rawFileText, item, { intro = '', footer = '', stubBody = '', bodyTemplate = '{body}' } = {}) {
  const parsed = parsePublishedFile(rawFileText);
  if (!parsed.ok) return parsed;
  const fm = parsed.fm;

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

  let body = parsed.body;
  const marker = body.indexOf(MEMBERS_MARKER);
  if (marker !== -1) body = body.slice(0, marker); // the public part only, defense in depth
  body = body.trim();
  if (!body) return { ok: false, reason: 'the public body is empty' };

  body = rewriteRelativeImages(stripSiteOnlyFences(body), item); // relative targets -> the CDN over the item's folder

  // SOW-138: the public body runs through the admin/popup body template ({body} = the article verbatim; the
  // default '{body}' reproduces today's post exactly). The article is NEVER sanitized/truncated (renderBodyTemplate).
  const middle = renderBodyTemplate(bodyTemplate, item, body);
  body = [lead, middle, tail].filter(Boolean).join('\n\n');
  return { ok: true, mode: 'full', body, tags };
}
