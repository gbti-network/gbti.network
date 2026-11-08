// sow-494: Community, the members-only forum for the meetings the owner runs. The BROWSER-SAFE rules shared by the
// Worker, the website elements and the agent (MCP) tools: kinds, statuses, limits, the reaction set, ids, and the
// validators for entries, answers and posts. Pure: no IO, no logging, no Node-only APIs, so every surface refuses
// exactly the same input.
//
// WHAT AN ENTRY IS. A superadmin creates an entry of one KIND:
//   poll   a poll with choices: members pick one of the host's answers;
//   typed  a poll with a typed answer: members type a short answer of their own;
//   topic  a topic: the host writes a prompt and members post beneath it.
// Every entry has a discussion under it (posts with images, one level of replies, emoji reactions), and its own
// ACCESS: every paid member, or members the superadmin chose by name. Anyone not on an entry never meets it.
//
// The store that enforces all of this is membership/community-store.mjs, inside one Durable Object.

// ---- kinds, statuses, access -----------------------------------------------------------------------------------

export const KINDS = Object.freeze(['poll', 'typed', 'topic']);
export const KIND_LABEL = Object.freeze({ poll: 'Poll', typed: 'Typed poll', topic: 'Topic' });
export const isPollKind = (kind) => kind === 'poll' || kind === 'typed';

/** draft: superadmins only. live: open. closed: voting closed (polls) or topic closed. published: poll results out. */
export const STATUSES = Object.freeze(['draft', 'live', 'closed', 'published']);
export const STATUS_LABEL = Object.freeze({ draft: 'Draft', live: 'Live', closed: 'Closed', published: 'Results' });

export const ACCESS_MODES = Object.freeze(['all', 'chosen']);

/**
 * The reaction set: GitHub's eight, stored by NAME so the record never carries arbitrary text. The emoji is
 * display only.
 */
export const REACTIONS = Object.freeze([
  ['+1', '👍'], ['-1', '👎'], ['laugh', '😄'], ['hooray', '🎉'], ['confused', '😕'], ['heart', '❤️'], ['rocket', '🚀'], ['eyes', '👀'],
]);
export const REACTION_NAMES = Object.freeze(REACTIONS.map((r) => r[0]));
export const REACTION_EMOJI = Object.freeze(Object.fromEntries(REACTIONS));
export const isReaction = (name) => REACTION_NAMES.includes(name);

// ---- limits ----------------------------------------------------------------------------------------------------

export const LIMITS = Object.freeze({
  title: 200,
  promptBytes: 8000,
  optionsMin: 2,
  optionsMax: 8,
  option: 120,
  hint: 80,
  typedShort: 80,
  typedLong: 280,
  meetingLabel: 80,
  chosenMax: 300,
  postBytes: 8000, // the prose editor's cap (client-ui/src/prose-editor-core.mjs COMMENT_MAX_BYTES)
  postImages: 6,
  promptImages: 6,
  imageBytes: 1_048_576, // 1 MB, the site-wide image cap
  imageName: 80,
  groupLabel: 120,
  unattachedImageHours: 24,
});

// ---- ids -------------------------------------------------------------------------------------------------------

// Lowercase base32 without look-alikes: readable in a URL, case-safe, and unguessable at 16 characters (80 bits).
// An entry id is NOT a secret (access is checked on every read), but an unguessable id keeps a private entry's
// existence out of reach of anyone counting upwards.
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ID_RE = /^[abcdefghjkmnpqrstuvwxyz23456789]{16}$/;

/** A fresh id from `randomBytes(n) -> Uint8Array` (crypto.getRandomValues in every runtime here). */
export function newId(randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}
export const isId = (id) => typeof id === 'string' && ID_RE.test(id);
export const GITHUB_ID_RE = /^\d{1,20}$/;
export const isGithubId = (id) => typeof id === 'string' && GITHUB_ID_RE.test(id);

// ---- text helpers ----------------------------------------------------------------------------------------------

const ENC = new TextEncoder();
export const byteLength = (s) => ENC.encode(String(s ?? '')).length;

