// sow-500: the host's share link adds a signed-in member who opens it. A join code on every entry shared with chosen
// members; the link never expires (owner, 2026-11-21) but is never honoured on a draft; every refusal is the same
// not_found a missing entry gives. Real store on node:sqlite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, sqliteAdapter, SUPER, PRIYA, BEN, member } from './lib/community-sqlite.mjs';
import { CommunityStore, CommunityError } from '../membership/community-store.mjs';
import { LIMITS } from '../membership/community-shared.mjs';

const TOPIC = { kind: 'topic', title: 'Meeting Nov 21 2026', access: { mode: 'chosen', members: [BEN.githubId] } };

function err(fn) {
  try { fn(); } catch (e) { assert.ok(e instanceof CommunityError, `expected a CommunityError, got ${e}`); return e; }
  assert.fail('expected it to throw');
}
const sees = (store, who, id) => { try { store.getEntry(who, id); return true; } catch { return false; } };

function setup({ open = true, entry = TOPIC } = {}) {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, entry, { open });
  return { store, id, code: store.getEntry(SUPER, id).entry.joinCode };
}

test('an entry shared with chosen members gets a join code; only the host ever receives it', () => {
  const { store, id, code } = setup();
  assert.match(code, /^[a-z0-9]{16}$/);
  assert.ok(!('joinCode' in store.getEntry(BEN, id).entry), 'a chosen member never receives the code');
  assert.ok(!JSON.stringify(store.listEntries(BEN, {})).includes(code), 'nor in the list');
  const all = store.createEntry(SUPER, { kind: 'topic', title: 'Open to all' }, { open: true }).id;
  assert.equal(store.getEntry(SUPER, all).entry.joinCode, null, 'an all-members entry has no join link');
});

test('the right code adds a member who could not see the entry, with their login', () => {
  const { store, id, code } = setup();
  assert.equal(sees(store, PRIYA, id), false);
  assert.deepEqual(store.join(PRIYA, id, code), { joined: true, id });
  assert.equal(sees(store, PRIYA, id), true);
  const m = store.getEntry(SUPER, id).entry.access.members.find((x) => x.githubId === PRIYA.githubId);
  assert.equal(m.login, 'priya');
  assert.deepEqual(store.join(PRIYA, id, code), { joined: false, id }, 'opening it again changes nothing');
});

test('the link never expires: it still adds people after closing and after publishing', () => {
  const { store, id, code } = setup();
  store.setStatus(SUPER, id, 'close');
  assert.equal(store.join(PRIYA, id, code).joined, true, 'a closed topic');
  const poll = setup({ entry: { kind: 'poll', title: 'Breakfast?', options: ['Coffee', 'Eggs'], access: TOPIC.access } });
  poll.store.setStatus(SUPER, poll.id, 'close');
  poll.store.setStatus(SUPER, poll.id, 'publish');
  assert.equal(poll.store.join(member(3), poll.id, poll.code).joined, true, 'a poll with published results');
});

test('every refusal is not_found: a wrong code, a draft, no code, and an entry that does not exist', () => {
  const { store, id, code } = setup();
  for (const bad of ['', 'x', code.slice(0, 15), `${code}x`, code.toUpperCase(), null, undefined, 42]) {
    assert.equal(err(() => store.join(PRIYA, id, bad)).code, 'not_found', `code ${String(bad)}`);
  }
  assert.equal(sees(store, PRIYA, id), false);
  const draft = setup({ open: false });
  assert.equal(err(() => draft.store.join(PRIYA, draft.id, draft.code)).code, 'not_found', 'never on a draft');
  assert.equal(err(() => store.join(PRIYA, 'abcdefghjkmnpqrs', code)).code, 'not_found');
  assert.equal(err(() => store.join(PRIYA, 'not an id', code)).code, 'not_found');
});

