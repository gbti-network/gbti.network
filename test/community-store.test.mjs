// sow-494: the Community store over a real SQLite engine (node:sqlite). Access, lifecycle, answers, typed tidying,
// posts, moderation, reactions, private images and erasure. The access rule is the one that matters most: a member
// who is not on an entry must get the SAME not_found as for an entry that does not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, SUPER, PRIYA, BEN, member, PNG, JPG } from './lib/community-sqlite.mjs';
import { CommunityError } from '../membership/community-store.mjs';

const POLL = { kind: 'poll', title: 'Which topic should the next Shop Talk dig into?', options: ['Self-hosting on a home Proxmox box', 'Getting a Chrome extension through store review', 'Pricing a WordPress plugin', 'Agents in client work'] };
const TYPED = { kind: 'typed', title: 'What is one movie that everyone watched in the last several months that you thought was great?', settings: { hint: 'A movie title' } };
const TOPIC = { kind: 'topic', title: 'Show us where you work', prompt: 'Post one photo of where you work.' };

function err(fn) {
  try { fn(); } catch (e) { return e; }
  assert.fail('expected an error');
}

test('a draft is superadmin-only, and a hidden entry is indistinguishable from a missing one', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, POLL);
  assert.equal(store.listEntries(SUPER).entries.length, 1);
  assert.equal(store.listEntries(PRIYA).entries.length, 0);
  const hidden = err(() => store.getEntry(PRIYA, id));
  const missing = err(() => store.getEntry(PRIYA, 'abcdefghjkmnpqrs'));
  assert.ok(hidden instanceof CommunityError);
  assert.equal(hidden.status, 404);
  assert.deepEqual([hidden.status, hidden.code, hidden.message], [missing.status, missing.code, missing.message]);
  store.setStatus(SUPER, id, 'open');
  assert.equal(store.getEntry(PRIYA, id).entry.status, 'live');
});

test('chosen access: Priya sees three entries, Ben sees one, and nobody meets what they are not on', () => {
  const { store } = makeStore();
  const shared = { mode: 'chosen', members: [PRIYA.githubId], logins: { [PRIYA.githubId]: 'priya' } };
  const a = store.createEntry(SUPER, { ...TYPED, access: shared }, { open: true }).id;
  const b = store.createEntry(SUPER, { ...TOPIC, access: { mode: 'all' } }, { open: true }).id;
  const c = store.createEntry(SUPER, { ...POLL, access: shared }, { open: true }).id;
  assert.deepEqual(store.listEntries(PRIYA).entries.map((e) => e.id).sort(), [a, b, c].sort());
  assert.deepEqual(store.listEntries(BEN).entries.map((e) => e.id), [b]);
  for (const id of [a, c]) {
    const e = err(() => store.getEntry(BEN, id));
    assert.equal(e.code, 'not_found');
    assert.equal(err(() => store.answer(BEN, id, { choice: 0 })).code, 'not_found');
    assert.equal(err(() => store.post(BEN, id, { body: 'hi' })).code, 'not_found');
    assert.equal(err(() => store.version(BEN, id)).code, 'not_found');
  }
  const seen = store.getEntry(PRIYA, a).entry.access;
  assert.deepEqual(seen, { mode: 'chosen', count: 1, members: [{ githubId: PRIYA.githubId, login: 'priya' }] });
  store.setAccess(SUPER, a, { mode: 'chosen', members: [BEN.githubId] });
  assert.equal(err(() => store.getEntry(PRIYA, a)).code, 'not_found', 'removing someone hides the entry at once');
  assert.equal(store.getEntry(BEN, a).entry.id, a);
});

test('a viewer must be a verified GitHub id', () => {
  const { store } = makeStore();
  assert.equal(err(() => store.listEntries({})).status, 401);
  assert.equal(err(() => store.listEntries({ githubId: 'x' })).status, 401);
  assert.equal(err(() => store.createEntry(PRIYA, POLL)).status, 403, 'members cannot create entries');
});

