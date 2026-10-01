// sow-427: the FILES a prepared-listing claim commits, built from the stored record and nothing else. Pure and
// node-free, so the Worker's claim route, the save-time size check and the tests all build the same set.
//
// ONE PULL REQUEST, THREE KINDS OF FILE, and each one is load-bearing:
//   - the project, published and public under the claimant's folder, byte for byte what the superadmin prepared
//     apart from what the claim itself decides (author, status, visibility, the claim date);
//   - the claimant's own author note, in the SAME pull request, because the post-publish remediation job drafts a
//     published project without its note within minutes (trap 3, measured on SurfacedBy, 2026-09-28);
//   - a basic profile when the member has none (owner decision 7), so the byline links to a real page.
// Plus the project's images, co-located at `projects/<slug>/images/<name>`, which is where the Astro build resolves
// `./images/<name>` from the project's index.md.
//
// THE FOLDER IS NEVER THE LOGIN. It is the members-index entry for the verified account number (sow-428: a GBTI
// name can differ from the GitHub login), and the caller resolves it; this module only checks its shape.
//
// No logging anywhere in this module: the note is someone's own words and the title is about them.

import { buildContentFile, buildCommentFile, ContentValidationError } from '../client/src/content-ops.mjs';
import { validateHostedRequest } from './hosted-author.mjs';
import { nodeAt } from './taxonomy-edits.mjs';
import { licenseProblems, licenseEntries } from './licenses.mjs';
import { claimProjectInput, isListingImageName, PLACEHOLDER_FOLDER, validatePreparedDraft } from './prepared-listings.mjs';

/** The longest author note the claim accepts. */
export const MAX_CLAIM_NOTE = 2000;
const FOLDER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The claimant's author note. It is markdown in their own voice, so line breaks are kept; a tab becomes a space;
 * every other control character is removed; runs of blank lines collapse; trimmed and capped at MAX_CLAIM_NOTE.
 */
export function sanitizeClaimNote(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CLAIM_NOTE)
    .trim();
}

/**
 * Why `categories` is not a valid path in the parsed house/taxonomy.yml, or null when it is. Reuses nodeAt
 * (membership/taxonomy-edits.mjs), the same walk the category manager uses, and agrees with validate-content's
 * rule: absent or empty is allowed (uncategorized), anything else must resolve node by node. FAILS CLOSED: a
 * taxonomy that could not be read refuses any non-empty path rather than admitting it.
 */
export function categoryPathProblem(categories, taxonomy) {
  if (categories === undefined || categories === null) return null;
  if (!Array.isArray(categories)) return 'categories must be a list naming one place in the category tree.';
  if (categories.length === 0) return null;
  if (!categories.every((c) => typeof c === 'string' && c)) return 'categories must be a list of category keys.';
  if (!isPlainObject(taxonomy?.tree)) return 'The category tree could not be read, so the category cannot be checked. Try again shortly.';
  if (!nodeAt(taxonomy, categories)) return `The category ${categories.join(' > ')} is not in the category tree.`;
  return null;
}

/**
 * The checks that need the house lists, as sentences for the superadmin (or []). Run at preparation and again at
 * the claim, because either list can change in between. `taxonomy` and `licenses` are the PARSED house/taxonomy.yml
 * and house/licenses.yml (the Worker reads them with loadHouseYaml). A licence set on the project while the licence
 * list cannot be read is refused, never waved through.
 */
export function listingHouseProblems(frontmatter, { taxonomy = null, licenses = null } = {}) {
  const fm = isPlainObject(frontmatter) ? frontmatter : {};
  const out = [];
  const cat = categoryPathProblem(fm.categories, taxonomy);
  if (cat) out.push(cat);
  const hasLicense = (fm.license !== undefined && fm.license !== null && fm.license !== '')
    || (fm.licenseUrl !== undefined && fm.licenseUrl !== null && fm.licenseUrl !== '');
  if (hasLicense) {
    if (!licenseEntries(licenses).length) out.push('The licence list could not be read, so the licence cannot be checked. Try again shortly.');
    else out.push(...licenseProblems({ license: fm.license, licenseUrl: fm.licenseUrl }, licenses));
  }
  return out;
}

/** `images` as a Map of name to base64, from a Map, a plain object, or an array of `{ name, dataBase64 }`. */
function imageMap(images) {
  if (images instanceof Map) return images;
  const m = new Map();
  if (Array.isArray(images)) {
    for (const i of images) if (i && typeof i.name === 'string') m.set(i.name, i.dataBase64 ?? i.contentBase64);
  } else if (isPlainObject(images)) {
    for (const [k, v] of Object.entries(images)) m.set(k, v);
  }
  return m;
}

const fail = (error, message) => ({ ok: false, error, message });

