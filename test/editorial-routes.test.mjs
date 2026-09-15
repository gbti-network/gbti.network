// sow-323 Phase 3: the review queue's Worker ROUTES, and the two ORDERS that make them safe.
//
// The orders are the only interesting thing here, and neither can be asserted without observing both halves:
//   - the queue record is written BEFORE the publish opens its pull request, so an item is never waiting with
//     nothing to list it;
//   - the approval is COMMITTED before the record is marked approved, so a failure between the halves leaves
//     the item waiting rather than marked approved with nothing published.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialList, editorialDecide, buildApproval } from '../workers/signup/membership-editorial.mjs';
import { recordEditorialItems, removeEditorialItems } from '../workers/signup/editorial-records.mjs';
import { editorialKey, newEntry, decideEntry, EDITORIAL_STATE } from '../membership/editorial-queue.mjs';
import { encryptAsset } from '../client/src/crypto-assets.mjs';

const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes, base64: a test key, never a real one
const NOW = new Date('2026-09-15T12:00:00.000Z');
const PATH = 'members/ada/posts/hello/index.md';
const ENC = 'members/ada/_enc/post-hello-body.enc';

/** A KV double that records the ORDER of everything done to it, which is what these tests are about. */
function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  const log = [];
  return {
    log,
    store,
    async get(k) { log.push(`get ${k}`); return store.has(k) ? JSON.parse(store.get(k)) : null; },
    async put(k, v) { log.push(`put ${k}`); store.set(k, v); },
    async delete(k) { log.push(`delete ${k}`); store.delete(k); },
    async list({ prefix, cursor }) {
      void cursor;
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const req = (body = {}) => new Request('https://x/membership/admin/editorial', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const superadmin = async () => ({ ok: true, githubId: '9', role: 'superadmin' });
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'superadmin access is required' } });

test('both routes are superadmin only, and a denial never touches the store', async () => {
  const kv = fakeKv();
  const env = { SIGNUP_KV: kv };
  const list = await editorialList(new Request('https://x/membership/admin/editorial'), env, { authorize: denied });
  assert.equal(list.status, 403);
  const decide = await editorialDecide(req({ path: PATH, decision: 'approve' }), env, { authorize: denied });
  assert.equal(decide.status, 403);
  assert.deepEqual(kv.log, [], 'an unauthorized caller must not reach the store at all');
});

test('a corrupt record lists as unknown, is flagged, and cannot be decided', async () => {
  const kv = fakeKv({ [editorialKey(PATH)]: JSON.stringify({ nonsense: true }) });
  const env = { SIGNUP_KV: kv };
  const list = await editorialList(new Request('https://x/'), env, { authorize: superadmin });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].state, EDITORIAL_STATE.unknown);
  assert.equal(list.body.items[0].corrupt, true);
  assert.equal(list.body.items[0].path, PATH, 'the KV key travels with it, or a broken record cannot be found');

  const decide = await editorialDecide(req({ path: PATH, decision: 'approve' }), env, { authorize: superadmin, now: NOW });
  assert.equal(decide.status, 409);
  assert.equal(decide.body.error, 'corrupt', 'approving a corrupt record would publish whatever it names');
});