test('poll lifecycle: members see results only once published; every one of twenty answers counts', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, POLL, { open: true });
  for (let n = 1; n <= 20; n++) store.answer(member(n), id, { choice: n % 4 });
  assert.equal(store.getEntry(member(1), id).results, null, 'hidden while live');
  assert.equal(store.getEntry(SUPER, id).results.total, 20, 'the host sees live counts');
  assert.deepEqual(store.getEntry(member(1), id).mine, { choice: 1 });
  store.answer(member(1), id, { choice: 3 });
  assert.equal(store.getEntry(SUPER, id).results.total, 20, 'changing an answer moves it, never doubles it');
  assert.equal(store.getEntry(SUPER, id).results.byOption[3].count, 6);
  assert.equal(err(() => store.setStatus(SUPER, id, 'publish')).code, 'conflict', 'close before publish');
  store.setStatus(SUPER, id, 'close');
  assert.equal(err(() => store.answer(member(2), id, { choice: 0 })).message, 'Voting has closed.');
  store.setStatus(SUPER, id, 'publish');
  const r = store.getEntry(member(5), id).results;
  assert.equal(r.total, 20);
  assert.equal(r.groups[0].count, 6);
  assert.equal(store.listEntries(member(5)).entries[0].lead.count, 6);
});

test('a poll can refuse a changed answer, and can publish on close', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, { ...POLL, settings: { changeable: false, publishOnClose: true } }, { open: true });
  store.answer(PRIYA, id, { choice: 0 });
  assert.equal(err(() => store.answer(PRIYA, id, { choice: 1 })).code, 'conflict');
  store.answer(PRIYA, id, { choice: 0 });
  store.setStatus(SUPER, id, 'close');
  assert.equal(store.getEntry(PRIYA, id).entry.status, 'published');
});

test('the question and answers lock at the first answer', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, POLL, { open: true });
  store.editEntry(SUPER, id, { ...POLL, options: [...POLL.options, 'Something else'] });
  store.answer(PRIYA, id, { choice: 0 });
  assert.equal(err(() => store.editEntry(SUPER, id, { ...POLL, options: POLL.options })).code, 'conflict');
  store.editEntry(SUPER, id, { ...POLL, options: [...POLL.options, 'Something else'], meeting: { label: 'Shop Talk', date: '2026-11-07' } });
  assert.equal(store.getEntry(SUPER, id).entry.meeting.label, 'Shop Talk');
});

test('typed poll: matching answers count together, the host merges and hides, results stay anonymous', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, TYPED, { open: true });
  const typed = ['Project Hail Mary', 'project hail mary', 'Project Hail Mary!', 'Hail Mary', 'Sinners', 'sinners', 'Something rude'];
  typed.forEach((text, i) => store.answer(member(i + 1), id, { text }));
  let r = store.getEntry(SUPER, id).results;
  assert.equal(r.groups[0].label, 'Project Hail Mary');
  assert.equal(r.groups[0].count, 3);
  store.tidy(SUPER, id, { action: 'merge', norm: 'Hail Mary', into: 'Project Hail Mary' });
  store.tidy(SUPER, id, { action: 'hide', norm: 'Something rude' });
  r = store.getEntry(SUPER, id).results;
  assert.equal(r.groups[0].count, 4);
  assert.deepEqual(r.hidden, ['Something rude']);
  store.tidy(SUPER, id, { action: 'rename', norm: 'sinners', label: 'Sinners (2025)' });
  store.setStatus(SUPER, id, 'close');
  store.setStatus(SUPER, id, 'publish');
  const pub = store.getEntry(member(1), id).results;
  assert.equal(pub.total, 6);
  assert.deepEqual(pub.groups.map((g) => [g.label, g.count]), [['Project Hail Mary', 4], ['Sinners (2025)', 2]]);
  assert.ok(!pub.every.includes('Something rude'));
  assert.equal(pub.hidden, undefined, 'members never see hidden answers');
  assert.ok(!JSON.stringify(pub).includes('100'), 'no member ids in results');
  assert.equal(err(() => store.answer(member(1), id, { text: 'x'.repeat(81) })).code, 'conflict', 'closed before length check');
});

