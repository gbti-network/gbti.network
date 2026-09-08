// SOW-031: resolve a content thumbnail/cover URL emitted by the per-type index JSON (toIndexItem.thumb) into a
// fully-qualified URL the in-extension UI can put in an <img src>. The index emits a SITE-relative
// `/_astro/...` build-optimized path (or, defensively, an already-absolute URL); the UI prefixes the gbti.network
// origin for the relative case. Pure + node-testable. Returns null for an empty/invalid value (the caller then
// renders no image, never a broken one).

const SITE = 'https://gbti.network';

/** The public content repo (jsDelivr serves committed images from it; the media convention). */
export const CONTENT_REPO = 'gbti-network/gbti.network';

// sow-315: WHICH GIT REF the jsDelivr URLs point at, and why it is not always `main`.
//
// jsDelivr's cache policy is decided by the REF FORM, not by us. A branch ref answers
// `max-age=604800, s-maxage=43200`: twelve hours at the edge and SEVEN DAYS in the viewer's own browser.
// So replacing an image at the same path leaves every reviewer who already opened the page looking at the
// old picture for a week, and no purge API reaches a browser cache. Measured on 2026-09-07: `@main` was
// still serving a cover that had been replaced once and then deleted from main entirely.
//
// A FULL 40-hex commit ref answers `max-age=31536000, immutable` instead, so a new commit is simply a new
// URL and staleness stops being possible.
//
// THE TRAP: an ABBREVIATED sha (`@a3190e5`) resolves as a BRANCH and keeps the mutable seven-day policy.
// It looks pinned, tests that only check URL shape pass, and nothing is fixed. Hence the exact-40 test.
const FULL_SHA = /^[0-9a-f]{40}$/;
export const DEFAULT_REF = 'main';

/** The ref to put after `@`: a full 40-hex commit, else `main`. Never a short sha. Pure. */
export function pinnedRef(sha) {
  const s = String(sha ?? '').trim().toLowerCase();
  return FULL_SHA.test(s) ? s : DEFAULT_REF;
}

// The ref every resolver defaults to. A host sets it once it learns the content commit (the repo-drafts
// envelope carries it); anything that never sets one keeps `main`, which is exactly the old behaviour, so
// every surface degrades safely rather than breaking.
let currentRef = DEFAULT_REF;

/** Set the module-wide content ref. Anything that is not a full sha resets to `main` rather than pinning. */
export function setContentRef(sha) { currentRef = pinnedRef(sha); }

/** The ref in force. Exported so a test can assert it and restore it (the state is module-wide). */
export function contentRef() { return currentRef; }

/** The jsDelivr base for a repo at the ref in force. */
export function cdnBase(repo = CONTENT_REPO, ref = currentRef) {
  return `https://cdn.jsdelivr.net/gh/${repo}@${pinnedRef(ref)}`;
}

/**
 * Install ONE capture-phase error listener that repoints a failed PINNED asset back at `main`.
 *
 * This exists for one window and it is the common one: the authoring loop is commit, then open the review
 * surface. Until the index job finishes (about a minute) the ref in force is the PREVIOUS content commit,
 * where a just-added image does not exist, so a bare pin would turn a stale image into a BROKEN one. The
 * retry costs nothing in the normal case because it only runs on an error, and it degrades to exactly the
 * old `@main` behaviour.
 *
 * Capture phase because `error` does not bubble. `dataset.cdnRetried` makes the retry once-only, so a
 * genuinely missing file still fails instead of looping.
 */
export function attachCdnFallback(root, repo = CONTENT_REPO) {
  if (!root || typeof root.addEventListener !== 'function') return () => {};
  const pinned = new RegExp(`^https://cdn\\.jsdelivr\\.net/gh/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@[0-9a-f]{40}/`);
  const onError = (ev) => {
    const el = ev.target;
    if (!el || el.tagName !== 'IMG' || el.dataset?.cdnRetried) return;
    const src = String(el.getAttribute('src') || '');
    if (!pinned.test(src)) return;
    el.dataset.cdnRetried = '1';
    el.setAttribute('src', src.replace(/@[0-9a-f]{40}\//, `@${DEFAULT_REF}/`));
  };
  root.addEventListener('error', onError, true);
  return () => root.removeEventListener('error', onError, true);
}

/**
 * Rewrite repo-relative image srcs in RAW MARKDOWN to absolute jsDelivr URLs, using the item's repo path
 * as the base (members/<u>/posts/<slug>/index.md -> .../posts/<slug>/images/x.webp). The site build
 * resolves these relatives itself; the in-extension reader renders raw markdown, so without this pass a
 * `![](./images/x.webp)` has no meaningful src outside the repo. Absolute (http, //) and site-absolute
 * (/...) srcs pass through untouched. Pure; a null/absent path returns the markdown unchanged.
 */
export function resolveMarkdownAssets(markdown, itemPath, repo = CONTENT_REPO, ref = currentRef) {
  const md = String(markdown ?? '');
  const folder = String(itemPath || '').replace(/\/[^/]*$/, '').replace(/^\/+/, '');
  if (!folder) return md;
  const base = cdnBase(repo, ref); // sow-315: a commit when one is known, else `main`
  return md.replace(/(!\[[^\]]*\]\()(\.\/)([^\s)]+\))/g,
    (_m, pre, _dot, rest) => `${pre}${base}/${folder}/${rest}`);
}

/**
 * Resolve ONE image value (a frontmatter cover, or a body image block's url) to something an <img src>
 * can actually load. Absolute, protocol-relative and build-optimized `/_astro/` values pass through;
 * anything else is treated as a REPO-relative path and resolved against the item's folder via jsDelivr,
 * exactly as resolveMarkdownAssets does for raw markdown. Without the item path there is no folder to
 * resolve against, so it falls back to the site origin.
 *
 * Shared deliberately: the editor renders `./images/x.webp` live in the page, where the browser resolves
 * it against the PAGE url (`/workbench/` -> a guaranteed 404). Only a repo-aware resolver can turn a
 * content-relative path into a loadable URL outside the site build.
 */
export function resolveContentAsset(value, itemPath, repo = CONTENT_REPO, site = SITE, ref = currentRef) {
  if (!value) return '';
  const s = String(value);
  if (/^https?:\/\//.test(s) || /^\/\//.test(s) || /^\/_astro\//.test(s)) return resolveAsset(s, site) || s;
  const folder = String(itemPath || '').replace(/\/[^/]*$/, '').replace(/^\/+/, '');
  if (folder) return `${cdnBase(repo, ref)}/${folder}/${s.replace(/^\.?\/+/, '')}`; // sow-315: pinned when known
  // No item folder means an explicitly RELATIVE path cannot be resolved. Return nothing rather than a
  // site-origin guess: `https://gbti.network/./images/x.webp` is the exact 404 this function exists to
  // stop, and an empty src renders the placeholder instead of a broken image.
  if (/^\.{1,2}\//.test(s)) return '';
  return resolveAsset(s, site) || '';
}

export function resolveAsset(thumb, site = SITE) {
  if (!thumb || typeof thumb !== 'string') return null;
  if (/^https?:\/\//.test(thumb)) return thumb; // already absolute (a raw/jsDelivr/CDN URL)
  if (/^\/\//.test(thumb)) return `https:${thumb}`; // protocol-relative
  return `${site}${thumb.startsWith('/') ? '' : '/'}${thumb}`; // SITE-relative `/_astro/...`
}