test('dismiss is silent: it writes the record and does nothing else', async () => {
  const rec = newEntry({ path: PATH, type: 'post', slug: 'hello', login: 'ada', githubId: '1', title: 'Hello', now: NOW });
  const kv = fakeKv({ [editorialKey(PATH)]: JSON.stringify(rec) });
  let notified = 0;
  const calls = [];
  const r = await editorialDecide(req({ path: PATH, decision: 'dismiss' }), { SIGNUP_KV: kv }, {
    authorize: superadmin, now: NOW,
    fetchImpl: async (url) => { calls.push(url); return { ok: false, status: 500 }; },
    notifyAuthor: () => { notified += 1; },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.state, EDITORIAL_STATE.dismissed);
  assert.deepEqual(calls, [], 'a dismissal must never reach GitHub: the item stays exactly where it is');
  assert.equal(notified, 0, 'the author is not told about a dismissal (owner, 2026-09-15)');
  assert.equal(JSON.parse(kv.store.get(editorialKey(PATH))).state, EDITORIAL_STATE.dismissed);
});

test('dismissing something that is not waiting is refused', async () => {
  const kv = fakeKv();
  assert.equal((await editorialDecide(req({ path: PATH, decision: 'dismiss' }), { SIGNUP_KV: kv }, { authorize: superadmin })).status, 404);
  const approved = decideEntry(newEntry({ path: PATH, type: 'post', slug: 'hello', login: 'ada', githubId: '1', title: 'T', now: NOW }),
    { decision: 'approve', githubId: '9', now: NOW });
  const kv2 = fakeKv({ [editorialKey(PATH)]: JSON.stringify(approved) });
  assert.equal((await editorialDecide(req({ path: PATH, decision: 'dismiss' }), { SIGNUP_KV: kv2 }, { authorize: superadmin })).status, 409);
});

test('the decision reads the item from the PATH, so nothing else in the body can retarget it', async () => {
  const kv = fakeKv();
  for (const path of ['members/ada/shares/2026-09-15-s.md', 'house/posts/x/index.md', '../../etc/passwd', '']) {
    const r = await editorialDecide(req({ path, decision: 'approve', type: 'post', slug: 'hello', login: 'ada' }), { SIGNUP_KV: kv }, { authorize: superadmin });
    assert.equal(r.status, 400, path);
  }
  assert.equal((await editorialDecide(req({ path: PATH, decision: 'delete-everything' }), { SIGNUP_KV: kv }, { authorize: superadmin })).status, 400);
});

test('an item that has not merged yet answers "still merging" rather than publishing nothing', async () => {
  const rec = newEntry({ path: PATH, type: 'post', slug: 'hello', login: 'ada', githubId: '1', title: 'Hello', now: NOW });
  const kv = fakeKv({ [editorialKey(PATH)]: JSON.stringify(rec) });
  const r = await editorialDecide(req({ path: PATH, decision: 'approve' }), { SIGNUP_KV: kv, MEMBER_CONTENT_KEY: KEY }, {
    authorize: superadmin, now: NOW,
    getToken: async () => 't',
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }),
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not_on_main');
  assert.equal(JSON.parse(kv.store.get(editorialKey(PATH))).state, EDITORIAL_STATE.pending,
    'a failed approval must leave the item waiting, not mark it approved with nothing published');
});

test('APPROVE COMMITS BEFORE IT RECORDS, and tells the author only after the record is stored', async () => {
  const rec = newEntry({ path: PATH, type: 'post', slug: 'hello', login: 'ada', githubId: '1', title: 'Hello', now: NOW });
  const kv = fakeKv({ [editorialKey(PATH)]: JSON.stringify(rec) });
  const order = [];
  const envelope = await encryptAsset({ plaintext: 'The whole article.', key: KEY, assetId: 'post:hello:body', kid: '1' });
  const index = `---\ntitle: Hello\nvisibility: members\npublicStub: true\nencryptedBody: ${ENC}\npublishedAt: 2026-01-01\n---\n\n`;
  const written = [];

  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url.includes(`contents/${PATH}?ref=main`)) { order.push('read index'); return { ok: true, status: 200, text: async () => index }; }
    if (url.includes(`contents/${ENC}?ref=main`)) { order.push('read enc'); return { ok: true, status: 200, text: async () => JSON.stringify(envelope) }; }
    if (url.endsWith('git/ref/heads/main')) return { ok: true, status: 200, json: async () => ({ object: { sha: 'deadbeef' } }) };
    if (url.endsWith('git/refs') && method === 'POST') { order.push('branch'); return { ok: true, status: 201, json: async () => ({}) }; }
    // applyFile reads the file on the BRANCH first, for its sha. Both files exist there (the branch is a fresh
    // copy of main), and answering 404 here would silently turn the ciphertext delete into a no-op: that is
    // exactly the orphaned-.enc defect this approval path exists to fix, so the stub has to be faithful.
    if (url.includes('/contents/') && method === 'GET') return { ok: true, status: 200, json: async () => ({ sha: 'filesha' }) };
    if (url.includes('/contents/')) {
      const path = decodeURIComponent(url.split('/contents/')[1]);
      order.push(`${method === 'DELETE' ? 'delete' : 'write'} ${path}`);
      written.push({ path, method, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.endsWith('/pulls')) { order.push('pull request'); return { ok: true, status: 201, json: async () => ({ number: 7, html_url: 'https://x/7' }) }; }
    throw new Error(`unexpected call: ${method} ${url}`);
  };

  const r = await editorialDecide(req({ path: PATH, decision: 'approve' }), { SIGNUP_KV: kv, MEMBER_CONTENT_KEY: KEY }, {
    authorize: superadmin, now: NOW, fetchImpl,
    getToken: async () => 't',
    notifyAuthor: (record) => {
      order.push('email author');
      assert.equal(record.state, EDITORIAL_STATE.approved);
      assert.equal(JSON.parse(kv.store.get(editorialKey(PATH))).state, EDITORIAL_STATE.approved,
        'the author is told only once the decision is stored; a lost email must cost the news, never the approval');
    },
  });

  assert.equal(r.status, 200);
  assert.equal(r.body.number, 7);
  assert.ok(order.indexOf('pull request') < order.indexOf('email author'), 'the commit comes before the author is told');
  const recordWrite = kv.log.findIndex((l) => l === `put ${editorialKey(PATH)}`);
  assert.ok(recordWrite >= 0, 'the decision must be stored');
  assert.equal(JSON.parse(kv.store.get(editorialKey(PATH))).decidedBy, '9');

  // The commit itself: public, no locked-page flag, no orphaned ciphertext, the original date kept.
  const indexWrite = written.find((w) => w.path === PATH);
  const body = Buffer.from(indexWrite.body.content, 'base64').toString('utf8');
  assert.match(body, /visibility: public/);
  assert.doesNotMatch(body, /publicStub/, 'validate-content refuses publicStub beside public');
  assert.doesNotMatch(body, /encryptedBody/);
  assert.match(body, /publishedAt: '?2026-01-01'?/, 'an approved item keeps its original date');
  assert.match(body, /The whole article\./, 'the members-only body becomes the public body');
  assert.ok(written.some((w) => w.path === ENC && w.method === 'DELETE'),
    'the stale ciphertext is DELETED rather than orphaned; leaving it is one of the three defects this replaces');
});

test('a FAILED commit leaves the item waiting, and never marks it approved', async () => {
  // The half the ordering exists for. If the commit fails and the record is written anyway, the queue stops
  // listing an item that was never published, and nothing anywhere would ever say so again.
  const rec = newEntry({ path: PATH, type: 'post', slug: 'hello', login: 'ada', githubId: '1', title: 'Hello', now: NOW });
  const kv = fakeKv({ [editorialKey(PATH)]: JSON.stringify(rec) });
  let notified = 0;
  const index = '---\ntitle: Hello\nvisibility: members\n---\n\nThe body.\n';
  const r = await editorialDecide(req({ path: PATH, decision: 'approve' }), { SIGNUP_KV: kv, MEMBER_CONTENT_KEY: KEY }, {
    authorize: superadmin, now: NOW, getToken: async () => 't',
    notifyAuthor: () => { notified += 1; },
    fetchImpl: async (url, init = {}) => {
      if (url.includes(`contents/${PATH}?ref=main`)) return { ok: true, status: 200, text: async () => index };
      if (url.endsWith('git/ref/heads/main')) return { ok: true, status: 200, json: async () => ({ object: { sha: 'deadbeef' } }) };
      if (url.endsWith('git/refs') && (init.method || 'GET') === 'POST') return { ok: false, status: 500, json: async () => ({}) };
      throw new Error(`unexpected call: ${url}`);
    },
  });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'git_failed');
  assert.equal(JSON.parse(kv.store.get(editorialKey(PATH))).state, EDITORIAL_STATE.pending,
    'nothing was published, so the item must still be waiting');
  assert.equal(notified, 0, 'and its author must not be told it went live');
});