test('typed answers obey the length setting', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, TYPED, { open: true });
  assert.equal(err(() => store.answer(PRIYA, id, { text: 'x'.repeat(81) })).code, 'bad_request');
  const long = store.createEntry(SUPER, { ...TYPED, settings: { answerLength: 'long' } }, { open: true }).id;
  store.answer(PRIYA, long, { text: 'x'.repeat(200) });
});

test('posts: replies are one level deep, authors edit and delete their own, a deleted post with replies stays as a placeholder', () => {
  const { store, advance } = makeStore();
  const { id } = store.createEntry(SUPER, TOPIC, { open: true });
  const p = store.post(PRIYA, id, { body: 'A standing desk.' }).id;
  advance(1000);
  const r = store.post(BEN, id, { body: 'Which keyboard?', parentId: p }).id;
  assert.equal(err(() => store.post(BEN, id, { body: 'deeper', parentId: r })).code, 'bad_request');
  assert.equal(err(() => store.editPost(BEN, id, p, { body: 'mine now' })).status, 403);
  store.editPost(PRIYA, id, p, { body: 'A standing desk and a split keyboard.' });
  let d = store.getEntry(BEN, id).discussion;
  assert.equal(d.posts[0].body, 'A standing desk and a split keyboard.');
  assert.ok(d.posts[0].editedAt);
  assert.equal(d.posts[0].replies[0].body, 'Which keyboard?');
  store.deletePost(PRIYA, id, p);
  d = store.getEntry(BEN, id).discussion;
  assert.equal(d.posts[0].deleted, true);
  assert.equal(d.posts[0].author, null);
  assert.equal(d.posts[0].replies.length, 1, 'the reply survives');
  store.deletePost(BEN, id, r);
  assert.equal(store.getEntry(BEN, id).discussion.posts.length, 0, 'the placeholder goes with its last reply');
});

test('moderation: hidden posts are blanked for others but not their author, pinned posts sort first, closing a topic locks it', () => {
  const { store, advance } = makeStore();
  const { id } = store.createEntry(SUPER, TOPIC, { open: true });
  const a = store.post(PRIYA, id, { body: 'first' }).id;
  advance(10);
  const b = store.post(BEN, id, { body: 'second' }).id;
  assert.equal(err(() => store.moderate(PRIYA, id, a, 'hide')).status, 403);
  store.moderate(SUPER, id, a, 'hide');
  store.moderate(SUPER, id, b, 'pin');
  const ben = store.getEntry(BEN, id).discussion;
  assert.equal(ben.posts[0].id, b);
  assert.equal(ben.posts[1].hidden, true);
  assert.equal(ben.posts[1].body, '');
  assert.equal(store.getEntry(PRIYA, id).discussion.posts[1].body, 'first', 'the author still sees it');
  store.setStatus(SUPER, id, 'close');
  assert.equal(err(() => store.post(PRIYA, id, { body: 'late' })).message, 'This discussion is closed.');
  store.setStatus(SUPER, id, 'open');
  store.post(PRIYA, id, { body: 'reopened' });
});

test('closing a poll leaves its discussion open; lock closes it', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, POLL, { open: true });
  store.setStatus(SUPER, id, 'close');
  store.post(PRIYA, id, { body: 'still talking' });
  store.setStatus(SUPER, id, 'lock');
  assert.equal(err(() => store.post(PRIYA, id, { body: 'no' })).code, 'conflict');
});

test('reactions: the standard set only, toggled per member, with counts and names', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, TOPIC, { open: true });
  const p = store.post(PRIYA, id, { body: 'hello' }).id;
  store.react(BEN, id, p, 'heart');
  store.react(PRIYA, id, p, 'heart');
  store.react(BEN, id, p, 'rocket');
  assert.equal(err(() => store.react(BEN, id, p, 'skull')).code, 'bad_request');
  let rx = store.getEntry(BEN, id).discussion.posts[0].reactions;
  const heart = rx.find((r) => r.name === 'heart');
  assert.deepEqual([heart.count, heart.mine, heart.emoji], [2, true, '❤️']);
  assert.deepEqual(heart.who.sort(), ['ben', 'priya']);
  store.react(BEN, id, p, 'heart');
  rx = store.getEntry(BEN, id).discussion.posts[0].reactions;
  assert.equal(rx.find((r) => r.name === 'heart').count, 1);
});

