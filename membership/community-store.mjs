// sow-494: the Community store. ALL of Community's rules live here, over an injected SQL adapter, so the one Durable
// Object that holds the data (workers/signup/community-do.mjs) and the tests (Node's built-in node:sqlite) run the
// same code against a real SQLite engine.
//
// WHY ONE DURABLE OBJECT AND NOT KV (owner, 2026-11-07). A KV write can take about a minute to appear at other
// locations, and twenty members answering a poll at once would overwrite each other's read-modify-write. A Durable
// Object is single-writer and strongly consistent: every answer is counted and a post is visible to everyone at once.
// The load is tens of members, so one object holds every entry, answer, post, reaction and image.
//
// ACCESS IS CHECKED HERE, ON EVERY READ, AND FAILS CLOSED. A superadmin sees everything. A draft is superadmin-only.
// A member sees an entry only when it is shared with all members or they were chosen by name. Anything a viewer may
// not see throws not_found, IDENTICAL to an entry that does not exist, so a private entry's existence never leaks.
//
// The adapter is `{ exec(query, ...bindings) -> row objects[] }`. Bindings are strings, numbers, null or Uint8Array;
// BLOB columns come back as Uint8Array or ArrayBuffer and are normalised here. Requests to a Durable Object never
// interleave inside synchronous SQL, so a multi-statement operation here is atomic without an explicit transaction.

import {
  KINDS, isPollKind, LIMITS, REACTION_EMOJI, isReaction, isId, isGithubId, newId,
  validateEntryInput, validateAnswer, validatePostInput, normalizeTyped, cleanLine,
} from './community-shared.mjs';

export class CommunityError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const notFound = () => new CommunityError(404, 'not_found', 'That entry was not found.');
const bad = (message) => new CommunityError(400, 'bad_request', message);
const conflict = (message) => new CommunityError(409, 'conflict', message);
const forbidden = (message) => new CommunityError(403, 'forbidden', message);