test('the host turns the link off, and a new link replaces the old code at once', () => {
  const { store, id, code } = setup();
  assert.deepEqual(store.setJoinLink(SUPER, id, 'off'), { id, joinCode: null });
  assert.equal(store.getEntry(SUPER, id).entry.joinCode, null);
  assert.equal(err(() => store.join(PRIYA, id, code)).code, 'not_found', 'off means off');
  store.editEntry(SUPER, id, { ...TOPIC, title: 'Meeting Nov 21 2026, renamed' });
  assert.equal(store.getEntry(SUPER, id).entry.joinCode, null, 'an edit does not turn a link back on');
  const fresh = store.setJoinLink(SUPER, id, 'new').joinCode;
  assert.notEqual(fresh, code);
  assert.equal(err(() => store.join(PRIYA, id, code)).code, 'not_found', 'the old code stops');
  assert.equal(store.join(PRIYA, id, fresh).joined, true);
  assert.equal(err(() => store.setJoinLink(PRIYA, id, 'new')).code, 'forbidden', 'members cannot touch it');
  assert.equal(err(() => store.setJoinLink(SUPER, id, 'on')).code, 'bad_request');
});

test('an all-members entry, and a member already chosen, are left exactly as they are', () => {
  const { store, id, code } = setup();
  const before = store.getEntry(SUPER, id).version;
  assert.deepEqual(store.join(BEN, id, 'wrong'), { joined: false, id }, 'already chosen: no code needed, nothing written');
  assert.equal(store.getEntry(SUPER, id).version, before);
  const all = store.createEntry(SUPER, { kind: 'topic', title: 'Open to all' }, { open: true }).id;
  assert.equal(store.join(PRIYA, all, code).joined, false);
  assert.equal(store.getEntry(SUPER, all).entry.access.mode, 'all', 'still all members');
});

test('a full entry refuses a new member', () => {
  const ids = Array.from({ length: LIMITS.chosenMax }, (_, i) => String(5000 + i));
  const { store, id, code } = setup({ entry: { ...TOPIC, access: { mode: 'chosen', members: ids } } });
  assert.equal(err(() => store.join(PRIYA, id, code)).code, 'conflict');
});

test('versions 1 and 2 migrate to 3, existing chosen entries get a code, and a second run changes nothing', () => {
  for (const from of ['1', '2']) {
    const sql = sqliteAdapter();
    sql.exec('CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)');
    sql.exec(`INSERT INTO meta (k, v) VALUES ('schema', '${from}')`);
    sql.exec(`CREATE TABLE entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL DEFAULT '[]', settings TEXT NOT NULL DEFAULT '{}', meeting_label TEXT NOT NULL DEFAULT '', meeting_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, access_mode TEXT NOT NULL DEFAULT 'all', created_by TEXT NOT NULL,
      created_login TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, opened_at INTEGER, closed_at INTEGER,
      published_at INTEGER, activity_at INTEGER NOT NULL, last_post_at INTEGER, last_post_by TEXT, last_post_login TEXT, version INTEGER NOT NULL DEFAULT 1)`);
    sql.exec("INSERT INTO entries (id, kind, title, status, access_mode, created_by, created_at, updated_at, activity_at) VALUES ('7x7s47n23wtsrn94', 'topic', 'Chosen', 'live', 'chosen', '1', 1, 1, 1)");
    sql.exec("INSERT INTO entries (id, kind, title, status, access_mode, created_by, created_at, updated_at, activity_at) VALUES ('abcdefghjkmnpqrs', 'topic', 'All', 'live', 'all', '1', 1, 1, 1)");
    const store = new CommunityStore(sql, { now: () => 2 });
    store.migrate();
    assert.deepEqual(sql.exec("SELECT v FROM meta WHERE k = 'schema'"), [{ v: '3' }], `from ${from}`);
    const codes = Object.fromEntries(sql.exec('SELECT id, join_code FROM entries').map((r) => [r.id, r.join_code]));
    assert.match(codes['7x7s47n23wtsrn94'], /^[a-z0-9]{16}$/, 'the chosen entry has a code');
    assert.equal(codes.abcdefghjkmnpqrs, null, 'the all-members entry needs none');
    new CommunityStore(sql, { now: () => 3 }).migrate();
    assert.equal(sql.exec("SELECT join_code FROM entries WHERE id = '7x7s47n23wtsrn94'")[0].join_code, codes['7x7s47n23wtsrn94'], 'a second run keeps the code');
  }
});
