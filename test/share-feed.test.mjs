// SOW-018: the Shares reading feed data path. shareSummary purity, the listShares operation (requires
// identity; async over both readers), the npm fs-walk reader, and the extension Git-Trees reader (one
// recursive tree call, newest-first by the timestamp-slug filename, drafts filtered, members body never read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { shareSummary, byShareNewest } from '../client/src/content-ops.mjs';
import { listShares, OperationError } from '../client/src/operations.mjs';
import { createReader } from '../client/src/repo-fs.mjs';
import { createGithubReader } from '../extension/src/github-reader.mjs';

const ctxWith = (reader, identity = { username: 'alice', login: 'alice', githubId: '1' }) => ({
  identity: () => identity,
  reader,
});

test('shareSummary: public includes the body, members excludes it, createdAt normalized', () => {
  const pub = shareSummary('members/a/shares/x.md', { id: 'x', author: 'a', visibility: 'public', createdAt: new Date('2026-06-10T00:00:00Z'), tags: ['t'] }, 'hello');
  assert.equal(pub.body, 'hello');
  assert.equal(pub.visibility, 'public');
  assert.equal(pub.createdAt, '2026-06-10T00:00:00.000Z');
  assert.deepEqual(pub.tags, ['t']);

  const mem = shareSummary('members/a/shares/y.md', { id: 'y', author: 'a', visibility: 'members', encryptedBody: 'members/a/_enc/share-y-body.enc' }, 'SECRET PLAINTEXT');
  assert.equal(mem.body, '', 'a members Share body is never surfaced in the summary');
  assert.equal(mem.encryptedBody, 'members/a/_enc/share-y-body.enc');
});

test('byShareNewest: sorts newest-first, undated last', () => {
  const rows = [{ createdAt: '2026-01-01T00:00:00Z' }, { createdAt: null }, { createdAt: '2026-06-01T00:00:00Z' }];
  rows.sort(byShareNewest);
  assert.deepEqual(rows.map((r) => r.createdAt), ['2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z', null]);
});

test('listShares: requires identity', async () => {
  await assert.rejects(() => listShares({ identity: () => null, reader: { listShares: () => [] } }), (e) => e instanceof OperationError && e.code === 'no-identity');
});

test('listShares: delegates to the reader, awaits async, caps the limit', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}` }));
  // async reader (extension-style) returns a promise; the op must await it
  const asyncReader = { listShares: async (n) => items.slice(0, n) };
  const r = await listShares(ctxWith(asyncReader), { limit: 3 });
  assert.equal(r.items.length, 3);
  // sync reader (npm-style) returns an array directly; awaiting a non-promise is fine
  const syncReader = { listShares: (n) => items.slice(0, n) };
  assert.equal((await listShares(ctxWith(syncReader))).items.length, 5);
  // a reader without listShares -> empty, no throw
  assert.deepEqual((await listShares(ctxWith({}))).items, []);
});

test('repo-fs listShares: walks members/*/shares, published-only, newest-first, public body only', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-shares-'));
  const write = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), txt); };
  write('members/alice/shares/20260101000000-old.md', '---\ntype: share\nid: 20260101000000-old\nauthor: alice\nstatus: published\nvisibility: public\ncreatedAt: 2026-01-01T00:00:00Z\n---\n\nold public note\n');
  write('members/bob/shares/20260610000000-new.md', '---\ntype: share\nid: 20260610000000-new\nauthor: bob\nstatus: published\nvisibility: members\nencryptedBody: members/bob/_enc/share-20260610000000-new-body.enc\ncreatedAt: 2026-06-10T00:00:00Z\n---\n\n');
  write('members/alice/shares/20260605000000-draft.md', '---\ntype: share\nid: 20260605000000-draft\nauthor: alice\nstatus: draft\nvisibility: public\ncreatedAt: 2026-06-05T00:00:00Z\n---\n\ndraft, must not appear\n');

  const reader = createReader(repo);
  const items = reader.listShares();
  assert.equal(items.length, 2, 'the draft is excluded');
  assert.deepEqual(items.map((i) => i.id), ['20260610000000-new', '20260101000000-old'], 'newest-first');
  const mem = items.find((i) => i.visibility === 'members');
  assert.equal(mem.body, '', 'members Share carries no plaintext body');
  assert.equal(mem.encryptedBody, 'members/bob/_enc/share-20260610000000-new-body.enc');
  const pub = items.find((i) => i.visibility === 'public');
  assert.match(pub.body, /old public note/);
  fs.rmSync(repo, { recursive: true, force: true });
});

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const SHARE = (id, vis, created, body = '') =>
  `---\ntype: share\nid: ${id}\nauthor: a\nstatus: ${id.includes('draft') ? 'draft' : 'published'}\nvisibility: ${vis}\ncreatedAt: ${created}\n---\n\n${body}\n`;

test('github-reader listShares: one recursive tree call, newest-first by filename, drafts filtered', async () => {
  const tree = {
    tree: [
      { type: 'blob', path: 'members/a/posts/x/index.md' }, // not a share -> ignored
      { type: 'blob', path: 'members/a/shares/20260101000000-old.md' },
      { type: 'blob', path: 'members/b/shares/20260610000000-new.md' },
      { type: 'blob', path: 'members/a/shares/20260605000000-draft.md' },
      { type: 'tree', path: 'members/a/shares' }, // a tree node, not a blob -> ignored
    ],
  };
  const routes = [
    ['/git/trees/', { ok: true, json: async () => tree }],
    ['contents/members/a/shares/20260101000000-old.md', { ok: true, json: async () => ({ type: 'file', content: b64(SHARE('20260101000000-old', 'public', '2026-01-01T00:00:00Z', 'old note')) }) }],
    ['contents/members/b/shares/20260610000000-new.md', { ok: true, json: async () => ({ type: 'file', content: b64(SHARE('20260610000000-new', 'public', '2026-06-10T00:00:00Z', 'new note')) }) }],
    ['contents/members/a/shares/20260605000000-draft.md', { ok: true, json: async () => ({ type: 'file', content: b64(SHARE('20260605000000-draft', 'public', '2026-06-05T00:00:00Z', 'draft note')) }) }],
  ];
  let treeCalls = 0;
  const fetch = async (url) => {
    if (url.includes('/git/trees/')) treeCalls++;
    for (const [m, res] of routes) if (url.includes(m)) return res;
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const reader = createGithubReader({ upstream: 'gbti-network/gbti.network', token: 'tok', fetch });
  const items = await reader.listShares();
  assert.equal(treeCalls, 1, 'exactly one recursive tree call');
  assert.deepEqual(items.map((i) => i.id), ['20260610000000-new', '20260101000000-old'], 'newest-first, draft excluded');
});