const SCHEMA_VERSION = 1;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS entries (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '',
     options TEXT NOT NULL DEFAULT '[]', settings TEXT NOT NULL DEFAULT '{}',
     meeting_label TEXT NOT NULL DEFAULT '', meeting_date TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, access_mode TEXT NOT NULL DEFAULT 'all',
     created_by TEXT NOT NULL, created_login TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL, opened_at INTEGER, closed_at INTEGER, published_at INTEGER,
     activity_at INTEGER NOT NULL, last_post_at INTEGER, last_post_by TEXT, last_post_login TEXT,
     version INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS entry_members (entry_id TEXT NOT NULL, github_id TEXT NOT NULL, login TEXT NOT NULL DEFAULT '',
     PRIMARY KEY (entry_id, github_id))`,
  `CREATE TABLE IF NOT EXISTS answers (entry_id TEXT NOT NULL, github_id TEXT NOT NULL, value TEXT NOT NULL, norm TEXT NOT NULL,
     at INTEGER NOT NULL, PRIMARY KEY (entry_id, github_id))`,
  `CREATE TABLE IF NOT EXISTS answer_groups (entry_id TEXT NOT NULL, norm TEXT NOT NULL, label TEXT, hidden INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (entry_id, norm))`,
  `CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, parent_id TEXT, github_id TEXT NOT NULL,
     login TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, edited_at INTEGER,
     hidden INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS posts_entry ON posts (entry_id, at)`,
  `CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, post_id TEXT, prompt INTEGER NOT NULL DEFAULT 0,
     owner TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL,
     at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS images_entry ON images (entry_id, post_id)`,
  `CREATE TABLE IF NOT EXISTS reactions (post_id TEXT NOT NULL, entry_id TEXT NOT NULL, github_id TEXT NOT NULL,
     login TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (post_id, github_id, name))`,
];

const asBytes = (v) => (v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(0));
const parseJson = (s, fallback) => { try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; } };
const bool = (v) => v === 1 || v === true;
/** A meeting is its label and its date together (`Shop Talk|2026-11-07`), or its label alone when it has no date. */
export const meetingKey = (row) => (row.meeting_label ? (row.meeting_date ? `${row.meeting_label}|${row.meeting_date}` : row.meeting_label) : '');

/** A viewer is `{ githubId, login, superadmin }`, built by the Worker from a verified identity. Never from input. */
function checkViewer(viewer) {
  if (!viewer || !isGithubId(String(viewer.githubId ?? ''))) throw new CommunityError(401, 'not-authenticated', 'Sign in to continue.');
  return { githubId: String(viewer.githubId), login: String(viewer.login || ''), superadmin: viewer.superadmin === true };
}
function requireSuperadmin(viewer) {
  const v = checkViewer(viewer);
  if (!v.superadmin) throw forbidden('Only a superadmin can do that.');
  return v;
}

export class CommunityStore {
  /** @param sql `{ exec(q, ...b) -> rows[] }`. `now` is ms. `randomBytes(n)` feeds the id generator. */
  constructor(sql, { now = () => Date.now(), randomBytes } = {}) {
    this.sql = sql;
    this.now = now;
    this.randomBytes = randomBytes;
    this.ready = false;
  }

  q(query, ...bindings) { return this.sql.exec(query, ...bindings); }
  one(query, ...bindings) { return this.q(query, ...bindings)[0] || null; }

  migrate() {
    if (this.ready) return;
    for (const stmt of SCHEMA) this.q(stmt);
    const row = this.one('SELECT v FROM meta WHERE k = ?', 'schema');
    if (!row) this.q('INSERT INTO meta (k, v) VALUES (?, ?)', 'schema', String(SCHEMA_VERSION));
    this.ready = true;
  }

  id() { return newId(this.randomBytes); }

  // ---- visibility ----------------------------------------------------------------------------------------------

  entryRow(id) {
    if (!isId(id)) return null;
    return this.one('SELECT * FROM entries WHERE id = ?', id);
  }

  canSee(v, row) {
    if (!row) return false;
    if (v.superadmin) return true;
    if (row.status === 'draft') return false;
    if (row.access_mode === 'all') return true;
    return !!this.one('SELECT 1 AS x FROM entry_members WHERE entry_id = ? AND github_id = ?', row.id, v.githubId);
  }

  /** The entry row a viewer may see, or not_found. Every read and write goes through this. */
  visible(viewer, id) {
    const v = checkViewer(viewer);
    this.migrate();
    const row = this.entryRow(id);
    if (!this.canSee(v, row)) throw notFound();
    return { v, row };
  }

  bump(id, { activity = true } = {}) {
    const t = this.now();
    this.q(`UPDATE entries SET version = version + 1, updated_at = ?${activity ? ', activity_at = ?' : ''} WHERE id = ?`,
      ...(activity ? [t, t, id] : [t, id]));
  }

  // ---- reading -------------------------------------------------------------------------------------------------

  summary(row, v) {
    const answers = isPollKind(row.kind) ? this.one('SELECT COUNT(*) AS n FROM answers WHERE entry_id = ?', row.id).n : 0;
    const posts = this.one('SELECT COUNT(*) AS n FROM posts WHERE entry_id = ? AND deleted = 0' + (v.superadmin ? '' : ' AND hidden = 0'), row.id).n;
    const withImages = this.one(`SELECT COUNT(DISTINCT post_id) AS n FROM images WHERE entry_id = ? AND post_id IS NOT NULL`, row.id).n;
    const options = parseJson(row.options, []);
    let lead = null;
    if (row.status === 'published' || (v.superadmin && isPollKind(row.kind))) {
      const r = this.results(row, true);
      if (r && r.groups.length) lead = { label: r.groups[0].label, count: r.groups[0].count, total: r.total };
    }
    return {
      id: row.id, kind: row.kind, title: row.title, status: row.status, locked: bool(row.locked),
      meeting: { label: row.meeting_label, date: row.meeting_date, key: meetingKey(row) },
      author: { githubId: row.created_by, login: row.created_login },
      access: { mode: row.access_mode, count: row.access_mode === 'all' ? null : this.one('SELECT COUNT(*) AS n FROM entry_members WHERE entry_id = ?', row.id).n },
      counts: { answers, posts, withImages, options: options.length },
      lead: row.status === 'published' || v.superadmin ? lead : null,
      lastPost: row.last_post_at ? { at: row.last_post_at, login: row.last_post_login } : null,
      createdAt: row.created_at, activityAt: row.activity_at, version: row.version,
    };
  }

  /** The entries this viewer may see. Live first, then the most recent activity. Never lists what it hides. */
  listEntries(viewer, { kind = '', meeting = '' } = {}) {
    const v = checkViewer(viewer);
    this.migrate();
    const rows = this.q('SELECT * FROM entries ORDER BY activity_at DESC');
    const out = [];
    for (const row of rows) {
      if (!this.canSee(v, row)) continue;
      if (kind === 'poll' && !isPollKind(row.kind)) continue;
      if (kind === 'topic' && row.kind !== 'topic') continue;
      if (meeting && (meeting === '-' ? row.meeting_label !== '' : meetingKey(row) !== meeting)) continue;
      out.push(this.summary(row, v));
    }
    out.sort((a, b) => (b.status === 'live') - (a.status === 'live') || b.activityAt - a.activityAt);
    // One filter option per meeting the viewer has an entry in: a label and a date together, newest first, so each
    // week's Shop Talk is its own meeting rather than one "Shop Talk" holding them all.
    const seen = new Map();
    for (const r of rows) {
      const key = meetingKey(r);
      if (key && !seen.has(key) && this.canSee(v, r)) seen.set(key, { key, label: r.meeting_label, date: r.meeting_date });
    }
    const meetings = [...seen.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.label.localeCompare(b.label));
    return { entries: out, meetings };
  }

  /**
   * Results for a poll. `full` is the superadmin view (it also carries the typed spellings and hidden answers for
   * tidying). Members only ever receive results once the poll is published.
   */
  results(row, full = false) {
    if (!isPollKind(row.kind)) return null;
    const answers = this.q('SELECT value, norm FROM answers WHERE entry_id = ? ORDER BY at, github_id', row.id);
    if (row.kind === 'poll') {
      const options = parseJson(row.options, []);
      const counts = options.map(() => 0);
      for (const a of answers) { const i = Number(a.value); if (Number.isInteger(i) && i >= 0 && i < counts.length) counts[i]++; }
      const groups = options.map((label, i) => ({ key: String(i), label, count: counts[i] }));
      const ordered = [...groups].sort((a, b) => b.count - a.count);
      return { total: answers.length, groups: ordered, byOption: groups };
    }
    const tidy = new Map(this.q('SELECT norm, label, hidden FROM answer_groups WHERE entry_id = ?', row.id).map((g) => [g.norm, g]));
    const countMatching = parseJson(row.settings, {}).countMatching !== false;
    const groups = new Map();
    const every = [];
    const hiddenAnswers = [];
    for (const a of answers) {
      const t = tidy.get(a.norm);
      if (t && bool(t.hidden)) { hiddenAnswers.push(a.value); continue; }
      every.push(a.value);
      const label = (t && t.label) || null;
      const key = countMatching ? (label ? `label:${label.toLowerCase()}` : `norm:${a.norm}`) : `raw:${a.value}`;
      const g = groups.get(key) || { key, label, count: 0, spellings: new Map(), norms: new Set() };
      g.count++;
      g.norms.add(a.norm);
      g.spellings.set(a.value, (g.spellings.get(a.value) || 0) + 1);
      groups.set(key, g);
    }
    const list = [...groups.values()].map((g) => {
      const top = [...g.spellings.entries()].sort((x, y) => y[1] - x[1])[0]; // ties keep the first spelling typed
      return { key: g.key, label: g.label || (top ? top[0] : ''), count: g.count, norms: [...g.norms], spellings: [...g.spellings.keys()] };
    }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const out = { total: every.length, groups: full ? list : list.map(({ key, label, count }) => ({ key, label, count })), every: every.sort((a, b) => a.localeCompare(b)) };
    if (full) out.hidden = hiddenAnswers.sort((a, b) => a.localeCompare(b));
    return out;
  }

  /** One entry as this viewer may see it: the entry, their own answer, results when allowed, and the discussion. */
  getEntry(viewer, id) {
    const { v, row } = this.visible(viewer, id);
    const mine = isPollKind(row.kind) ? this.one('SELECT value, norm FROM answers WHERE entry_id = ? AND github_id = ?', row.id, v.githubId) : null;
    const members = row.access_mode === 'chosen'
      ? this.q('SELECT github_id, login FROM entry_members WHERE entry_id = ? ORDER BY login', row.id).map((m) => ({ githubId: m.github_id, login: m.login }))
      : [];
    const showResults = row.status === 'published' || v.superadmin;
    const results = showResults ? this.results(row, v.superadmin) : null;
    // Mark the group holding the viewer's own answer ("Includes yours"). For a typed poll the member's view carries no
    // spellings, so the group is found on the full results and marked by its key; nothing about anyone else changes.
    if (results && mine) {
      const hit = row.kind === 'poll' ? mine.value : (this.results(row, true).groups.find((g) => g.norms.includes(mine.norm)) || {}).key;
      for (const g of results.groups) g.mine = g.key === hit;
    }
    return {
      entry: {
        ...this.summary(row, v),
        prompt: row.prompt, options: parseJson(row.options, []), settings: parseJson(row.settings, {}),
        promptImages: this.q('SELECT id, name FROM images WHERE entry_id = ? AND prompt = 1 ORDER BY at', row.id),
        openedAt: row.opened_at, closedAt: row.closed_at, publishedAt: row.published_at,
        access: { mode: row.access_mode, count: row.access_mode === 'all' ? null : members.length, members },
      },
      mine: mine ? (row.kind === 'poll' ? { choice: Number(mine.value) } : { text: mine.value }) : null,
      results,
      discussion: this.discussion(row, v),
      viewer: { githubId: v.githubId, superadmin: v.superadmin },
      version: row.version,
    };
  }

  /** The version only, for the live poll. Visibility is still checked. */
  version(viewer, id) {
    const { row } = this.visible(viewer, id);
    return { version: row.version, status: row.status };
  }

  discussion(row, v) {
    const posts = this.q('SELECT * FROM posts WHERE entry_id = ? ORDER BY at, id', row.id);
    const imgs = this.q('SELECT id, post_id, name FROM images WHERE entry_id = ? AND post_id IS NOT NULL ORDER BY at', row.id);
    const reacts = this.q('SELECT post_id, github_id, login, name FROM reactions WHERE entry_id = ? ORDER BY at', row.id);
    const byPost = (list, key) => list.reduce((m, x) => { (m[x[key]] ||= []).push(x); return m; }, {});
    const imgBy = byPost(imgs, 'post_id');
    const reactBy = byPost(reacts, 'post_id');
    const shape = (p) => {
      const own = p.github_id === v.githubId;
      const hiddenFromViewer = bool(p.hidden) && !v.superadmin && !own;
      const reactions = Object.entries((reactBy[p.id] || []).reduce((m, r) => { (m[r.name] ||= []).push(r); return m; }, {}))
        .map(([name, rs]) => ({ name, emoji: REACTION_EMOJI[name] || '', count: rs.length, mine: rs.some((r) => r.github_id === v.githubId), who: rs.map((r) => r.login).filter(Boolean) }));
      return {
        id: p.id, parentId: p.parent_id || null,
        author: bool(p.deleted) ? null : { githubId: p.github_id, login: p.login },
        body: bool(p.deleted) || hiddenFromViewer ? '' : p.body,
        images: bool(p.deleted) || hiddenFromViewer ? [] : (imgBy[p.id] || []).map((i) => ({ id: i.id, name: i.name })),
        at: p.at, editedAt: p.edited_at || null,
        hidden: bool(p.hidden), pinned: bool(p.pinned), deleted: bool(p.deleted), own,
        reactions: bool(p.deleted) || hiddenFromViewer ? [] : reactions,
      };
    };
    const top = posts.filter((p) => !p.parent_id).map(shape);
    const replies = posts.filter((p) => p.parent_id).map(shape);
    for (const t of top) t.replies = replies.filter((r) => r.parentId === t.id);
    top.sort((a, b) => b.pinned - a.pinned || a.at - b.at);
    const visibleTop = top.filter((t) => !(t.deleted && t.replies.length === 0));
    return { locked: bool(row.locked), count: posts.filter((p) => !bool(p.deleted) && (v.superadmin || !bool(p.hidden))).length, posts: visibleTop };
  }

  // ---- superadmin: entries -------------------------------------------------------------------------------------

  createEntry(viewer, input, { open = false } = {}) {
    const v = requireSuperadmin(viewer);
    this.migrate();
    const r = validateEntryInput(input);
    if (!r.ok) throw bad(r.problem);
    const e = r.value;
    const id = this.id();
    const t = this.now();
    this.q(`INSERT INTO entries (id, kind, title, prompt, options, settings, meeting_label, meeting_date, status, locked, access_mode,
              created_by, created_login, created_at, updated_at, opened_at, activity_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 1)`,
      id, e.kind, e.title, e.prompt, JSON.stringify(e.options), JSON.stringify(e.settings), e.meeting.label, e.meeting.date,
      open ? 'live' : 'draft', e.access.mode, v.githubId, v.login, t, t, open ? t : null, t);
    this.writeMembers(id, e.access, input.access?.logins);
    this.attachPromptImages(v, id, input.promptImages);
    return { id };
  }

  writeMembers(id, access, logins) {
    this.q('DELETE FROM entry_members WHERE entry_id = ?', id);
    if (access.mode !== 'chosen') return;
    const names = logins && typeof logins === 'object' ? logins : {};
    for (const gid of access.members) this.q('INSERT INTO entry_members (entry_id, github_id, login) VALUES (?, ?, ?)', id, gid, cleanLine(names[gid]).slice(0, 60));
  }

  attachPromptImages(v, id, ids) {
    if (!Array.isArray(ids)) return;
    const list = [...new Set(ids.map(String))].filter(isId).slice(0, LIMITS.promptImages);
    // An image already on the prompt stays when it is listed again, whoever uploaded it (two superadmins share a
    // prompt). A new one must be the caller's own unposted upload to this entry.
    const current = new Set(this.q('SELECT id FROM images WHERE entry_id = ? AND prompt = 1', id).map((r) => r.id));
    this.q('UPDATE images SET prompt = 0 WHERE entry_id = ? AND prompt = 1', id);
    for (const img of list) {
      if (current.has(img)) this.q('UPDATE images SET prompt = 1 WHERE id = ? AND entry_id = ?', img, id);
      else this.q('UPDATE images SET prompt = 1 WHERE id = ? AND entry_id = ? AND owner = ? AND post_id IS NULL', img, id, v.githubId);
    }
  }

  editEntry(viewer, id, input) {
    requireSuperadmin(viewer);
    const { v, row } = this.visible(viewer, id);
    // A field the edit leaves out keeps its current value. Without this, an edit that only fixed a typo in the title
    // reset access to the default, all members, and opened a private entry to everyone.
    const current = {
      title: row.title, prompt: row.prompt, options: parseJson(row.options, []), settings: parseJson(row.settings, {}),
      meeting: { label: row.meeting_label, date: row.meeting_date },
      access: { mode: row.access_mode, members: this.q('SELECT github_id FROM entry_members WHERE entry_id = ?', id).map((m) => m.github_id) },
    };
    const given = Object.fromEntries(Object.entries(input || {}).filter(([, val]) => val !== undefined));
    if (!given.access) input = { ...input, access: { ...current.access, logins: Object.fromEntries(this.q('SELECT github_id, login FROM entry_members WHERE entry_id = ?', id).map((m) => [m.github_id, m.login])) } };
    const r = validateEntryInput({ ...current, ...given, access: given.access ?? input.access, kind: row.kind });
    if (!r.ok) throw bad(r.problem);
    const e = r.value;
    const answered = isPollKind(row.kind) && this.one('SELECT COUNT(*) AS n FROM answers WHERE entry_id = ?', id).n > 0;
    if (answered && (e.title !== row.title || JSON.stringify(e.options) !== row.options)) {
      throw conflict('Members have already answered, so the question and answers are locked.');
    }
    this.q(`UPDATE entries SET title = ?, prompt = ?, options = ?, settings = ?, meeting_label = ?, meeting_date = ?, access_mode = ? WHERE id = ?`,
      e.title, e.prompt, JSON.stringify(e.options), JSON.stringify(e.settings), e.meeting.label, e.meeting.date, e.access.mode, id);
    this.writeMembers(id, e.access, input.access?.logins);
    if (Array.isArray(input.promptImages)) this.attachPromptImages(v, id, input.promptImages);
    this.bump(id, { activity: false });
    return { id };
  }

  setAccess(viewer, id, access) {
    requireSuperadmin(viewer);
    const { row } = this.visible(viewer, id);
    const r = validateEntryInput({ kind: row.kind, title: row.title, options: parseJson(row.options, []), access: { mode: access?.mode, members: access?.members } });
    if (!r.ok) throw bad(r.problem);
    this.q('UPDATE entries SET access_mode = ? WHERE id = ?', r.value.access.mode, id);
    this.writeMembers(id, r.value.access, access?.logins);
    this.bump(id, { activity: false });
    return { id, access: r.value.access.mode };
  }

  /** open, close, publish, unpublish, lock, unlock, delete. */
  setStatus(viewer, id, op) {
    requireSuperadmin(viewer);
    const { row } = this.visible(viewer, id);
    const t = this.now();
    const poll = isPollKind(row.kind);
    switch (op) {
      case 'open':
        if (row.status === 'live') return { id, status: 'live' };
        if (row.status === 'published') throw conflict('Unpublish the results before opening the poll again.');
        this.q('UPDATE entries SET status = ?, opened_at = COALESCE(opened_at, ?), locked = CASE WHEN kind = ? THEN 0 ELSE locked END WHERE id = ?', 'live', t, 'topic', id);
        break;
      case 'close':
        if (row.status === 'draft') throw conflict('Open the entry before closing it.');
        if (poll && parseJson(row.settings, {}).publishOnClose) {
          this.q('UPDATE entries SET status = ?, closed_at = ?, published_at = ? WHERE id = ?', 'published', t, t, id);
        } else {
          this.q(`UPDATE entries SET status = ?, closed_at = ?${poll ? '' : ', locked = 1'} WHERE id = ?`, 'closed', t, id);
        }
        break;
      case 'publish':
        if (!poll) throw bad('Only a poll has results to publish.');
        if (row.status === 'draft' || row.status === 'live') throw conflict('Close voting before publishing the results.');
        this.q('UPDATE entries SET status = ?, published_at = ? WHERE id = ?', 'published', t, id);
        break;
      case 'unpublish':
        if (row.status !== 'published') throw conflict('The results are not published.');
        this.q('UPDATE entries SET status = ?, published_at = NULL WHERE id = ?', 'closed', id);
        break;
      case 'lock': this.q('UPDATE entries SET locked = 1 WHERE id = ?', id); break;
      case 'unlock': this.q('UPDATE entries SET locked = 0 WHERE id = ?', id); break;
      case 'delete':
        for (const table of ['answers', 'answer_groups', 'entry_members', 'reactions', 'images', 'posts']) this.q(`DELETE FROM ${table} WHERE entry_id = ?`, id);
        this.q('DELETE FROM entries WHERE id = ?', id);
        return { id, deleted: true };
      default: throw bad('Unknown action.');
    }
    this.bump(id);
    return { id, status: this.entryRow(id).status };
  }

  /** Typed-poll tidying: rename a group, merge one answer into another group, hide or unhide an answer. */
  tidy(viewer, id, { action, norm, label, into } = {}) {
    requireSuperadmin(viewer);
    const { row } = this.visible(viewer, id);
    if (row.kind !== 'typed') throw bad('Only a typed poll has answers to tidy.');
    const n = normalizeTyped(norm);
    if (!n) throw bad('Name the answer to change.');
    const upsert = (fields) => {
      const cur = this.one('SELECT label, hidden FROM answer_groups WHERE entry_id = ? AND norm = ?', id, n);
      const next = { label: cur?.label ?? null, hidden: cur?.hidden ?? 0, ...fields };
      this.q('INSERT INTO answer_groups (entry_id, norm, label, hidden) VALUES (?, ?, ?, ?) ON CONFLICT (entry_id, norm) DO UPDATE SET label = excluded.label, hidden = excluded.hidden',
        id, n, next.label, next.hidden);
    };
    if (action === 'rename') {
      const l = cleanLine(label).slice(0, LIMITS.groupLabel);
      if (!l) throw bad('Give the group a name.');
      const group = (this.results(row, true).groups || []).find((g) => g.norms.includes(n));
      for (const member of group ? group.norms : [n]) {
        this.q('INSERT INTO answer_groups (entry_id, norm, label, hidden) VALUES (?, ?, ?, 0) ON CONFLICT (entry_id, norm) DO UPDATE SET label = excluded.label', id, member, l);
      }
    } else if (action === 'merge') {
      const target = (this.results(row, true).groups || []).find((g) => g.norms.includes(normalizeTyped(into)) || g.label.toLowerCase() === cleanLine(into).toLowerCase());
      if (!target) throw bad('Choose the group to merge into.');
      upsert({ label: target.label });
      for (const member of target.norms) {
        this.q('INSERT INTO answer_groups (entry_id, norm, label, hidden) VALUES (?, ?, ?, 0) ON CONFLICT (entry_id, norm) DO UPDATE SET label = excluded.label', id, member, target.label);
      }
    } else if (action === 'hide') upsert({ hidden: 1 });
    else if (action === 'unhide') upsert({ hidden: 0 });
    else throw bad('Unknown action.');
    this.bump(id, { activity: false });
    return this.results(this.entryRow(id), true);
  }

  // ---- members: answers ----------------------------------------------------------------------------------------

  answer(viewer, id, input) {
    const { v, row } = this.visible(viewer, id);
    if (!isPollKind(row.kind)) throw bad('Only a poll takes an answer.');
    if (row.status !== 'live') throw conflict(row.status === 'draft' ? 'This poll has not opened yet.' : 'Voting has closed.');
    const entry = { kind: row.kind, options: parseJson(row.options, []), settings: parseJson(row.settings, {}) };
    const r = validateAnswer(entry, input);
    if (!r.ok) throw bad(r.problem);
    const prev = this.one('SELECT value FROM answers WHERE entry_id = ? AND github_id = ?', id, v.githubId);
    if (prev && entry.settings.changeable === false && prev.value !== r.value.value) throw conflict('Answers on this poll cannot be changed.');
    this.q('INSERT INTO answers (entry_id, github_id, value, norm, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (entry_id, github_id) DO UPDATE SET value = excluded.value, norm = excluded.norm, at = excluded.at',
      id, v.githubId, r.value.value, r.value.norm, this.now());
    this.bump(id);
    return { saved: true, mine: row.kind === 'poll' ? { choice: Number(r.value.value) } : { text: r.value.value } };
  }

  // ---- members: posts ------------------------------------------------------------------------------------------

  ownedUnattachedImages(v, id, ids) {
    for (const img of ids) {
      const row = this.one('SELECT owner, entry_id, post_id, prompt FROM images WHERE id = ?', img);
      if (!row || row.owner !== v.githubId || row.entry_id !== id || row.post_id || bool(row.prompt)) {
        throw bad('An attached image is no longer staged. Remove it and add it again.');
      }
    }
  }

  post(viewer, id, input) {
    const { v, row } = this.visible(viewer, id);
    if (row.status === 'draft') throw conflict('This entry has not opened yet.');
    if (bool(row.locked)) throw conflict('This discussion is closed.');
    const r = validatePostInput(input);
    if (!r.ok) throw bad(r.problem);
    const { body, images, parentId } = r.value;
    if (row.kind === 'topic' && images.length && parseJson(row.settings, {}).imagesAllowed === false) throw bad('Images are turned off on this topic.');
    if (parentId) {
      const parent = this.one('SELECT entry_id, parent_id, deleted FROM posts WHERE id = ?', parentId);
      if (!parent || parent.entry_id !== id || parent.parent_id) throw bad('The post you are replying to was not found.');
    }
    this.ownedUnattachedImages(v, id, images);
    const pid = this.id();
    const t = this.now();
    this.q('INSERT INTO posts (id, entry_id, parent_id, github_id, login, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', pid, id, parentId, v.githubId, v.login, body, t);
    for (const img of images) this.q('UPDATE images SET post_id = ? WHERE id = ?', pid, img);
    this.q('UPDATE entries SET last_post_at = ?, last_post_by = ?, last_post_login = ? WHERE id = ?', t, v.githubId, v.login, id);
    this.bump(id);
    return { id: pid };
  }

  postRow(id, postId) {
    const p = isId(postId) ? this.one('SELECT * FROM posts WHERE id = ? AND entry_id = ?', postId, id) : null;
    if (!p || bool(p.deleted)) throw new CommunityError(404, 'not_found', 'That post was not found.');
    return p;
  }

  editPost(viewer, id, postId, input) {
    const { v, row } = this.visible(viewer, id);
    if (bool(row.locked)) throw conflict('This discussion is closed.');
    const p = this.postRow(id, postId);
    if (p.github_id !== v.githubId) throw forbidden('You can only edit your own posts.');
    const current = this.q('SELECT id FROM images WHERE post_id = ?', postId).map((i) => i.id);
    const r = validatePostInput({ body: input?.body, images: Array.isArray(input?.images) ? input.images : current, parentId: p.parent_id });
    if (!r.ok) throw bad(r.problem);
    const added = r.value.images.filter((i) => !current.includes(i));
    this.ownedUnattachedImages(v, id, added);
    for (const img of current.filter((i) => !r.value.images.includes(i))) this.q('DELETE FROM images WHERE id = ?', img);
    for (const img of added) this.q('UPDATE images SET post_id = ? WHERE id = ?', postId, img);
    this.q('UPDATE posts SET body = ?, edited_at = ? WHERE id = ?', r.value.body, this.now(), postId);
    this.bump(id, { activity: false });
    return { id: postId };
  }

  /** Delete your own post. A post with replies becomes a placeholder so the thread still reads. */
  deletePost(viewer, id, postId) {
    const { v } = this.visible(viewer, id);
    const p = this.postRow(id, postId);
    if (p.github_id !== v.githubId) throw forbidden('You can only delete your own posts.');
    this.removePost(p);
    this.bump(id, { activity: false });
    return { id: postId, deleted: true };
  }

  removePost(p) {
    this.q('DELETE FROM images WHERE post_id = ?', p.id);
    this.q('DELETE FROM reactions WHERE post_id = ?', p.id);
    const replies = p.parent_id ? 0 : this.one('SELECT COUNT(*) AS n FROM posts WHERE parent_id = ? AND deleted = 0', p.id).n;
    if (replies) this.q("UPDATE posts SET deleted = 1, body = '', pinned = 0 WHERE id = ?", p.id);
    else this.q('DELETE FROM posts WHERE id = ?', p.id);
    if (p.parent_id) {
      const parent = this.one('SELECT * FROM posts WHERE id = ?', p.parent_id);
      if (parent && bool(parent.deleted) && !this.one('SELECT 1 AS x FROM posts WHERE parent_id = ? LIMIT 1', parent.id)) this.q('DELETE FROM posts WHERE id = ?', parent.id);
    }
  }

  /** Superadmin moderation: pin, unpin, hide, unhide, remove-image. */
  moderate(viewer, id, postId, action, imageId = null) {
    requireSuperadmin(viewer);
    this.visible(viewer, id);
    const p = this.postRow(id, postId);
    if (action === 'pin') {
      if (p.parent_id) throw bad('Only a top-level post can be pinned.');
      this.q('UPDATE posts SET pinned = 1 WHERE id = ?', postId);
    } else if (action === 'unpin') this.q('UPDATE posts SET pinned = 0 WHERE id = ?', postId);
    else if (action === 'hide') this.q('UPDATE posts SET hidden = 1, pinned = 0 WHERE id = ?', postId);
    else if (action === 'unhide') this.q('UPDATE posts SET hidden = 0 WHERE id = ?', postId);
    else if (action === 'remove-image') {
      if (!isId(imageId) || !this.one('SELECT 1 AS x FROM images WHERE id = ? AND post_id = ?', imageId, postId)) throw bad('That image is not on this post.');
      this.q('DELETE FROM images WHERE id = ?', imageId);
    } else throw bad('Unknown action.');
    this.bump(id, { activity: false });
    return { id: postId, action };
  }

  /** Toggle one of the standard reactions on a post. */
  react(viewer, id, postId, name) {
    const { v, row } = this.visible(viewer, id);
    if (row.status === 'draft') throw conflict('This entry has not opened yet.');
    if (!isReaction(name)) throw bad('Choose one of the standard reactions.');
    const p = this.postRow(id, postId);
    if (bool(p.hidden) && !v.superadmin && p.github_id !== v.githubId) throw new CommunityError(404, 'not_found', 'That post was not found.');
    const had = this.one('SELECT 1 AS x FROM reactions WHERE post_id = ? AND github_id = ? AND name = ?', postId, v.githubId, name);
    if (had) this.q('DELETE FROM reactions WHERE post_id = ? AND github_id = ? AND name = ?', postId, v.githubId, name);
    else this.q('INSERT INTO reactions (post_id, entry_id, github_id, login, name, at) VALUES (?, ?, ?, ?, ?, ?)', postId, id, v.githubId, v.login, name, this.now());
    this.bump(id, { activity: false });
    return { id: postId, name, on: !had };
  }

  // ---- images --------------------------------------------------------------------------------------------------

  /**
   * Store an image a member is about to attach. `upload` is already validated and sniffed
   * (community-shared validateImageUpload). Old unattached uploads are swept first, so the staging area never grows.
   */
  putImage(viewer, id, upload) {
    const { v, row } = this.visible(viewer, id);
    if (row.status === 'draft' && !v.superadmin) throw notFound();
    if (bool(row.locked) && !v.superadmin) throw conflict('This discussion is closed.');
    this.sweepImages();
    const staged = this.one('SELECT COUNT(*) AS n FROM images WHERE owner = ? AND post_id IS NULL AND prompt = 0', v.githubId).n;
    if (staged >= LIMITS.postImages * 3) throw conflict('You have too many images waiting. Post or remove some first.');
    const img = this.id();
    this.q('INSERT INTO images (id, entry_id, post_id, prompt, owner, name, content_type, size, bytes, at) VALUES (?, ?, NULL, 0, ?, ?, ?, ?, ?, ?)',
      img, id, v.githubId, upload.name, upload.contentType, upload.bytes.length, upload.bytes, this.now());
    return { id: img, name: upload.name, size: upload.bytes.length };
  }

  sweepImages() {
    const cutoff = this.now() - LIMITS.unattachedImageHours * 3600_000;
    this.q('DELETE FROM images WHERE post_id IS NULL AND prompt = 0 AND at < ?', cutoff);
  }

  /** Remove an image you uploaded and have not posted yet. */
  dropImage(viewer, id, imageId) {
    const { v } = this.visible(viewer, id);
    if (!isId(imageId)) throw bad('That image was not found.');
    this.q('DELETE FROM images WHERE id = ? AND owner = ? AND post_id IS NULL AND prompt = 0', imageId, v.githubId);
    return { id: imageId, removed: true };
  }

  /**
   * An image's bytes, for a viewer who may see the entry and the post it belongs to. A staged (unposted) image is
   * readable by its owner only; a hidden post's images by its author and superadmins only.
   */
  getImage(viewer, id, imageId) {
    const { v } = this.visible(viewer, id);
    const img = isId(imageId) ? this.one('SELECT * FROM images WHERE id = ? AND entry_id = ?', imageId, id) : null;
    if (!img) throw new CommunityError(404, 'not_found', 'That image was not found.');
    if (!img.post_id && !bool(img.prompt) && img.owner !== v.githubId) throw new CommunityError(404, 'not_found', 'That image was not found.');
    if (img.post_id) {
      const p = this.one('SELECT hidden, deleted, github_id FROM posts WHERE id = ?', img.post_id);
      if (!p || bool(p.deleted) || (bool(p.hidden) && !v.superadmin && p.github_id !== v.githubId)) throw new CommunityError(404, 'not_found', 'That image was not found.');
    }
    return { bytes: asBytes(img.bytes), contentType: img.content_type, name: img.name };
  }

  // ---- erasure -------------------------------------------------------------------------------------------------

  /**
   * Right to erasure. Removes the member's answers, reactions, staged and posted images and access grants, and turns
   * their posts into placeholders (removed outright when nothing replies to them). Published counts change as the
   * answers go, because a count is only ever derived from the answers that exist.
   */
  eraseMember(githubId) {
    this.migrate();
    const gid = String(githubId);
    if (!isGithubId(gid)) throw bad('A GitHub id is required.');
    const touched = new Set(this.q('SELECT DISTINCT entry_id FROM answers WHERE github_id = ?', gid).map((r) => r.entry_id));
    const counts = {
      answers: this.one('SELECT COUNT(*) AS n FROM answers WHERE github_id = ?', gid).n,
      reactions: this.one('SELECT COUNT(*) AS n FROM reactions WHERE github_id = ?', gid).n,
      posts: 0,
      images: this.one('SELECT COUNT(*) AS n FROM images WHERE owner = ?', gid).n,
      grants: this.one('SELECT COUNT(*) AS n FROM entry_members WHERE github_id = ?', gid).n,
    };
    this.q('DELETE FROM answers WHERE github_id = ?', gid);
    for (const r of this.q('SELECT DISTINCT entry_id FROM reactions WHERE github_id = ?', gid)) touched.add(r.entry_id);
    this.q('DELETE FROM reactions WHERE github_id = ?', gid);
    this.q('DELETE FROM images WHERE owner = ?', gid);
    this.q('DELETE FROM entry_members WHERE github_id = ?', gid);
    for (const p of this.q('SELECT * FROM posts WHERE github_id = ? AND deleted = 0', gid)) {
      touched.add(p.entry_id);
      this.removePost(p);
      counts.posts++;
    }
    this.q("UPDATE posts SET login = '', github_id = 'erased' WHERE github_id = ?", gid);
    this.q("UPDATE entries SET last_post_login = '', last_post_by = NULL WHERE last_post_by = ?", gid);
    for (const entry of touched) if (this.entryRow(entry)) this.bump(entry, { activity: false });
    return counts;
  }
}

export { KINDS };
