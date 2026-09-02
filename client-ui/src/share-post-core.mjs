// SOW-092: pure helpers behind the share-submit redirect. On success the composer emits a READER-READY
// optimistic item (the SOW-076 instant-feel model: the member sees their share NOW; the canonical version
// replaces it on the next feed load after the ~3 minute deploy). Node-free, no DOM, unit-tested.

/**
 * sow-303: parse a comma-separated tags field into house-shaped tags.
 *
 * WHY THE COMPOSER CANNOT JUST HAND ITS RAW STRING ON. buildShareFile (client/src/content-ops.mjs) validates
 * against the share schema and then serializes the PRE-PARSE object, so tagsSchema's normalization is
 * computed and discarded while its `.refine` rejection still fires. A tag that is not already house-shaped
 * is therefore not repaired on the way in: it throws ContentValidationError and the whole share fails to
 * publish. Everything reaching a share's frontmatter has to arrive correct, which is why this runs at the
 * composer rather than being left to the schema.
 *
 * The transformations MATCH normalizeTag in client/src/schemas.mjs (lowercase, spaces and underscores to
 * hyphens, collapse repeats, trim), plus a hard drop of characters the shape forbids, which normalizeTag does
 * not do (it would leave `c++` as `c++`, which then fails the refine). A test asserts the two agree rather
 * than trusting this paragraph.
 *
 * An unrepairable entry is DROPPED, never mangled into something else: a member losing one tag they typed
 * oddly is a small cost, and a share that refuses to publish is not.
 */
export function normalizeTagInput(raw, { max = 8, minLen = 2, maxLen = 32 } = {}) {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\n]/);
  const out = [];
  for (const part of parts) {
    const t = String(part ?? '')
      .trim().toLowerCase()
      .replace(/^#+/, '')            // a member typing #hashtags means the tag, not the hash
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9.-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '');
    if (t.length < minLen || t.length > maxLen) continue;
    // Redundant by construction, exactly as in the worker's normalizeSuggestedTags: the strips above already
    // guarantee it. Kept as the stated invariant so a future edit to the chain fails here rather than
    // downstream, where an out-of-shape tag makes the whole share refuse to publish.
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** The owning username from a publish result path (members/<user>/shares/<id>.md). Null when unparseable. */
export function authorFromPath(path) {
  const m = /^members\/([a-z0-9][a-z0-9-]*)\//i.exec(String(path || ''));
  return m ? m[1] : null;
}

/**
 * Build the optimistic share item the reader renders immediately after a successful post.
 * `res` is the publishShare result ({ id, path, visibility, ... }), `input`/`body` are what the member
 * just submitted. The item carries the LOCAL plaintext body and NO encryptedBody, so the author's own
 * just-written share renders with zero decrypt round-trip even at members visibility (gbti-reader._body
 * renders whatever body it is handed). Returns null without the id or author (no redirect target).
 */
export function optimisticShareItem({ res, input = {}, body = '', now = null } = {}) {
  const id = res?.id ?? null;
  const author = authorFromPath(res?.path);
  if (!id || !author) return null;
  const createdAt = now ?? new Date().toISOString();
  return {
    type: 'share',
    author,
    id,
    title: input.title || '',
    shortDescription: input.shortDescription || '',
    url: input.url || '',
    image: input.image || null,
    thumb: input.image || null,
    // sow-303: carried so the just-posted share renders its own tags during the ~3 minutes before the
    // canonical version lands. Omitting it made the optimistic item disagree with the file on disk.
    tags: Array.isArray(input.tags) ? input.tags : [],
    visibility: res?.visibility ?? input.visibility ?? 'members',
    body: String(body || ''),
    createdAt,
    publishedAt: createdAt,
  };
}

// sow-204: which of the composer's five states a member meets. Extracted from gbti-share-composer's render()
// because the element is 583 lines of DOM and the DECISION is the part the owner keeps narrowing: the Content
// Creator ruling of 2026-08-28 made it narrower again, and there was no test on it at all. A grep for the
// element's own branch names across test/ returned zero files, with a positive control confirming the search
// reached them, so the tier gate the owner just tightened was resting on nothing.
//
// THE AFFORDANCE IS NOT THE BOUNDARY, and that is deliberate rather than an oversight. The server already
// refuses a non-creator share in two independent places: authorizeCreator on the hosted author route, and
// requiredTierFor at the PR gate, which drops to member tier only when every touched type is a comment. This
// function exists so a Network Member does not compose an entire Share and meet the wall AFTER submitting,
// as a rejected pull request. Removing it would degrade the experience; it would not open a hole.
export const SHARE_LOCKED_STATES = new Set(['expired', 'cancelled', 'none', 'banned']);

/**
 * @returns {'no-client'|'loading'|'locked'|'trial'|'not-creator'|'composer'}
 */
export function shareComposerView({ hasClient = false, membership, tier = null } = {}) {
  if (!hasClient) return 'no-client';
  if (membership === undefined) return 'loading';
  if (SHARE_LOCKED_STATES.has(membership)) return 'locked';
  if (membership === 'trialing') return 'trial';
  // FAIL OPEN HERE, ON PURPOSE, and only here. An ABSENT tier shows the composer, matching the existing
  // `unknown` membership behaviour: a down status oracle must not silently strip posting from a real Content
  // Creator, and the two server checks remain the authority either way. A tier that IS present and is not
  // creator is a real answer and gets the upgrade notice.
  if (tier && tier !== 'creator') return 'not-creator';
  return 'composer';
}
