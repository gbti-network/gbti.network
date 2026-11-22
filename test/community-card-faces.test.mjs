// sow-501: the faces on a Community list card. Shared with chosen members: those members. Open to all members: who
// took part (a visible post, or a public answer); an anonymous answer is never a face. Real store on node:sqlite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, SUPER, PRIYA, BEN, member } from './lib/community-sqlite.mjs';

const row = (store, who, id) => store.listEntries(who, {}).entries.find((e) => e.id === id);

test('shared with chosen members: the card shows those members, capped at 8, with the full count', () => {
  const { store } = makeStore();
  const ids = Array.from({ length: 11 }, (_, i) => String(3000 + i));
  const logins = Object.fromEntries(ids.map((g, i) => [g, `m${String(i).padStart(2, '0')}`]));
  const { id } = store.createEntry(SUPER, { kind: 'topic', title: 'Meeting Nov 21 2026', access: { mode: 'chosen', members: ids, logins } }, { open: true });
  const people = row(store, SUPER, id).people;
  assert.equal(people.mode, 'shared');
  assert.equal(people.count, 11);
  assert.equal(people.list.length, 8);
  assert.deepEqual(people.list.slice(0, 2), [{ githubId: '3000', login: 'm00' }, { githubId: '3001', login: 'm01' }], 'ordered by name');
});

test('open to all members: who took part, newest first, each once; anonymous answers, hidden and deleted posts never', () => {
  const { store, advance } = makeStore();
  const { id } = store.createEntry(SUPER, { kind: 'poll', title: 'Breakfast?', options: ['Coffee', 'Eggs'] }, { open: true });
  assert.deepEqual(row(store, PRIYA, id).people, { mode: 'took-part', count: 0, list: [] }, 'nobody yet');
  const tick = () => (typeof advance === 'function' ? advance(1000) : null);
  store.answer(member(7, 'anon'), id, { choice: 0 }); tick();
  store.answer(PRIYA, id, { choice: 0, public: true }); tick();
  store.post(BEN, id, { body: 'Coffee, always.' }); tick();
  const hidden = store.post(member(8, 'hidden'), id, { body: 'spam' }).id; tick();
  store.moderate(SUPER, id, hidden, 'hide');
  const gone = store.post(member(9, 'gone'), id, { body: 'oops' }).id; tick();
  store.deletePost(member(9, 'gone'), id, gone);
  store.post(PRIYA, id, { body: 'Eggs on Saturdays.' }); tick();
  const people = row(store, BEN, id).people;
  assert.equal(people.mode, 'took-part');
  assert.deepEqual(people.list.map((p) => p.login), ['priya', 'ben'], 'priya once (answered and posted), newest first');
  assert.equal(people.count, 2);
  const text = JSON.stringify(people);
  for (const n of ['anon', 'hidden', 'gone']) assert.ok(!text.includes(n), `${n} is not a face`);
});

test('after erasure the member is no longer a face on any card', () => {
  const { store } = makeStore();
  const all = store.createEntry(SUPER, { kind: 'poll', title: 'Breakfast?', options: ['Coffee', 'Eggs'] }, { open: true }).id;
  const chosen = store.createEntry(SUPER, { kind: 'topic', title: 'Chosen', access: { mode: 'chosen', members: [PRIYA.githubId, BEN.githubId] } }, { open: true }).id;
  store.answer(PRIYA, all, { choice: 0, public: true });
  store.post(PRIYA, all, { body: 'Coffee.' });
  store.eraseMember(PRIYA.githubId);
  assert.deepEqual(row(store, SUPER, all).people, { mode: 'took-part', count: 0, list: [] });
  assert.deepEqual(row(store, SUPER, chosen).people.list.map((p) => p.githubId), [BEN.githubId]);
  assert.ok(!JSON.stringify(store.listEntries(SUPER, {})).includes('erased'), 'no erased placeholder becomes a face');
});