test('images are private: staged ones to their owner, posted ones to the entry, hidden ones to author and host', () => {
  const { store, advance } = makeStore();
  const { id } = store.createEntry(SUPER, TOPIC, { open: true });
  const img = store.putImage(PRIYA, id, { name: 'desk.png', contentType: 'image/png', bytes: PNG }).id;
  assert.deepEqual([...store.getImage(PRIYA, id, img).bytes], [...PNG]);
  assert.equal(err(() => store.getImage(BEN, id, img)).code, 'not_found', 'staged images are the owner\'s');
  assert.equal(err(() => store.post(BEN, id, { body: 'x', images: [img] })).code, 'bad_request', 'nobody posts another member\'s image');
  const p = store.post(PRIYA, id, { body: 'my desk', images: [img] }).id;
  assert.equal(store.getImage(BEN, id, img).contentType, 'image/png');
  assert.deepEqual(store.getEntry(BEN, id).discussion.posts[0].images, [{ id: img, name: 'desk.png' }]);
  store.moderate(SUPER, id, p, 'hide');
  assert.equal(err(() => store.getImage(BEN, id, img)).code, 'not_found');
  assert.ok(store.getImage(PRIYA, id, img));
  assert.ok(store.getImage(SUPER, id, img));
  const stale = store.putImage(BEN, id, { name: 'a.jpg', contentType: 'image/jpeg', bytes: JPG }).id;
  advance(25 * 3600_000);
  store.putImage(BEN, id, { name: 'b.jpg', contentType: 'image/jpeg', bytes: JPG });
  assert.equal(err(() => store.getImage(BEN, id, stale)).code, 'not_found', 'unattached uploads are swept after a day');
  const priv = store.createEntry(SUPER, { ...TOPIC, access: { mode: 'chosen', members: [PRIYA.githubId] } }, { open: true }).id;
  const pimg = store.putImage(PRIYA, priv, { name: 'p.png', contentType: 'image/png', bytes: PNG }).id;
  store.post(PRIYA, priv, { body: 'private', images: [pimg] });
  assert.equal(err(() => store.getImage(BEN, priv, pimg)).code, 'not_found', 'an entry\'s images follow its access');
});

test('a topic with images turned off refuses them; uploads are capped per member', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, { ...TOPIC, settings: { imagesAllowed: false } }, { open: true });
  const img = store.putImage(PRIYA, id, { name: 'a.png', contentType: 'image/png', bytes: PNG }).id;
  assert.equal(err(() => store.post(PRIYA, id, { body: 'x', images: [img] })).code, 'bad_request');
  for (let i = 1; i < 18; i++) store.putImage(PRIYA, id, { name: `a${i}.png`, contentType: 'image/png', bytes: PNG });
  assert.equal(err(() => store.putImage(PRIYA, id, { name: 'z.png', contentType: 'image/png', bytes: PNG })).code, 'conflict');
});

test('every change bumps the version the live view polls, and the list puts live entries first', () => {
  const { store, advance } = makeStore();
  const old = store.createEntry(SUPER, POLL, { open: true }).id;
  advance(1000);
  const closed = store.createEntry(SUPER, TOPIC, { open: true }).id;
  store.setStatus(SUPER, closed, 'close');
  const v0 = store.version(PRIYA, old).version;
  store.answer(PRIYA, old, { choice: 0 });
  const v1 = store.version(PRIYA, old).version;
  assert.ok(v1 > v0);
  store.post(BEN, old, { body: 'hi' });
  assert.ok(store.version(PRIYA, old).version > v1);
  assert.deepEqual(store.listEntries(PRIYA).entries.map((e) => e.id), [old, closed]);
  assert.deepEqual(store.listEntries(PRIYA, { kind: 'topic' }).entries.map((e) => e.id), [closed]);
});

