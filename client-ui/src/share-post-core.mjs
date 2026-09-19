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
// THE AFFORDANCE IS NOT THE BOUNDARY, and that is deliberate rather than an oversight. The server decides: the
// Worker's audience rule (workers/signup/membership-audience.mjs) refuses a public share from anyone but a
// superadmin, on both publish routes. This function exists so a member does not compose an entire Share and meet
// the wall AFTER submitting. Removing it would degrade the experience; it would not open a hole.
export const SHARE_LOCKED_STATES = new Set(['expired', 'cancelled', 'none', 'banned']);

/**
 * sow-293 INVERTED this gate, by owner ruling of 2026-09-03. It used to withhold the WHOLE composer from a
 * paid member below Content Creator (the sow-218 `not-creator` splash). Sharing is now open to every paid
 * member; only the Public audience is restricted, to superadmins (sow-323, see canSharePublicly below).
 *
 * @returns {'no-client'|'loading'|'locked'|'trial'|'composer'}
 */
export function shareComposerView({ hasClient = false, membership } = {}) {
  if (!hasClient) return 'no-client';
  if (membership === undefined) return 'loading';
  if (SHARE_LOCKED_STATES.has(membership)) return 'locked';
  if (membership === 'trialing') return 'trial';
  return 'composer';
}

/**
 * sow-323 Phase 3: may this viewer choose PUBLIC for a share?
 *
 * Owner, 2026-09-15: "Only superadmins can make shares public though, so don't even give members the option on
 * creation." So the Public choice is offered to a SUPERADMIN, and otherwise only to keep a share that is ALREADY
 * public public while its author edits it (an approved share must not be taken down by its author's typo fix, and
 * the Worker admits that edit through approvedOnMain). A trusted author does not get it: that tier waives review
 * for articles, projects and prompts, not for shares.
 *
 * FAILS CLOSED on an absent role now. It used to fail open on an absent tier so a down status oracle could not
 * strip public posting from a trusted author, but the only people who may post a public share are superadmins,
 * and the Worker refuses everyone else (membership-audience.mjs), so offering the option on an unknown role would
 * only offer something the server then refuses.
 */
export function canSharePublicly({ membership, role = null, editingPublic = false } = {}) {
  if (SHARE_LOCKED_STATES.has(membership) || membership === 'trialing') return false;
  if (editingPublic === true) return true;
  return role === 'superadmin';
}

// ---- sow-304: editing a published share ----------------------------------------------------------------------
// The composer is the editor. An edit re-publishes the SAME id through the same path a new share takes (the hosted
// author route and the npm publish op are both idempotent by item id), so what changes is only the INPUT it sends.
// These helpers decide that input and are pure so the owner's rules are unit-tested rather than buried in DOM code.
//
// Owner decisions, 2026-09-09: the url is FROZEN after publish (it is the identity of what was shared; discussion,
// upvotes and the Discord and Reddit posts all point at it) but the member may REMOVE it; title, description,
// note, category, tags and image are editable; the audience may change in either direction (sow-323: public only by a
// superadmin, or kept public on an already-public share); a share is never
// deleted, only unpublished (status: draft) through the same path; an edit never re-syndicates (syndication fires
// on the first publish transition only, which is already how the enqueue runner works).

const SHARE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The frontmatter input an EDIT sends. `share` is the stored summary (id, createdAt, url, visibility, status,
 * encryptedBody); `fields` is what the form holds now. Returns null without a usable id.
 *
 *  - `createdAt` is preserved (the id encodes it and the feeds sort on it), `updatedAt` is stamped with `now`.
 *  - the url survives from the STORED share, never from the form; `fields.removeUrl === true` drops it.
 *  - `encryptedBody` is never carried: the publish planner re-derives it from the audience and the note, so a
 *    stale pointer can never ride along into a public share.
 *  - `status` is the stored status unless the caller flips it (unpublish, or publish again).
 */