test('a members-only section keeps its gate, and a ciphertext stored elsewhere is not left behind', async () => {
  // The re-encrypted section is written under the canonical path for the item. When the stored path differs,
  // the old file has to be deleted too, or approval leaves an unreferenced ciphertext in a public repository.
  const stale = 'members/ada/_enc/post-oldname-body.enc';
  const envelope = await encryptAsset({ plaintext: 'The paid half.', key: KEY, assetId: 'post:hello:body', kid: '1' });
  const index = `---\ntitle: Hello\nvisibility: members\npublicStub: true\nencryptedBody: ${stale}\n---\n\nTeaser.\n\n<!-- members-only -->\n\nThe paid half.\n`;
  const built = await buildApproval({ MEMBER_CONTENT_KEY: KEY, MEMBER_CONTENT_KID: '1' }, {
    item: { path: PATH, type: 'post', slug: 'hello', login: 'ada' }, indexText: index, encText: JSON.stringify(envelope),
  });
  assert.ok(!built.error, built.error);
  const paths = built.files.map((f) => f.path);
  assert.ok(paths.includes(ENC), 'the section is re-encrypted under the canonical path for this item');
  assert.deepEqual(built.files.find((f) => f.path === stale), { path: stale, content: null },
    'the ciphertext at the old path must be deleted, not orphaned');
  const md = built.files.find((f) => f.path === PATH).content;
  assert.match(md, /visibility: public/);
  assert.match(md, new RegExp(`encryptedBody: ${ENC}`), 'and the file must point at the new one');
  assert.doesNotMatch(md, /The paid half/, 'the gated half must not be written into the public file');
});