test('erasure removes a member\'s answers, reactions, images and grants, and leaves placeholders only where replies need them', () => {
  const { store } = makeStore();
  const poll = store.createEntry(SUPER, POLL, { open: true }).id;
  const topic = store.createEntry(SUPER, { ...TOPIC, access: { mode: 'chosen', members: [PRIYA.githubId, BEN.githubId] } }, { open: true }).id;
  store.answer(PRIYA, poll, { choice: 1 });
  store.answer(BEN, poll, { choice: 1 });
  const img = store.putImage(PRIYA, topic, { name: 'a.png', contentType: 'image/png', bytes: PNG }).id;
  const replied = store.post(PRIYA, topic, { body: 'answered later', images: [img] }).id;
  store.post(PRIYA, topic, { body: 'alone' });
  store.post(BEN, topic, { body: 'reply', parentId: replied });
  store.react(PRIYA, topic, replied, 'eyes');
  const counts = store.eraseMember(PRIYA.githubId);
  assert.deepEqual(counts, { answers: 1, reactions: 1, posts: 2, images: 1, grants: 1 });
  assert.equal(store.getEntry(SUPER, poll).results.total, 1);
  const d = store.getEntry(BEN, topic).discussion;
  assert.equal(d.posts.length, 1);
  assert.equal(d.posts[0].deleted, true);
  assert.equal(d.posts[0].author, null);
  assert.equal(d.posts[0].replies[0].body, 'reply');
  assert.ok(!JSON.stringify(store.getEntry(SUPER, topic)).includes(PRIYA.githubId), 'no trace of the member id');
  assert.ok(!JSON.stringify(store.getEntry(SUPER, topic)).includes('priya'));
  for (const [table, col] of [['posts', 'github_id'], ['answers', 'github_id'], ['reactions', 'github_id'], ['images', 'owner'], ['entry_members', 'github_id']]) {
    assert.equal(store.q(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, PRIYA.githubId)[0].n, 0, `nothing stored under the id in ${table}`);
  }
  assert.equal(store.q("SELECT COUNT(*) AS n FROM posts WHERE login = 'priya'")[0].n, 0);
});

test('delete removes an entry and everything under it', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, TOPIC, { open: true });
  store.putImage(PRIYA, id, { name: 'a.png', contentType: 'image/png', bytes: PNG });
  store.post(PRIYA, id, { body: 'x' });
  store.setStatus(SUPER, id, 'delete');
  assert.equal(err(() => store.getEntry(SUPER, id)).code, 'not_found');
  for (const t of ['posts', 'images', 'answers', 'reactions', 'entry_members']) assert.equal(store.q(`SELECT COUNT(*) AS n FROM ${t}`)[0].n, 0, t);
});

test('a meeting is its label and its date, so each week is its own filter option', () => {
  const { store, advance } = makeStore();
  const mk = (title, meeting) => { advance(1000); return store.createEntry(SUPER, { kind: 'topic', title, meeting }, { open: true }).id; };
  const a = mk('Week one', { label: 'Shop Talk', date: '2026-10-31' });
  const b = mk('Week two', { label: 'Shop Talk', date: '2026-11-07' });
  const c = mk('Between', { label: '', date: '' });
  const priv = store.createEntry(SUPER, { kind: 'topic', title: 'Private', meeting: { label: 'Circle', date: '2026-11-08' }, access: { mode: 'chosen', members: [PRIYA.githubId] } }, { open: true }).id;
  const all = store.listEntries(BEN);
  assert.deepEqual(all.meetings.map((m) => m.key), ['Shop Talk|2026-11-07', 'Shop Talk|2026-10-31'], 'newest first, and a meeting Ben has no entry in is not offered');
  assert.deepEqual(store.listEntries(BEN, { meeting: 'Shop Talk|2026-11-07' }).entries.map((e) => e.id), [b]);
  assert.deepEqual(store.listEntries(BEN, { meeting: '-' }).entries.map((e) => e.id), [c]);
  assert.deepEqual(store.listEntries(BEN, { meeting: 'Shop Talk' }).entries, [], 'a bare label no longer matches dated meetings');
  assert.equal(store.listEntries(PRIYA).meetings[0].key, 'Circle|2026-11-08');
  assert.equal(store.getEntry(BEN, a).entry.meeting.key, 'Shop Talk|2026-10-31');
  assert.ok(priv);
});