export function editInputFor({ share, fields = {}, now = null, status = null } = {}) {
  const id = String(share?.id ?? '');
  if (!SHARE_ID_RE.test(id)) return null;
  const stamp = now || new Date().toISOString();
  const input = { id, createdAt: share.createdAt || stamp, updatedAt: stamp };
  if (fields.removeUrl !== true && typeof share.url === 'string' && share.url) input.url = share.url;
  for (const k of ['title', 'shortDescription', 'category', 'image']) {
    const v = fields[k];
    if (typeof v === 'string' && v.trim()) input[k] = v.trim();
  }
  // sow-283: the edit rebuilds the file from this list, so a field it does not name is DROPPED on save. An
  // unchanged image that points at our hosted copy keeps the original it was copied from, or the share could
  // never be given that original back if it later goes members-only.
  if (input.image && input.image === share.image && typeof share.imageSource === 'string' && share.imageSource) {
    input.imageSource = share.imageSource;
  }
  // sow-272: a removed preview stays removed across edits, so the share-covers workflow never looks one up.
  if (!input.image && fields.imageRemoved === true) input.imageRemoved = true;
  // sow-365: a redirect left by an earlier move survives every later edit. Dropping it would turn the old
  // url back into a 404 the moment the member touches the share again.
  if (Array.isArray(share.redirectFrom) && share.redirectFrom.length) input.redirectFrom = share.redirectFrom.filter((x) => typeof x === 'string' && x.trim());
  // sow-222: the stored creator survives an edit. It is learned once, from the link preview at publish time,
  // and an edit that dropped it would silently turn Subscribe back into Visit with nothing to relearn it from.
  if (typeof share.creatorUrl === 'string' && share.creatorUrl) input.creatorUrl = share.creatorUrl;
  if (typeof share.creatorName === 'string' && share.creatorName) input.creatorName = share.creatorName;
  if (Array.isArray(fields.tags) && fields.tags.length) input.tags = fields.tags;
  const vis = fields.visibility ?? share.visibility;
  input.visibility = vis === 'public' ? 'public' : 'members';
  const st = status ?? share.status ?? 'published';
  input.status = st === 'draft' ? 'draft' : 'published';
  return input;
}

/**
 * The ciphertext to DELETE alongside an edit, or null. A members share keeps its note in a sibling .enc; when the
 * audience flips to public the note goes into the .md in the clear and the old .enc would otherwise sit orphaned
 * beside it. Only a stored pointer under the member's own _enc/ folder is ever returned.
 */
export function encRemovalFor({ share, visibility, username = null } = {}) {
  const enc = typeof share?.encryptedBody === 'string' ? share.encryptedBody : '';
  if (!enc || visibility !== 'public') return null;
  if (username && !enc.startsWith(`members/${username}/_enc/`)) return null;
  return enc;
}

/**
 * sow-183 for shares (owner, 2026-09-10): a superadmin may post a share AS another member, or move one of their own
 * shares to another member. The picker's value is a member login; '' means "me" on a new share. The target to send
 * is the pick when it differs from where the share is, else undefined, so an untouched picker never moves anything.
 */
export function shareAuthorTarget(selected, current = '') {
  const v = String(selected || '').trim().toLowerCase();
  const c = String(current || '').trim().toLowerCase();
  if (!v || v === c) return undefined;
  return /^[a-z0-9][a-z0-9-]*$/.test(v) ? v : undefined;
}

/**
 * The files an author move must DELETE from the old folder: the stub .md and, for a members share, its ciphertext.
 * Only paths under the share's CURRENT author folder are ever named, so a move can never delete outside it.
 */
export function authorMoveRemovals({ share, authorTarget } = {}) {
  const from = String(share?.author || authorFromPath(share?.path) || '').toLowerCase();
  const to = String(authorTarget || '').trim().toLowerCase();
  if (!from || !to || from === to) return [];
  const out = [];
  if (typeof share?.path === 'string' && share.path.startsWith(`members/${from}/shares/`)) out.push(share.path);
  const enc = typeof share?.encryptedBody === 'string' ? share.encryptedBody : '';
  if (enc && enc.startsWith(`members/${from}/_enc/`)) out.push(enc);
  return out;
}