/** One line of plain text: trimmed, inner whitespace collapsed, control characters removed. */
export function cleanLine(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Multi-line text (markdown): CRLF to LF, control characters other than newline and tab removed, trimmed. */
export function cleanBody(s) {
  return String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, '').trim();
}

/**
 * The key that counts typed answers together: case, spacing, surrounding quotes and trailing punctuation do not
 * make a different answer ("Project Hail Mary!" and "project hail mary" match). Accents and spelling still do;
 * the host merges those by hand.
 */
export function normalizeTyped(text) {
  return cleanLine(String(text ?? '').normalize('NFKC'))
    .toLowerCase()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim();
}

// ---- validation ------------------------------------------------------------------------------------------------

const fail = (problem) => ({ ok: false, problem });

function validMeeting(m) {
  if (m == null) return { ok: true, value: { label: '', date: '' } };
  if (typeof m !== 'object') return fail('meeting must be an object with a label and a date.');
  const label = cleanLine(m.label);
  if (label.length > LIMITS.meetingLabel) return fail(`The meeting name can be up to ${LIMITS.meetingLabel} characters.`);
  const date = m.date == null || m.date === '' ? '' : String(m.date);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('The meeting date must be YYYY-MM-DD.');
  return { ok: true, value: { label, date } };
}

function validAccess(a) {
  if (a == null) return { ok: true, value: { mode: 'all', members: [] } };
  if (typeof a !== 'object' || !ACCESS_MODES.includes(a.mode)) return fail("access.mode must be 'all' or 'chosen'.");
  if (a.mode === 'all') return { ok: true, value: { mode: 'all', members: [] } };
  const list = Array.isArray(a.members) ? a.members.map((x) => String(x)) : null;
  if (!list) return fail('access.members must be a list of GitHub ids.');
  if (list.some((x) => !isGithubId(x))) return fail('Every chosen member must be a GitHub id.');
  const members = [...new Set(list)];
  if (members.length > LIMITS.chosenMax) return fail(`An entry can be shared with up to ${LIMITS.chosenMax} chosen members.`);
  return { ok: true, value: { mode: 'chosen', members } };
}

/**
 * Validate a superadmin's entry input. Returns { ok: true, value } with the normalised entry, or
 * { ok: false, problem } with a sentence a person can act on. The kind decides which fields count.
 */
export function validateEntryInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('An entry is required.');
  const kind = input.kind;
  if (!KINDS.includes(kind)) return fail("kind must be 'poll', 'typed' or 'topic'.");
  const title = cleanLine(input.title);
  if (!title) return fail(kind === 'topic' ? 'The topic needs a title.' : 'The poll needs a question.');
  if (title.length > LIMITS.title) return fail(`The title can be up to ${LIMITS.title} characters.`);
  const prompt = cleanBody(input.prompt);
  if (byteLength(prompt) > LIMITS.promptBytes) return fail('The prompt is too long. Keep it under 8,000 characters.');
  const s = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const settings = { changeable: s.changeable !== false };
  let options = [];
  if (kind === 'poll') {
    const raw = Array.isArray(input.options) ? input.options.map(cleanLine).filter(Boolean) : [];
    if (raw.length < LIMITS.optionsMin) return fail(`A poll needs at least ${LIMITS.optionsMin} answers.`);
    if (raw.length > LIMITS.optionsMax) return fail(`A poll can have up to ${LIMITS.optionsMax} answers.`);
    if (raw.some((o) => o.length > LIMITS.option)) return fail(`Each answer can be up to ${LIMITS.option} characters.`);
    if (new Set(raw.map((o) => o.toLowerCase())).size !== raw.length) return fail('Two answers are the same.');
    options = raw;
    settings.publishOnClose = s.publishOnClose === true;
  } else if (kind === 'typed') {
    const hint = cleanLine(s.hint);
    if (hint.length > LIMITS.hint) return fail(`The hint can be up to ${LIMITS.hint} characters.`);
    settings.hint = hint;
    settings.answerLength = s.answerLength === 'long' ? 'long' : 'short';
    settings.countMatching = s.countMatching !== false;
    settings.publishOnClose = s.publishOnClose === true;
  } else {
    settings.imagesAllowed = s.imagesAllowed !== false;
    delete settings.changeable;
  }
  const meeting = validMeeting(input.meeting);
  if (!meeting.ok) return meeting;
  const access = validAccess(input.access);
  if (!access.ok) return access;
  return { ok: true, value: { kind, title, prompt, options, settings, meeting: meeting.value, access: access.value } };
}

