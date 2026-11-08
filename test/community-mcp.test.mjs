// sow-494: the Community MCP tools, end to end. Each tool's operation calls the signup Worker through a fake fetch
// that runs the REAL route handler (membership-community.mjs), the REAL object op table (community-do.mjs) and a REAL
// store on node:sqlite. Only the identity is stood in: the bearer token names the viewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../client/src/mcp-tools.mjs';
import {
  listCommunityOp, readCommunityEntryOp, answerCommunityPollOp, postCommunityOp, reactCommunityPostOp, editCommunityPostOp,
  deleteCommunityPostOp, createCommunityEntryOp, manageCommunityEntryOp, setCommunityAccessOp, moderateCommunityPostOp,
  tidyCommunityAnswersOp,
} from '../client/src/operations.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { handleCommunity, COMMUNITY_ROUTES, membershipAdminCommunity, membershipAdminCommunityMembers } from '../workers/signup/membership-community.mjs';
import { runOp, encodeRpc, decodeRpc } from '../workers/signup/community-do.mjs';
import { makeStore, SUPER, PRIYA, BEN, PNG, toB64 } from './lib/community-sqlite.mjs';

const FREE = { githubId: '2999', login: 'freebie', superadmin: false };
const PEOPLE = { 'tok-super': SUPER, 'tok-priya': PRIYA, 'tok-ben': BEN, 'tok-free': FREE };