/**
 * sow-363: the cover a share carries when it MOVES to another member. A hosted cover is stored under the
 * author's own folder (members/<author>/shares/images/...) and served from /media/shares/<author>/..., so the
 * old url stops being the new owner's to point at: the covers workflow reaps a copy whose share has left,
 * and the share is then left declaring an image nobody serves. That took production down on 2026-09-18, because
 * the og:image size guard cannot measure a same-host image that is not there.
 *
 * So a move drops the hosted url and hands back the ORIGINAL (imageSource), which is the state the covers
 * workflow re-hosts from, under the new owner. A cover with no original recorded is dropped rather than
 * carried, because a broken image is worse than none and the guard fails the build on it. An outside image
 * (any url we do not serve) is left exactly as it is. Key order is preserved, so a move does not reshuffle
 * the frontmatter beyond the fields it changes.
 */
export function coverAfterAuthorMove(input, { fromUser, toUser } = {}) {
  const from = String(fromUser || '').trim().toLowerCase();
  const to = String(toUser || '').trim().toLowerCase();
  if (!input || !from || !to || from === to) return input;
  const image = typeof input.image === 'string' ? input.image : '';
  const m = /^https?:\/\/gbti\.network\/media\/shares\/([a-z0-9][a-z0-9-]*)\//i.exec(image);
  if (!m || m[1].toLowerCase() === to) return input; // not ours to move, or already the new owner's
  const next = { ...input };
  const source = typeof input.imageSource === 'string' && input.imageSource.trim() ? input.imageSource.trim() : '';
  if (source) next.image = source; else delete next.image;
  delete next.imageSource;
  return next;
}

/**
 * sow-365: the redirect a share MOVE leaves behind. A share's public url carries the author
 * (/shares/<author>/<id>/), so moving it to another member retires that url: the page stops being built and
 * anyone holding the link gets a 404, or worse, whatever the edge cached before the move, which is a page
 * that has lost its stylesheet and still names the old owner. Measured on 2026-09-19, ten hours after the
 * Estrada move, with seven days of cache left to run.
 *
 * So a move records the old url in `redirectFrom`, the same field a content rename has always used, and the
 * build turns it into a 301 to the new one. Existing entries are kept, so a share moved twice keeps both.
 */
export function redirectAfterAuthorMove(input, { fromUser, toUser, id } = {}) {
  const from = String(fromUser || '').trim().toLowerCase();
  const to = String(toUser || '').trim().toLowerCase();
  const key = String(id || input?.id || '').trim();
  if (!input || !from || !to || from === to || !key) return input;
  const oldUrl = `/shares/${from}/${key}/`;
  const keep = Array.isArray(input.redirectFrom) ? input.redirectFrom.filter((x) => typeof x === 'string' && x.trim()) : [];
  const next = { ...input };
  next.redirectFrom = [...new Set([...keep, oldUrl])];
  return next;
}

/** One line under the audience cards when an edit changes the audience; '' when it does not. */
export function audienceChangeNote(from, to) {
  const f = from === 'public' ? 'public' : 'members';
  const t = to === 'public' ? 'public' : 'members';
  if (f === t) return '';
  return t === 'members'
    ? 'Moving this share to members only: its public page goes away at the next deploy and the note is encrypted.'
    : 'Making this share public: anyone can read it and it can be indexed. Its discussion stays members only.';
}

/** The state a share row shows in the WorkBench list. */
export function shareRowState(share) {
  const st = String(share?.status ?? 'published').toLowerCase();
  if (st === 'draft') return { label: 'Removed', tone: 'muted', published: false };
  return { label: 'Published', tone: 'ok', published: true };
}

/** The public page for a share, or '' when it has none (a members share, or an unpublished one). */
export function sharePublicUrl(share, origin = 'https://gbti.network') {
  if (!share || shareRowState(share).published !== true) return '';
  if (String(share.visibility ?? 'members') !== 'public') return '';
  const author = share.author || authorFromPath(share.path);
  const id = String(share.id ?? '');
  if (!author || !SHARE_ID_RE.test(id)) return '';
  return `${origin}/shares/${encodeURIComponent(author)}/${encodeURIComponent(id)}/`;
}
