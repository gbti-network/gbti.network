// sow-494: the Community operations behind the MCP tools. Agents take part the way people do on the page: read the
// list and an entry, answer a poll, post (with images), reply, react, edit or delete their own posts; a superadmin
// also creates entries, runs them through their states, decides who can see each one, moderates and tidies typed
// answers. Every call goes to the signup Worker with the member's GitHub token, and the Worker decides: members only
// (effective paid), an entry only for the members it is shared with, superadmin ops for superadmins.
import { OperationError } from './operations-core.mjs';
import { SIGNUP_BASE } from './signup-base.mjs';
import { SITE_BASE } from './account-ops.mjs';
import { communityRequest, CommunityClientError } from './member-community-client.mjs';
import { KINDS, REACTION_NAMES, LIMITS, isId } from '../../membership/community-shared.mjs';

const R = '/membership/community';
const A = '/membership/admin/community';
const q = (v) => encodeURIComponent(String(v ?? ''));
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
export const STATUS_ACTIONS = Object.freeze(['open', 'close', 'publish', 'unpublish', 'lock', 'unlock', 'delete']);
export const MODERATE_ACTIONS = Object.freeze(['pin', 'unpin', 'hide', 'unhide', 'remove-image']);
export const TIDY_ACTIONS = Object.freeze(['rename', 'merge', 'hide', 'unhide']);

/** The Worker's answer as an OperationError the MCP host reports. A private entry and a missing one read the same. */
export function communityOpError(e) {
  if (!(e instanceof CommunityClientError)) return e;
  const s = e.status;
  if (s === 401) return new OperationError('not-authenticated', 'Sign in first (call login).');
  if (s === 403 && /paid membership/i.test(e.message)) return new OperationError('membership-required', 'Community is for paid members.');
  if (s === 403) return new OperationError('forbidden', e.message);
  if (s === 404) return new OperationError('not-found', 'That entry or post was not found, or it is not shared with you.');
  if (s === 409) return new OperationError('conflict', e.message);
  if (s === 400 || s === 413) return new OperationError('bad-request', e.message);
  if (s === 429) return new OperationError('rate-limited', e.message);
  return new OperationError('network-error', e.message);
}