test('an approval with no record still works, and an already-public item says so without committing', async () => {
  // A superadmin's own members-only item never entered the queue, so approval has to work with nothing stored.
  const kv = fakeKv();
  const index = '---\ntitle: Hello\nvisibility: public\n---\n\nBody.\n';
  let pulls = 0;
  const r = await editorialDecide(req({ path: PATH, decision: 'approve' }), { SIGNUP_KV: kv, MEMBER_CONTENT_KEY: KEY }, {
    authorize: superadmin, now: NOW,
    getToken: async () => 't',
    fetchImpl: async (url) => {
      if (url.includes(`contents/${PATH}?ref=main`)) return { ok: true, status: 200, text: async () => index };
      if (url.endsWith('/pulls')) { pulls += 1; return { ok: true, status: 201, json: async () => ({}) }; }
      throw new Error(`unexpected call: ${url}`);
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.alreadyPublic, true);
  assert.equal(pulls, 0, 'an item that is already public needs no commit');
  assert.equal(JSON.parse(kv.store.get(editorialKey(PATH))).state, EDITORIAL_STATE.approved);
});

test('an undecryptable members-only body refuses the approval instead of publishing a stub', async () => {
  const index = `---\ntitle: Hello\nvisibility: members\nencryptedBody: ${ENC}\n---\n\nTeaser.\n`;
  const wrongKey = await encryptAsset({ plaintext: 'secret', key: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA=', assetId: 'post:hello:body', kid: '1' });
  const built = await buildApproval({ MEMBER_CONTENT_KEY: KEY }, {
    item: { path: PATH, type: 'post', slug: 'hello', login: 'ada' }, indexText: index, encText: JSON.stringify(wrongKey),
  });
  assert.ok(built.error, 'publishing the teaser alone would silently drop the body the member wrote');
  assert.ok(!/secret/.test(built.error), 'an error message must never carry plaintext');
});

// ---- the record write on the publish path ------------------------------------------------------------

test('a record is written per item, and only a NEW one is worth emailing about', async () => {
  const kv = fakeKv();
  const items = [{ path: PATH, type: 'post', slug: 'hello', login: 'ada', title: 'Hello' }];
  const first = await recordEditorialItems(kv, items, { githubId: '1', now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.fresh.length, 1, 'the owner is told the first time');

  const again = await recordEditorialItems(kv, items, { githubId: '1', now: new Date('2026-09-16T00:00:00.000Z') });
  assert.equal(again.ok, true);
  assert.equal(again.fresh.length, 0, 'an edit to something already waiting must not mail the owner again');
  assert.equal(again.entries[0].state, EDITORIAL_STATE.pending);

  // A revision of a DISMISSED item returns to the queue quietly: the owner already set it aside once.
  kv.store.set(editorialKey(PATH), JSON.stringify(decideEntry(JSON.parse(kv.store.get(editorialKey(PATH))), { decision: 'dismiss', githubId: '9', now: NOW })));
  const revised = await recordEditorialItems(kv, items, { githubId: '1', now: new Date('2026-09-17T00:00:00.000Z') });
  assert.equal(revised.entries[0].state, EDITORIAL_STATE.pending);
  assert.equal(revised.entries[0].editedSinceDecision, true);
  assert.equal(revised.fresh.length, 0, 'a revision of something set aside does not mail the owner again');
});

test('a failed record write reports failure, so the publish can refuse', async () => {
  const kv = fakeKv();
  kv.put = async () => { throw new Error('KV down'); };
  const r = await recordEditorialItems(kv, [{ path: PATH, type: 'post', slug: 'hello', login: 'ada', title: 'Hello' }], { githubId: '1', now: NOW });
  assert.equal(r.ok, false, 'a publish that merges with no record is an item waiting that nothing lists');
});

test('deleting an item retires its record, and a non-item path is ignored', async () => {
  const kv = fakeKv({ [editorialKey(PATH)]: JSON.stringify(newEntry({ path: PATH, type: 'post', slug: 'hello', login: 'ada', githubId: '1', title: 'T', now: NOW })) });
  const r = await removeEditorialItems(kv, [PATH, 'members/ada/posts/hello/images/a.png', 'house/x.yml']);
  assert.equal(r.removed, 1);
  assert.equal(kv.store.has(editorialKey(PATH)), false);
});