/**
 * Build the claim's file set.
 *
 * @param listing  the stored listing record (its frontmatter, body, slug and images are what is published)
 * @param folder   the claimant's members-index folder (never their login, never a request value)
 * @param note     the claimant's author note (required)
 * @param profile  `{ displayName }` when the member has no profile.md on main, else null. The avatar is left out on
 *                 purpose: the site draws it from the member's account number at /avatar/<folder> (sow-428), and a
 *                 login-derived picture address would show whoever holds that name on GitHub.
 * @param images   the listing's image bytes (Map, object, or `[{ name, dataBase64 }]`); every name the listing
 *                 records must be present
 * @param now      the claim time, which becomes the project's publishedAt and the note's createdAt
 * @returns `{ ok: true, itemId, title, projectPath, notePath, profilePath, files }` where `files` is the
 *          `/membership/author`-shaped list (`{ path, content }` for text, `{ path, contentBase64 }` for images),
 *          or `{ ok: false, error, message }` with error one of 'bad_folder', 'note_required', 'invalid',
 *          'image_missing'.
 */
export function buildClaimFiles({ listing, folder, note, profile = null, images = null, now = new Date() } = {}) {
  if (!FOLDER_RE.test(String(folder ?? ''))) return fail('bad_folder', 'No member folder is set up for this account yet.');
  const text = sanitizeClaimNote(note);
  if (!text) return fail('note_required', 'Write a short note about the project in your own words.');
  if (!isPlainObject(listing) || listing.type !== 'project' || !isPlainObject(listing.frontmatter)) {
    return fail('invalid', 'This listing cannot be published.');
  }
  // The stored project is validated AGAIN, exactly as at preparation, so a record edited by hand in KV (or written
  // before a rule existed) cannot reach the repository by skipping the checks.
  const check = validatePreparedDraft({ type: 'project', slug: listing.slug, frontmatter: listing.frontmatter, body: listing.body ?? '' });
  if (!check.ok) return fail('invalid', check.issues.join(' '));
  const { slug, frontmatter, body } = check.draft;
  const at = (now instanceof Date ? now : new Date(now)).toISOString();

  const files = [];
  let project;
  try {
    project = buildContentFile({ type: 'project', username: folder, input: claimProjectInput(frontmatter, { slug, publishedAt: at }), body });
  } catch (e) {
    return fail('invalid', e instanceof ContentValidationError ? e.message : 'The project could not be built.');
  }
  files.push({ path: project.path, content: project.markdown });

  let intro;
  try {
    intro = buildCommentFile({
      username: folder,
      input: {
        id: `intro-${slug}`, targetType: 'project', targetSlug: slug, createdAt: at,
        status: 'published', visibility: 'public', authorNote: true,
      },
      body: text,
    });
  } catch (e) {
    return fail('invalid', e instanceof ContentValidationError ? e.message : 'The note could not be built.');
  }
  files.push({ path: intro.path, content: intro.markdown });

  let profilePath = null;
  if (profile) {
    // eslint-disable-next-line no-control-regex
    const displayName = String(profile.displayName ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 100) || folder;
    let prof;
    try { prof = buildContentFile({ type: 'profile', username: folder, input: { displayName } }); }
    catch { return fail('invalid', 'The profile could not be built.'); }
    files.push({ path: prof.path, content: prof.markdown });
    profilePath = prof.path;
  }

  // The images the project references are exactly the ones it carries: the validated draft's list, not the
  // stored list, so a name recorded but no longer used is never committed.
  const bytes = imageMap(images);
  const dir = project.path.replace(/\/index\.md$/, '/images');
  for (const name of check.draft.images) {
    if (!isListingImageName(name)) return fail('invalid', 'An image name is not valid.');
    const b64 = bytes.get(name);
    if (typeof b64 !== 'string' || !b64) return fail('image_missing', `The image ${name} is missing. Upload it again.`);
    files.push({ path: `${dir}/${name}`, contentBase64: b64 });
  }

  return {
    ok: true,
    itemId: `project-${slug}`,
    title: String(frontmatter.title ?? '').trim(),
    projectPath: project.path,
    notePath: intro.path,
    profilePath,
    files,
  };
}

/**
 * Amendment 9: the SIZE DRY RUN at preparation. Builds the claim's files for a placeholder folder, with a note of
 * the longest length a claimant may write and a profile, then applies the hosted request rules the claim will
 * meet (validateHostedRequest: the file count, the per-file and total text caps, the per-image and total image
 * caps). The limits live in membership/hosted-author.mjs and are not restated here. Returns null when a claim
 * would fit, else `{ status, error, message }`, so a listing that could never be claimed is refused when it is
 * saved rather than at every claim.
 *
 * @param listing a record-shaped object: `{ type: 'project', slug, frontmatter, body }`
 * @param images  the image bytes, as buildClaimFiles takes them
 */
export function preparedSizeProblem({ listing, images = null } = {}) {
  const built = buildClaimFiles({
    listing, folder: PLACEHOLDER_FOLDER, note: 'x'.repeat(MAX_CLAIM_NOTE), profile: { displayName: 'x'.repeat(100) }, images,
  });
  if (!built.ok) return { status: 400, error: built.error, message: built.message };
  const v = validateHostedRequest({ files: built.files, itemId: built.itemId, folder: PLACEHOLDER_FOLDER, allowAnyFolder: false });
  if (!v.ok) {
    return /exceeds|too many/.test(String(v.error))
      ? { status: 413, error: 'too_large', message: `This listing would be too large to publish: ${v.error}.` }
      : { status: 400, error: 'invalid', message: `This listing could not be published as it stands: ${v.error}.` };
  }
  return null;
}