/** The longest typed answer an entry accepts. */
export const typedMax = (entry) => (entry?.settings?.answerLength === 'long' ? LIMITS.typedLong : LIMITS.typedShort);

/** Validate a member's answer for `entry`. Returns { ok, value: { value, norm } } or a problem. */
export function validateAnswer(entry, input) {
  if (!entry || !isPollKind(entry.kind)) return fail('Only a poll takes an answer.');
  if (entry.kind === 'poll') {
    const choice = input?.choice;
    if (!Number.isInteger(choice) || choice < 0 || choice >= (entry.options || []).length) return fail('Choose one of the answers.');
    return { ok: true, value: { value: String(choice), norm: String(choice) } };
  }
  const text = cleanLine(input?.text);
  if (!text) return fail('Type an answer first.');
  const max = typedMax(entry);
  if (text.length > max) return fail(`Answers can be up to ${max} characters.`);
  return { ok: true, value: { value: text, norm: normalizeTyped(text) || text.toLowerCase() } };
}

/** Validate a post or reply. `images` are ids of images this member uploaded to the same entry. */
export function validatePostInput(input) {
  if (!input || typeof input !== 'object') return fail('A post is required.');
  const body = cleanBody(input.body);
  const images = Array.isArray(input.images) ? [...new Set(input.images.map(String))] : [];
  if (images.some((x) => !isId(x))) return fail('An attached image is not valid. Remove it and add it again.');
  if (images.length > LIMITS.postImages) return fail(`A post can carry up to ${LIMITS.postImages} images.`);
  if (!body && !images.length) return fail('Write something or add an image first.');
  if (byteLength(body) > LIMITS.postBytes) return fail('That post is too long. Keep it under 8,000 characters.');
  const parentId = input.parentId == null || input.parentId === '' ? null : String(input.parentId);
  if (parentId !== null && !isId(parentId)) return fail('The post you are replying to was not found.');
  return { ok: true, value: { body, images, parentId } };
}

// ---- images ----------------------------------------------------------------------------------------------------

/**
 * The image type from its first bytes, or null. The file name is never trusted: a renamed file is still what its
 * bytes say. PNG, JPEG, GIF and WebP only; SVG is refused because it can carry script.
 */
export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : null;
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** A display name for an uploaded image: the last path segment, safe characters only, capped. */
export function imageNameOf(name) {
  const base = String(name ?? '').split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, LIMITS.imageName);
  return cleaned || 'image';
}

/** Decode standard base64 to bytes, or null when it is not base64. atob exists in Node, browsers and Workers. */
export function bytesFromBase64(b64) {
  const s = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  let bin;
  try { bin = atob(s); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The longest base64 string that can decode to an image under the cap; anything longer is refused unread. */
export const MAX_IMAGE_BASE64 = Math.ceil(LIMITS.imageBytes / 3) * 4 + 4;

/** Check an upload before storing it. Returns { ok, value: { bytes, contentType, name } } or a problem. */
export function validateImageUpload({ name, dataBase64 } = {}) {
  const s = String(dataBase64 || '');
  if (!s) return fail('Choose an image to upload.');
  if (s.length > MAX_IMAGE_BASE64 + 64) return fail(`${imageNameOf(name)} is larger than 1 MB. Save a smaller copy and add it again.`);
  const bytes = bytesFromBase64(s);
  if (!bytes) return fail('That file could not be read as an image.');
  if (bytes.length > LIMITS.imageBytes) {
    const mb = (bytes.length / 1_048_576).toFixed(1);
    return fail(`${imageNameOf(name)} is ${mb} MB. Images can be up to 1 MB. Save a smaller copy and add it again.`);
  }
  const contentType = sniffImage(bytes);
  if (!contentType) return fail('Images must be PNG, JPG, WebP or GIF.');
  return { ok: true, value: { bytes, contentType, name: imageNameOf(name) } };
}
