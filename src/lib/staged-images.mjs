// The staged-image reader, shared by the WorkBench preview and both editors.
//
// WHY THIS EXISTS. An uploaded image is committed with its content, in ONE publish PR, so between the upload
// and the merge the bytes live only in the Worker's staged store (`draftimg:<github_id>:<type>:<slug>:<file>`,
// see membership/draft-images.mjs). Every surface resolves an image PATH against jsDelivr over main, so inside
// that window the path 404s: the editor's Media panel said "1 image" over a broken thumbnail, the preview
// showed a broken image, and neither survived a reload. These helpers put the staged bytes in front of the
// resolver until the real file exists on main, after which the key is gone and the CDN answers.
//
// The canonical value shape is `./images/<file>`, co-located beside the item's index.md, which is what Astro's
// image() resolves and what every committed item uses. The flat `members/<login>/images/<file>` shape is still
// recognized here because the website stager wrote it until sow-165 reached the website: a draft saved before
// then still holds one, and it should show its picture rather than a broken frame while publish normalizes it.
//
// A lookup is scoped to ONE item by the caller (it binds the item into `read`), so a same-named image staged
// for a different draft can no longer answer for this one.

const NAME = String.raw`[^/"'\s)]+\.(?:png|jpe?g|webp|gif)`;
const CANONICAL_G = new RegExp(String.raw`\.\/images\/${NAME}`, 'gi');
const FLAT_G = new RegExp(String.raw`members\/[A-Za-z0-9-]+\/images\/${NAME}`, 'gi');
const CANONICAL = new RegExp(String.raw`^\.\/images\/[^/]+\.(?:png|jpe?g|webp|gif)$`, 'i');
const FLAT = new RegExp(String.raw`^members\/[A-Za-z0-9-]+\/images\/[^/]+\.(?:png|jpe?g|webp|gif)$`, 'i');

/** True for a value the stager could have produced, and so the only shape worth asking the store about. */
export function isStagedImagePath(v) {
  const s = String(v ?? '');
  return CANONICAL.test(s) || FLAT.test(s);
}

/** The store's file name for a staged path (it is keyed by file NAME under the member and the item). */
export function stagedImageName(p) {
  return isStagedImagePath(p) ? String(p).split('/').pop() : null;
}

/**
 * Every staged-shaped image path a draft references, from the frontmatter (any field, gallery rows and typed
 * links included) and the body. Scanned as text rather than walked field by field, because the shape is
 * specific enough to have no false positives and a walk would miss whichever field is added next.
 */
export function referencedDraftImages(frontmatter = {}, body = '') {
  let fm = '';
  try { fm = JSON.stringify(frontmatter ?? {}); } catch { fm = ''; }
  const hay = `${fm}\n${String(body ?? '')}`;
  return [...new Set([...(hay.match(CANONICAL_G) || []), ...(hay.match(FLAT_G) || [])])];
}

/** A `data:` URL for one staged image payload, or '' when there is nothing usable. */
export function stagedImageDataUrl(img) {
  const b64 = img?.dataBase64;
  return b64 ? `data:${img.contentType || 'image/png'};base64,${b64}` : '';
}

/**
 * Read the staged bytes for `paths` through the injected `read(name, path)`, returning `{ path: dataUrl }` for
 * the ones that ARE staged. The result is keyed by the path exactly as it appears in the field, because that
 * is what every caller looks up (`_stagedSrc[value]`), while the store is keyed by file name: the caller's
 * `read` closure supplies the item scope.
 *
 * A miss is the NORMAL steady state (published and merged), so it is skipped rather than reported as a
 * failure, and a throwing read is treated the same way: the caller falls back to the CDN. `have` names what
 * the caller already holds, so a repeat call costs nothing.
 */
export async function loadStagedImages(paths, read, have = {}) {
  const out = {};
  if (typeof read !== 'function') return out;
  for (const raw of new Set(paths || [])) {
    const p = String(raw || '');
    const name = stagedImageName(p);
    if (!name || have[p] || out[p]) continue;
    let img = null;
    try { img = await read(name, p); } catch { img = null; }
    const url = stagedImageDataUrl(img);
    if (url) out[p] = url;
  }
  return out;
}