function world() {
  const { store } = makeStore();
  const calls = [];
  const call = async (_env, msg, bytes) => { const f = decodeRpc(encodeRpc(msg, bytes)); return runOp(store, f.msg, f.bytes); };
  const viewerOf = (request) => PEOPLE[(request.headers.get('Authorization') || '').replace('Bearer ', '')] || null;
  const gate = async (request) => {
    const v = viewerOf(request);
    if (!v) return { ok: false, status: 401, body: { error: 'unauthorized', message: 'a GitHub bearer token is required' } };
    if (v === FREE) return { ok: false, status: 403, body: { error: 'forbidden', message: 'an active paid membership is required' } };
    return { ok: true, viewer: v };
  };
  const superGate = async (request) => (viewerOf(request)?.superadmin ? { ok: true, viewer: SUPER } : { ok: false, status: 403, body: { error: 'forbidden', message: 'superadmin access is required' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method || 'GET'} ${u.pathname}`);
    const request = new Request(url, { method: init.method || 'GET', headers: init.headers, body: init.body });
    let r;
    const route = COMMUNITY_ROUTES[u.pathname]?.[request.method];
    if (route) r = await handleCommunity(request, {}, route, { call, full: gate, cheap: gate });
    else if (u.pathname === '/membership/admin/community') r = await membershipAdminCommunity(request, {}, { call, superadmin: superGate });
    else if (u.pathname === '/membership/admin/community/members') {
      r = await membershipAdminCommunityMembers(request, {}, { superadmin: superGate, readIndex: async () => new Map([[PRIYA.githubId, 'priya'], [BEN.githubId, 'ben']]) });
    } else r = { status: 404, body: { error: 'not_found' } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  const ctx = (token) => ({ store: { get: (k) => (k === 'githubToken' ? token : null) }, fetch });
  return { store, calls, ctx };
}

test('a member reads the list and an entry, answers, posts with an image, reacts, edits and deletes', async () => {
  const { store, ctx } = world();
  const { id } = store.createEntry(SUPER, { kind: 'poll', title: 'Which topic next?', options: ['Agents', 'Testing'], meeting: { label: 'Shop Talk', date: '2026-11-14' } }, { open: true });
  const p = ctx('tok-priya');
  const list = await listCommunityOp(p, {});
  assert.equal(list.entries[0].id, id);
  assert.deepEqual(list.entries[0].meeting, { label: 'Shop Talk', date: '2026-11-14', key: 'Shop Talk|2026-11-14' });
  assert.match(list.entries[0].url, /\/community\/entry\/\?id=/);
  const ans = await answerCommunityPollOp(p, { id, choice: 1 });
  assert.deepEqual(ans, { saved: true, yourAnswer: { choice: 1 } });
  const posted = await postCommunityOp(p, { id, body: 'Testing, our suite is slow.', images: [{ name: 'desk.png', dataBase64: toB64(PNG) }] });
  assert.equal(posted.posted, true);
  const r1 = await reactCommunityPostOp(ctx('tok-ben'), { id, postId: posted.postId, reaction: 'heart' });
  assert.equal(r1.on, true);
  await editCommunityPostOp(p, { id, postId: posted.postId, body: 'Testing. The suite takes nine minutes.' });
  const read = await readCommunityEntryOp(p, { id });
  assert.equal(read.yourAnswer.choice, 1);
  assert.equal(read.results, null, 'a member sees no tally before results are published');
  const mine = read.discussion.posts[0];
  assert.deepEqual([mine.body, mine.edited, mine.yours, mine.images.length, mine.reactions[0].reaction, mine.reactions[0].by], ['Testing. The suite takes nine minutes.', true, true, 1, 'heart', ['ben']]);
  assert.equal(read.youAreHost, false);
  await deleteCommunityPostOp(p, { id, postId: posted.postId });
  assert.equal((await readCommunityEntryOp(p, { id })).discussion.posts.length, 0);
});

test('an entry the member is not on is not-found, and is left out of their list', async () => {
  const { store, ctx } = world();
  const { id } = store.createEntry(SUPER, { kind: 'topic', title: 'Pricing circle', access: { mode: 'chosen', members: [PRIYA.githubId] } }, { open: true });
  const ben = ctx('tok-ben');
  await assert.rejects(readCommunityEntryOp(ben, { id }), (e) => e.code === 'not-found');
  await assert.rejects(readCommunityEntryOp(ben, { id: 'abcdefghjkmnpqrs' }), (e) => e.code === 'not-found' && /not shared with you/.test(e.message));
  await assert.rejects(postCommunityOp(ben, { id, body: 'hello' }), (e) => e.code === 'not-found');
  assert.deepEqual((await listCommunityOp(ben, {})).entries, []);
  assert.equal((await readCommunityEntryOp(ctx('tok-priya'), { id })).title, 'Pricing circle');
});

test('the host runs a typed poll from the agent: chosen by name, opened, tidied, published', async () => {
  const { ctx } = world();
  const s = ctx('tok-super');
  const made = await createCommunityEntryOp(s, {
    kind: 'typed', title: 'What is one movie that everyone watched in the last several months that you thought was great?',
    settings: { hint: 'A movie title' }, meeting: { label: 'Shop Talk', date: '2026-11-14' }, access: { mode: 'chosen', members: ['priya', BEN.githubId] },
  });
  assert.equal(made.status, 'draft', 'saved, not opened');
  await assert.rejects(answerCommunityPollOp(ctx('tok-priya'), { id: made.id, text: 'Arrival' }), (e) => e.code === 'not-found', 'a draft is the host\'s alone');
  assert.equal((await manageCommunityEntryOp(s, { id: made.id, action: 'open' })).status, 'live');
  await answerCommunityPollOp(ctx('tok-priya'), { id: made.id, text: 'Project Hail Mary' });
  await answerCommunityPollOp(ctx('tok-ben'), { id: made.id, text: 'Hail Mary' });
  const tidied = await tidyCommunityAnswersOp(s, { id: made.id, action: 'merge', answer: 'hail mary', into: 'Project Hail Mary' });
  assert.deepEqual(tidied.results.groups.map((g) => [g.label, g.count]), [['Project Hail Mary', 2]]);
  await manageCommunityEntryOp(s, { id: made.id, action: 'close' });
  await manageCommunityEntryOp(s, { id: made.id, action: 'publish' });
  const seen = await readCommunityEntryOp(ctx('tok-ben'), { id: made.id });
  assert.deepEqual(seen.results.groups.map((g) => [g.label, g.count, g.mine]), [['Project Hail Mary', 2, true]]);
  assert.deepEqual(seen.sharedWith.sort(), ['ben', 'priya']);
  await assert.rejects(manageCommunityEntryOp(s, { id: made.id, action: 'edit', input: { title: 'The movie poll' } }), (e) => e.code === 'conflict', 'the question locks once members answered');
  await manageCommunityEntryOp(s, { id: made.id, action: 'edit', input: { meeting: { label: 'Shop Talk', date: '2026-11-21' } } });
  const after = await readCommunityEntryOp(s, { id: made.id });
  assert.equal(after.meeting.key, 'Shop Talk|2026-11-21');
  assert.equal(after.access.mode, 'chosen', 'an edit through the agent keeps the entry private');
});

test('the host opens a topic with prompt images, sets access and moderates', async () => {
  const { ctx } = world();
  const s = ctx('tok-super');
  const t = await createCommunityEntryOp(s, { kind: 'topic', title: 'Show us your desk', prompt: 'One photo, one tool.', images: [{ name: 'host.png', dataBase64: toB64(PNG) }], open: true });
  assert.equal(t.status, 'live');
  const read = await readCommunityEntryOp(ctx('tok-priya'), { id: t.id });
  assert.equal(read.promptImages.length, 1);
  assert.equal(read.status, 'live');
  const p = await postCommunityOp(ctx('tok-priya'), { id: t.id, body: 'Off topic, sorry.' });
  await moderateCommunityPostOp(s, { id: t.id, postId: p.postId, action: 'hide' });
  const ben = await readCommunityEntryOp(ctx('tok-ben'), { id: t.id });
  assert.deepEqual([ben.discussion.posts[0].hidden, ben.discussion.posts[0].body], [true, ''], 'others see the note, not the text');
  const acc = await setCommunityAccessOp(s, { id: t.id, mode: 'chosen', members: ['priya'] });
  assert.deepEqual(acc.members, ['priya']);
  await assert.rejects(readCommunityEntryOp(ctx('tok-ben'), { id: t.id }), (e) => e.code === 'not-found', 'Ben stops seeing it at once');
  await assert.rejects(setCommunityAccessOp(s, { id: t.id, mode: 'chosen', members: ['nobody-here'] }), (e) => e.code === 'bad-request' && /No member named nobody-here/.test(e.message));
});

test('refusals arrive as clear codes, and bad arguments never reach the network', async () => {
  const { store, ctx, calls } = world();
  const { id } = store.createEntry(SUPER, { kind: 'poll', title: 'Q', options: ['a', 'b'] }, { open: true });
  await assert.rejects(listCommunityOp({ store: { get: () => null } }, {}), (e) => e.code === 'not-authenticated');
  await assert.rejects(listCommunityOp(ctx('tok-free'), {}), (e) => e.code === 'membership-required');
  await assert.rejects(createCommunityEntryOp(ctx('tok-priya'), { kind: 'topic', title: 'x' }), (e) => e.code === 'forbidden');
  await assert.rejects(manageCommunityEntryOp(ctx('tok-priya'), { id, action: 'delete' }), (e) => e.code === 'forbidden');
  const before = calls.length;
  await assert.rejects(reactCommunityPostOp(ctx('tok-priya'), { id, postId: id, reaction: '<3' }), (e) => e.code === 'bad-request');
  await assert.rejects(answerCommunityPollOp(ctx('tok-priya'), { id, choice: 1, text: 'both' }), (e) => e.code === 'bad-request');
  await assert.rejects(readCommunityEntryOp(ctx('tok-priya'), { id: '../etc' }), (e) => e.code === 'bad-request');
  await assert.rejects(manageCommunityEntryOp(ctx('tok-super'), { id, action: 'explode' }), (e) => e.code === 'bad-request');
  await assert.rejects(createCommunityEntryOp(ctx('tok-super'), { kind: 'poll', title: 'x', images: [{ name: 'a.png', dataBase64: toB64(PNG) }] }), (e) => e.code === 'bad-request');
  assert.equal(calls.length, before, 'none of those made a request');
  await assert.rejects(answerCommunityPollOp(ctx('tok-priya'), { id, choice: 7 }), (e) => e.code === 'bad-request');
});

// The guide is TypeScript, which plain Node 22.17 cannot import. Compile it rather than skip it: a census that falls
// back to "could not load" when it cannot read the module checks nothing.
async function loadGuide() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-guide-')), 'mcp-guide.mjs');
  esbuild.buildSync({ entryPoints: [new URL('../src/lib/mcp-guide.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  return import(pathToFileURL(out).href);
}

test('the twelve tools are registered, grouped in the guide, and their copy follows the writing rules', async () => {
  const guide = await loadGuide();
  const names = TOOLS.map((t) => t.name);
  const community = ['list_community', 'read_community_entry', 'answer_community_poll', 'post_community', 'react_community_post', 'edit_community_post', 'delete_community_post',
    'create_community_entry', 'manage_community_entry', 'set_community_access', 'moderate_community_post', 'tidy_community_answers'];
  for (const n of community) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length, 'no tool is defined twice');
  const group = guide.mcpToolGroups(names).find((g) => g.title === 'Community');
  assert.deepEqual(group.tools, community);
  for (const t of TOOLS.filter((x) => community.includes(x.name))) {
    assert.doesNotMatch(t.description, /[—–]|n't|'re|'ll|'ve/, t.name);
    assert.equal(typeof t.handler, 'function');
    if (/^(create|manage|set|moderate|tidy)_/.test(t.name)) assert.match(t.description, /^SUPERADMIN ONLY\./, t.name);
  }
});
