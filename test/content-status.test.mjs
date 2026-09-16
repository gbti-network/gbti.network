// SOW-106 Phase B: the member self-unpublish/republish (setOwnContentStatus) + the shared status-flip core.
// Own-folder guard, paid gate, fresh-read flip, idempotent no-op, and the network commit wiring. Fakes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flipContentStatus } from '../client/src/content-ops.mjs';
import { setOwnContentStatus, OperationError } from '../client/src/operations.mjs';

const FILE = '---\ntype: post\ntitle: X\nslug: x\nauthor: alice\nstatus: published\nvisibility: members\ncategories:\n  - devops\n---\n\nThe body.\n';

test('flipContentStatus flips ONLY status (visibility + fields survive) and no-ops when already there', () => {
  const down = flipContentStatus(FILE, 'draft');
  assert.equal(down.changed, true);
  assert.equal(down.current, 'published');
  assert.match(down.content, /status: draft/);
  assert.match(down.content, /visibility: members/);
  assert.match(down.content, /- devops/);
  assert.match(down.content, /The body\./);
  const same = flipContentStatus(FILE, 'published');
  assert.equal(same.changed, false);
  assert.equal(same.content, null);
});

// sow-274 Part 2: the flip goes to the network, so `net` records what reached it (POST /membership/author)
// in place of a fake fork's puts and pulls.
function network() {
  const authored = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (new URL(String(url)).pathname === '/membership/author') {
      authored.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true, number: 77, html_url: 'u', branch: `hosted/1/${body.itemId}` }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, authored, files: () => authored.flatMap((x) => x.files) };
}

function ctxFor({ username = 'alice', membership = 'paid', file = FILE, net = network() } = {}) {
  return {
    identity: () => ({ username }),
    getRepoClient: () => null, // a status flip needs no repository client at all
    membership: async () => membership,
    reader: { readFile: async (rel) => (rel.includes('/x/') ? file : null) },
    store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
    fetch: net.fetch,
  };
}

const PATH = 'members/alice/posts/x/index.md';

test('setOwnContentStatus: unpublish flips the own item to draft via the gated own-folder PR', async () => {
  const net = network();
  const r = await setOwnContentStatus(ctxFor({ net }), { path: PATH, status: 'draft' });
  assert.equal(r.ok, true);
  assert.equal(r.prNumber, 77);
  assert.equal(net.authored.length, 1);
  const [file] = net.files();
  assert.equal(file.path, PATH);
  assert.equal(net.authored[0].itemId, 'status-post-x');
  assert.match(file.content, /status: draft/);
  assert.match(file.content, /visibility: members/); // untouched
  assert.match(net.authored[0].title, /^Unpublish: x$/);
});

test('setOwnContentStatus: idempotent no-op (no PR) when already in the requested state', async () => {
  const net = network();
  const r = await setOwnContentStatus(ctxFor({ net }), { path: PATH, status: 'published' });
  assert.deepEqual(r, { ok: true, noop: true, status: 'published' });
  assert.equal(net.authored.length, 0);
});

test('setOwnContentStatus: guards — another member\'s path, a bad shape, a bad status, a non-paid member', async () => {
  const net = network();
  await assert.rejects(
    setOwnContentStatus(ctxFor({ net }), { path: 'members/bob/posts/x/index.md', status: 'draft' }),
    (e) => e instanceof OperationError && e.code === 'forbidden',
  );
  await assert.rejects(
    setOwnContentStatus(ctxFor({ net }), { path: 'house/roles.yml', status: 'draft' }),
    (e) => e instanceof OperationError && e.code === 'bad-request',
  );
  await assert.rejects(
    setOwnContentStatus(ctxFor({ net }), { path: PATH, status: 'hidden' }),
    (e) => e instanceof OperationError && e.code === 'bad-request',
  );
  await assert.rejects(
    setOwnContentStatus(ctxFor({ net, membership: 'trialing' }), { path: PATH, status: 'draft' }),
    (e) => e instanceof OperationError && e.code === 'membership-required',
  );
  assert.equal(net.authored.length, 0);
});

test('setOwnContentStatus: republish flips a drafted item back', async () => {
  const net = network();
  const drafted = FILE.replace('status: published', 'status: draft');
  const r = await setOwnContentStatus(ctxFor({ net, file: drafted }), { path: PATH, status: 'published' });
  assert.equal(r.ok, true);
  assert.match(net.files()[0].content, /status: published/);
  assert.match(net.authored[0].title, /^Republish: x$/);
});