async function call(ctx, path, { method = 'GET', body } = {}) {
  const token = ctx?.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'Sign in first (call login).');
  try {
    return await communityRequest({ token, signupBase: SIGNUP_BASE, path, method, body, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (e) {
    throw communityOpError(e);
  }
}

const needId = (v, what = 'id') => {
  const s = String(v ?? '').trim();
  if (!isId(s)) throw new OperationError('bad-request', `${what} must be a Community id from list_community or read_community_entry.`);
  return s;
};
const entryUrl = (id) => `${SITE_BASE}/community/entry/?id=${q(id)}`;

/** A list row an agent can read at a glance. */
function row(e) {
  return {
    id: e.id, kind: e.kind, title: e.title, status: e.status, locked: !!e.locked,
    meeting: e.meeting?.label ? { label: e.meeting.label, date: e.meeting.date || null, key: e.meeting.key } : null,
    access: e.access?.mode === 'chosen' ? { mode: 'chosen', count: e.access.count ?? 0 } : { mode: 'all' },
    answers: e.counts?.answers ?? 0, posts: e.counts?.posts ?? 0,
    leading: e.lead ? { answer: e.lead.label, count: e.lead.count, total: e.lead.total } : null,
    lastPost: e.lastPost ? { by: e.lastPost.login, at: iso(e.lastPost.at) } : null,
    url: entryUrl(e.id),
  };
}

function post(p) {
  return {
    id: p.id, parentId: p.parentId || null, by: p.author?.login ?? null, at: iso(p.at), edited: !!p.editedAt,
    body: p.body, images: (p.images || []).map((i) => ({ id: i.id, name: i.name })),
    pinned: !!p.pinned, hidden: !!p.hidden, removed: !!p.deleted, yours: !!p.own,
    reactions: (p.reactions || []).map((r) => ({ reaction: r.name, count: r.count, yours: !!r.mine, by: r.who })),
    ...(p.replies ? { replies: p.replies.map(post) } : {}),
  };
}

// ---- members -------------------------------------------------------------------------------------------------

export async function listCommunityOp(ctx, { kind = '', meeting = '' } = {}) {
  if (kind && !['poll', 'topic'].includes(kind)) throw new OperationError('bad-request', 'kind is "poll" (both poll kinds), "topic", or empty for everything.');
  const r = await call(ctx, `${R}/entries?kind=${q(kind)}&meeting=${q(meeting)}`);
  return { entries: (r.entries || []).map(row), meetings: (r.meetings || []).map((m) => ({ key: m.key, label: m.label, date: m.date || null })) };
}

export async function readCommunityEntryOp(ctx, { id } = {}) {
  const r = await call(ctx, `${R}/entry?id=${q(needId(id))}`);
  const e = r.entry || {};
  return {
    ...row(e),
    prompt: e.prompt || '', options: e.options || [], settings: e.settings || {},
    promptImages: (e.promptImages || []).map((i) => ({ id: i.id, name: i.name })),
    sharedWith: e.access?.mode === 'chosen' ? (e.access.members || []).map((m) => m.login) : 'all members',
    yourAnswer: r.mine ?? null,
    results: r.results ?? null,
    discussion: { locked: !!r.discussion?.locked, count: r.discussion?.count ?? 0, posts: (r.discussion?.posts || []).map(post) },
    youAreHost: r.viewer?.superadmin === true,
  };
}

export async function answerCommunityPollOp(ctx, { id, choice, text } = {}) {
  const hasChoice = choice !== undefined && choice !== null && choice !== '';
  if (hasChoice === (text !== undefined && text !== null && text !== '')) throw new OperationError('bad-request', 'Pass choice (the 0-based index of an answer) for a poll with choices, or text for a typed poll.');
  const body = { id: needId(id), ...(hasChoice ? { choice: Number(choice) } : { text: String(text) }) };
  const r = await call(ctx, `${R}/answer`, { method: 'POST', body });
  return { saved: true, yourAnswer: r.mine ?? null };
}

/** Upload each { name, dataBase64 } to the member's own staging area for this entry. Returns the image ids. */
async function uploadImages(ctx, id, images, max) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw new OperationError('bad-request', 'images is a list of { name, dataBase64 }.');
  if (images.length > max) throw new OperationError('bad-request', `Up to ${max} images.`);
  const ids = [];
  for (const [i, img] of images.entries()) {
    const name = String(img?.name ?? '').trim();
    const dataBase64 = String(img?.dataBase64 ?? '');
    if (!name || !dataBase64) throw new OperationError('bad-request', `images[${i}] needs a name and dataBase64.`);
    const r = await call(ctx, `${R}/image`, { method: 'POST', body: { id, name, dataBase64 } });
    ids.push(r.id);
  }
  return ids;
}

export async function postCommunityOp(ctx, { id, body = '', images, parentId } = {}) {
  const entry = needId(id);
  const parent = parentId ? needId(parentId, 'parentId') : null;
  if (!String(body).trim() && !(Array.isArray(images) && images.length)) throw new OperationError('bad-request', 'Write a body, or attach an image.');
  const ids = await uploadImages(ctx, entry, images, LIMITS.postImages);
  try {
    const r = await call(ctx, `${R}/post`, { method: 'POST', body: { id: entry, body: String(body), images: ids, parentId: parent } });
    return { posted: true, postId: r.id, url: entryUrl(entry) };
  } catch (e) {
    for (const img of ids) await call(ctx, `${R}/image-drop`, { method: 'POST', body: { id: entry, img } }).catch(() => {});
    throw e;
  }
}

export async function reactCommunityPostOp(ctx, { id, postId, reaction } = {}) {
  if (!REACTION_NAMES.includes(reaction)) throw new OperationError('bad-request', `reaction is one of ${REACTION_NAMES.join(', ')}.`);
  const r = await call(ctx, `${R}/react`, { method: 'POST', body: { id: needId(id), postId: needId(postId, 'postId'), name: reaction } });
  return { reaction, on: r.on ?? r.added ?? null };
}

export async function editCommunityPostOp(ctx, { id, postId, body } = {}) {
  if (typeof body !== 'string') throw new OperationError('bad-request', 'body is the new text of your post.');
  await call(ctx, `${R}/post-edit`, { method: 'POST', body: { id: needId(id), postId: needId(postId, 'postId'), body } });
  return { edited: true };
}

export async function deleteCommunityPostOp(ctx, { id, postId } = {}) {
  await call(ctx, `${R}/post-delete`, { method: 'POST', body: { id: needId(id), postId: needId(postId, 'postId') } });
  return { deleted: true };
}

// ---- superadmins -----------------------------------------------------------------------------------------------

/** Turn GBTI names or GitHub ids into { members: [ids], logins: { id: name } }, refusing a name nobody has. */
async function resolveMembers(ctx, list) {
  if (!Array.isArray(list) || !list.length) throw new OperationError('bad-request', 'Chosen access needs members: a list of GBTI names or GitHub ids.');
  const r = await call(ctx, `${A}/members`);
  const all = r.members || [];
  const byName = new Map(all.map((m) => [String(m.username).toLowerCase(), m]));
  const byId = new Map(all.map((m) => [String(m.githubId), m]));
  const members = [];
  const logins = {};
  for (const raw of list) {
    const s = String(raw ?? '').trim().replace(/^@/, '');
    const m = /^\d+$/.test(s) ? (byId.get(s) || { githubId: s, username: '' }) : byName.get(s.toLowerCase());
    if (!m) throw new OperationError('bad-request', `No member named ${s}. Use their GBTI name or GitHub id.`);
    if (!members.includes(m.githubId)) { members.push(m.githubId); logins[m.githubId] = m.username; }
  }
  return { members, logins };
}

async function accessArg(ctx, access) {
  if (access == null) return { mode: 'all', members: [] };
  const mode = access.mode || 'all';
  if (mode === 'all') return { mode: 'all', members: [] };
  if (mode !== 'chosen') throw new OperationError('bad-request', 'access.mode is "all" or "chosen".');
  return { mode: 'chosen', ...(await resolveMembers(ctx, access.members)) };
}

const admin = (ctx, body) => call(ctx, A, { method: 'POST', body });

export async function createCommunityEntryOp(ctx, args = {}) {
  if (!KINDS.includes(args.kind)) throw new OperationError('bad-request', `kind is one of ${KINDS.join(', ')}.`);
  const input = {
    kind: args.kind, title: args.title, prompt: args.prompt || '', options: args.options || [], settings: args.settings || {},
    meeting: args.meeting || { label: '', date: '' }, access: await accessArg(ctx, args.access),
  };
  const images = Array.isArray(args.images) && args.images.length ? args.images : null;
  if (images && args.kind !== 'topic') throw new OperationError('bad-request', 'Only a topic carries images with its prompt.');
  const r = await admin(ctx, { op: 'create', input, open: args.open === true && !images });
  if (images) {
    const promptImages = await uploadImages(ctx, r.id, images, LIMITS.promptImages);
    await admin(ctx, { op: 'edit', id: r.id, input: { ...input, promptImages } });
    if (args.open === true) await admin(ctx, { op: 'open', id: r.id });
  }
  return { id: r.id, status: args.open === true ? 'live' : 'draft', url: entryUrl(r.id) };
}

export async function manageCommunityEntryOp(ctx, { id, action, input } = {}) {
  const entry = needId(id);
  if (action === 'edit') {
    if (!input || typeof input !== 'object') throw new OperationError('bad-request', 'edit needs input: the whole entry as create_community_entry takes it (title, prompt, options, settings, meeting, access).');
    const body = { ...input, access: input.access ? await accessArg(ctx, input.access) : undefined };
    await admin(ctx, { op: 'edit', id: entry, input: body });
    return { id: entry, edited: true };
  }
  if (!STATUS_ACTIONS.includes(action)) throw new OperationError('bad-request', `action is edit or one of ${STATUS_ACTIONS.join(', ')}.`);
  const r = await admin(ctx, { op: action, id: entry });
  return { id: entry, ...(action === 'delete' ? { deleted: true } : { status: r.status ?? null }) };
}

export async function setCommunityAccessOp(ctx, { id, mode, members } = {}) {
  const access = await accessArg(ctx, { mode, members });
  const r = await admin(ctx, { op: 'access', id: needId(id), access });
  return { id: r.id ?? id, access: access.mode, members: access.mode === 'chosen' ? Object.values(access.logins || {}) : 'all members' };
}

export async function moderateCommunityPostOp(ctx, { id, postId, action, imageId } = {}) {
  if (!MODERATE_ACTIONS.includes(action)) throw new OperationError('bad-request', `action is one of ${MODERATE_ACTIONS.join(', ')}.`);
  if (action === 'remove-image') needId(imageId, 'imageId');
  await admin(ctx, { op: 'moderate', id: needId(id), postId: needId(postId, 'postId'), action, ...(imageId ? { imageId: String(imageId) } : {}) });
  return { done: action };
}

export async function tidyCommunityAnswersOp(ctx, { id, action, answer, label, into } = {}) {
  if (!TIDY_ACTIONS.includes(action)) throw new OperationError('bad-request', `action is one of ${TIDY_ACTIONS.join(', ')}.`);
  if (!String(answer ?? '').trim()) throw new OperationError('bad-request', 'answer is the typed answer (any spelling in its group) to change.');
  const r = await admin(ctx, { op: 'tidy', id: needId(id), action, norm: String(answer), label, into });
  return { results: r.groups ? { total: r.total, groups: r.groups.map((g) => ({ label: g.label, count: g.count, spellings: g.spellings })), hidden: r.hidden || [] } : null };
}