test('the viewer sees which group holds their own answer, and nothing about anyone else', () => {
  const { store } = makeStore();
  const typed = store.createEntry(SUPER, { kind: 'typed', title: 'Movie?' }, { open: true }).id;
  store.answer(PRIYA, typed, { text: 'Project Hail Mary' });
  store.answer(BEN, typed, { text: 'project hail mary!' });
  store.answer(member(3), typed, { text: 'Arrival' });
  store.setStatus(SUPER, typed, 'close');
  store.setStatus(SUPER, typed, 'publish');
  const ben = store.getEntry(BEN, typed).results.groups;
  assert.deepEqual(ben.map((g) => [g.label, g.count, g.mine]), [['Project Hail Mary', 2, true], ['Arrival', 1, false]]);
  assert.equal(ben[0].norms, undefined, 'a member never receives the spellings');
  const poll = store.createEntry(SUPER, { kind: 'poll', title: 'Q', options: ['a', 'b'] }, { open: true }).id;
  store.answer(PRIYA, poll, { choice: 1 });
  store.setStatus(SUPER, poll, 'close');
  store.setStatus(SUPER, poll, 'publish');
  assert.deepEqual(store.getEntry(PRIYA, poll).results.groups.map((g) => [g.label, g.mine]), [['b', true], ['a', false]]);
  assert.ok(store.getEntry(BEN, poll).results.groups.every((g) => g.mine === undefined), 'no answer, no mark');
});

test('a prompt image stays on an edit by the other superadmin, and a stranger cannot attach theirs', () => {
  const { store } = makeStore();
  const OTHER = { githubId: '125175037', login: 'atwellpub', superadmin: true };
  const { id } = store.createEntry(SUPER, { kind: 'topic', title: 'Desks' });
  const img = store.putImage(SUPER, id, { name: 'desk.png', contentType: 'image/png', bytes: PNG }).id;
  store.editEntry(SUPER, id, { kind: 'topic', title: 'Desks', promptImages: [img] });
  store.editEntry(OTHER, id, { kind: 'topic', title: 'Desks, again', promptImages: [img] });
  assert.deepEqual(store.getEntry(SUPER, id).entry.promptImages.map((i) => i.id), [img]);
  store.setStatus(SUPER, id, 'open');
  const stray = store.putImage(PRIYA, id, { name: 'mine.png', contentType: 'image/png', bytes: PNG }).id;
  store.editEntry(OTHER, id, { kind: 'topic', title: 'Desks, again', promptImages: [img, stray] });
  assert.deepEqual(store.getEntry(SUPER, id).entry.promptImages.map((i) => i.id), [img], 'a member upload is never pulled onto the prompt');
});


test('an edit keeps every field it leaves out, above all who can see the entry', () => {
  const { store } = makeStore();
  const { id } = store.createEntry(SUPER, { kind: 'poll', title: 'Q', options: ['a', 'b'], settings: { publishOnClose: true }, meeting: { label: 'Circle', date: '2026-11-08' },
    access: { mode: 'chosen', members: [PRIYA.githubId], logins: { [PRIYA.githubId]: 'priya' } } }, { open: true });
  store.editEntry(SUPER, id, { title: 'Q, with the typo fixed' });
  const e = store.getEntry(SUPER, id).entry;
  assert.equal(e.title, 'Q, with the typo fixed');
  assert.deepEqual(e.options, ['a', 'b']);
  assert.equal(e.settings.publishOnClose, true);
  assert.equal(e.meeting.key, 'Circle|2026-11-08');
  assert.equal(e.access.mode, 'chosen', 'still private');
  assert.deepEqual(e.access.members, [{ githubId: PRIYA.githubId, login: 'priya' }], 'and still named');
  assert.throws(() => store.getEntry(BEN, id), /not found/i, 'Ben still never meets it');
  store.editEntry(SUPER, id, { access: { mode: 'all' } });
  assert.equal(store.getEntry(BEN, id).entry.access.mode, 'all', 'an access the edit does give still applies');
});
