// sow-304, the npm host half: the reader lists ONE member's shares (drafts included, newest first, members bodies
// pointer-only), the myShares operation scopes it to the signed-in identity, and the api route exists. The
// same injectable-fetch fake the reader's other tests use; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGithubReader } from '../client/src/github-reader.mjs';
import { myShares } from '../client/src/operations-read.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const fileRes = (text) => ({ ok: true, json: async () => ({ type: 'file', content: b64(text) }) });
const notFound = { ok: false, status: 404, json: async () => ({}) };
const share = ({ id, author, visibility = 'members', status = 'published', enc = null, body = 'note' }) =>
  `---\ntype: share\nid: "${id}"\nauthor: ${author}\nvisibility: ${visibility}\nstatus: ${status}\ncreatedAt: "2026-0${id[5]}-01T00:00:00Z"\n${enc ? `encryptedBody: ${enc}\n` : ''}---\n\n${visibility === 'members' ? '' : body}\n`;
const TREE = ['members/alice/shares/2026-1-old.md', 'members/alice/shares/2026-3-new.md', 'members/alice/shares/2026-2-draft.md', 'members/bob/shares/2026-4-bobs.md', 'members/alice/posts/x/index.md'];

function readerWith(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(url);
    if (url.includes('/git/trees/')) return { ok: true, json: async () => ({ tree: TREE.map((path) => ({ path, type: 'blob' })) }) };
    for (const [match, res] of routes) if (url.includes(match)) return res;
    return notFound;
  };
  return { reader: createGithubReader({ upstream: 'gbti-network/gbti.network', token: 'tok', fetch }), calls };
}
const routes = [
  ['contents/members/alice/shares/2026-1-old.md', fileRes(share({ id: '2026-1-old', author: 'alice', visibility: 'public', body: 'old note' }))],
  ['contents/members/alice/shares/2026-3-new.md', fileRes(share({ id: '2026-3-new', author: 'alice', enc: 'members/alice/_enc/share-2026-3-new-body.enc' }))],
  ['contents/members/alice/shares/2026-2-draft.md', fileRes(share({ id: '2026-2-draft', author: 'alice', visibility: 'public', status: 'draft', body: 'removed' }))],
  ['contents/members/bob/shares/2026-4-bobs.md', fileRes(share({ id: '2026-4-bobs', author: 'bob', visibility: 'public' }))],
];

test('listMemberShares: one member, newest first, drafts INCLUDED, members body pointer-only, never another folder', async () => {
  const { reader, calls } = readerWith(routes);
  const items = await reader.listMemberShares('alice');
  assert.deepEqual(items.map((s) => s.id), ['2026-3-new', '2026-2-draft', '2026-1-old']);
  assert.deepEqual(items.map((s) => s.status), ['published', 'draft', 'published']);
  const members = items.find((s) => s.id === '2026-3-new');
  assert.equal(members.body, '');
  assert.equal(members.encryptedBody, 'members/alice/_enc/share-2026-3-new-body.enc');
  assert.equal(items.find((s) => s.id === '2026-1-old').body.trim(), 'old note', 'a public body travels (parseContentFile keeps the trailing newline)');
  assert.ok(!calls.some((u) => u.includes('members/bob/')), 'bob\'s folder is never read');
  assert.ok(!calls.some((u) => u.includes('members/alice/posts')), 'only the shares folder');
});

test('listMemberShares: an off-shape username or a member with no shares reads nothing', async () => {
  const { reader, calls } = readerWith(routes);
  assert.deepEqual(await reader.listMemberShares('../alice'), []);
  assert.equal(calls.length, 0);
  assert.deepEqual(await reader.listMemberShares('nobody'), []);
});

test('myShares scopes the list to the signed-in identity and needs one', async () => {
  const { reader } = readerWith(routes);
  const r = await myShares({ identity: () => ({ username: 'alice' }), reader });
  assert.deepEqual(r.items.map((s) => s.id), ['2026-3-new', '2026-2-draft', '2026-1-old']);
  await assert.rejects(() => myShares({ identity: () => null, reader }), /no signed-in identity/);
  assert.deepEqual(await myShares({ identity: () => ({ username: 'alice' }), reader: {} }), { items: [] }, 'a reader without the method degrades to empty');
});

test('the npm api serves GET /api/my-shares and the client-ui transport calls it', () => {
  const api = fs.readFileSync(new URL('../client/src/api.mjs', import.meta.url), 'utf8');
  assert.match(api, /pathname === '\/api\/my-shares'\) return run\(\(\) => myShares\(ctx\)\)/);
  const client = fs.readFileSync(new URL('../client-ui/src/client.mjs', import.meta.url), 'utf8');
  assert.match(client, /myShares: \(\) => request\('GET', '\/api\/my-shares'\)/);
});
