// The staged-image reader, shared by the WorkBench preview and both editors.
//
// WHY THIS EXISTS. An uploaded image is committed with its content, in ONE publish PR, so between the upload
// and the merge the bytes live only in the Worker's staged store (`draftimg:<github_id>:<name>`, see
// membership/draft-images.mjs). Every surface resolves an image PATH against jsDelivr over main, so inside
// that window the path 404s: the editor's Media panel said "1 image" over a broken thumbnail, the preview
// showed a broken image, and neither survived a reload. These helpers put the staged bytes in front of the
// resolver until the real file exists on main, after which the key is gone and the CDN answers.
//
// Only the flat own-folder shape `members/<login>/images/<file>` is looked up, because that is exactly what
// the website stager returns (src/lib/workbench-client.ts stageImage) and what referencedImagePaths commits.
// A co-located `./images/x` value comes from the npm client, which writes to disk and stages nothing, so
// consulting the store for one could only ever produce a FALSE hit on a same-named image from another item.

const STAGED_PATH_G = /members\/[A-Za-z0-9-]+\/images\/[^/"'\s)]+\.(?:png|jpe?g|webp|gif)/gi;
const STAGED_PATH = /^members\/[A-Za-z0-9-]+\/images\/[^/]+\.(?:png|jpe?g|webp|gif)$/i;

/** True for a value the website stager could have produced, and so the only shape worth asking the store about. */
export function isStagedImagePath(v) {
  return STAGED_PATH.test(String(v ?? ''));
}

/** The store's key name for a staged path (it is keyed by file NAME under the authenticated member). */
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
  return [...new Set(`${fm}\n${String(body ?? '')}`.match(STAGED_PATH_G) || [])];
}

/** A `data:` URL for one staged image payload, or '' when there is nothing usable. */
export function stagedImageDataUrl(img) {
  const b64 = img?.dataBase64;
  return b64 ? `data:${img.contentType || 'image/png'};base64,${b64}` : '';
}

/**
 * Read the staged bytes for `paths` through the injected `read(path)`, returning `{ path: dataUrl }` for the
 * ones that ARE staged. A miss is the NORMAL steady state (published and merged), so it is skipped rather
 * than reported as a failure, and a throwing read is treated the same way: the caller falls back to the CDN.
 * `have` names what the caller already holds, so a repeat call costs nothing.
 */
export async function loadStagedImages(paths, read, have = {}) {
  const out = {};
  if (typeof read !== 'function') return out;
  for (const raw of new Set(paths || [])) {
    const p = String(raw || '');
    if (!isStagedImagePath(p) || have[p] || out[p]) continue;
    let img = null;
    try { img = await read(p); } catch { img = null; }
    const url = stagedImageDataUrl(img);
    if (url) out[p] = url;
  }
  return out;
}
