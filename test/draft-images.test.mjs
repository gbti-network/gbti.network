// The staged-image store (membership/draft-images.mjs + workers/signup/membership-draft-images.mjs).
//
// The defect it exists to close: a staged upload lived only in an in-memory Map in workbench-client.ts, so
// saving a draft persisted the image PATH and never the BYTES. After a reload the editor and the preview
// both resolved that path to a jsDelivr URL for a file that had never been committed, and publish silently
// dropped the missing binary and would have opened a PR whose frontmatter pointed at nothing.
//
// The key then carried no ITEM, only the file name, so two unpublished drafts that both staged a `cover.png`
// overwrote each other silently: the first item previewed the second's picture and published its bytes.
//
// Fake KV, stubbed authorizer: no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFT_IMAGE_MAX_BYTES, DRAFT_IMAGES_MAX_COUNT, DRAFT_IMAGES_MAX_TOTAL_BYTES,
  DraftImageError, draftImageKey, draftImagePrefix, legacyDraftImageKey, imageNameOf, itemTokenOf, contentTypeFor,
  validateDraftImage, checkDraftImageQuota,
} from '../membership/draft-images.mjs';
import { handleDraftImage, listStagedImages, eraseMemberDraftImages } from '../workers/signup/membership-draft-images.mjs';

// A fake KV with the two features the handler leans on: json values, and list() carrying key metadata.
function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  const meta = new Map();
  return {
    store, meta,
    async get(k, type) { const v = store.get(k); return v == null ? null : (type === 'json' && typeof v === 'string' ? JSON.parse(v) : v); },
    async put(k, v, opts) { store.set(k, v); if (opts?.metadata) meta.set(k, opts.metadata); },
    async delete(k) { store.delete(k); meta.delete(k); },
    async list({ prefix }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) }));
      return { keys, list_complete: true };
    },
  };
}
const b64 = (bytes) => Buffer.alloc(bytes, 7).toString('base64');
const ITEM = 'prompt:grok-skill';
const GET = (name, item = ITEM) => new Request(
  `https://signup.gbti.network/membership/draft-image?name=${encodeURIComponent(name ?? '')}${item ? `&item=${encodeURIComponent(item)}` : ''}`,
);
const POST = (body) => new Request('https://signup.gbti.network/membership/draft-image', { method: 'POST', body: JSON.stringify(body) });
const put = (name, bytes = 8, item = ITEM) => POST({ op: 'put', item, name, dataBase64: b64(bytes) });
const okAuth = (githubId = '10', login = 'alice') => async () => ({ ok: true, githubId, login, status: 'active' });
const denyAuth = async () => ({ ok: false, status: 401, body: { error: 'unauthorized' } });

test('the key is built from the authenticated id AND the item, so neither member nor draft can collide', () => {
  assert.equal(draftImageKey('10', 'post:hello', 'a.png'), 'draftimg:10:post:hello:a.png');
  assert.equal(draftImagePrefix('10'), 'draftimg:10:');
  assert.notEqual(draftImageKey('10', 'post:hello', 'a.png'), draftImageKey('20', 'post:hello', 'a.png'));
  // The whole point of the item segment: the same file name under two drafts is two different keys.
  assert.notEqual(draftImageKey('10', 'post:hello', 'cover.png'), draftImageKey('10', 'post:other', 'cover.png'));
  // Both live under the member's own prefix, so one list()/erase still reaches everything they hold.
  for (const k of [draftImageKey('10', 'post:hello', 'a.png'), legacyDraftImageKey('10', 'a.png')]) {
    assert.ok(k.startsWith(draftImagePrefix('10')), `${k} must sit under the member prefix`);
  }
});

test('itemTokenOf admits only a real <type>:<slug>, so the key cannot be widened by input', () => {
  assert.equal(itemTokenOf('post:hello-world'), 'post:hello-world');
  assert.equal(itemTokenOf('PROMPT:Grok-Skill'), 'prompt:grok-skill');
  for (const bad of ['', null, 'post:', ':hello', 'article:hello', 'post:Hello World', 'post:hello:extra',
    'post:../../etc', 'post:hello/world', `post:${'x'.repeat(81)}`]) {
    assert.equal(itemTokenOf(bad), null, `${JSON.stringify(bad)} must be refused`);
  }
});

test('a traversal attempt cannot escape the member prefix, and an svg is refused outright', () => {
  // sanitizeImageName keeps only the last path segment, so the worst a caller achieves is an odd file name
  // INSIDE their own prefix. There is no path to reject because a path cannot be expressed.
  assert.equal(imageNameOf('../../../etc/passwd.png'), 'passwd.png');
  assert.equal(draftImageKey('10', 'post:x', imageNameOf('..\\..\\win.png')), 'draftimg:10:post:x:win.png');
  assert.equal(imageNameOf('payload.svg'), null);
  assert.equal(imageNameOf('no-extension'), null);
  assert.equal(imageNameOf(''), null);
});

test('validateDraftImage refuses an oversized image at the documented 1 MB line', () => {
  assert.equal(DRAFT_IMAGE_MAX_BYTES, 1_048_576);
  assert.deepEqual(validateDraftImage({ name: 'Shot 1.PNG', dataBase64: b64(10) }), { name: 'shot-1.png', bytes: 10 });
  assert.throws(() => validateDraftImage({ name: 'a.png', dataBase64: '' }), DraftImageError);
  assert.throws(() => validateDraftImage({ name: 'a.png', dataBase64: b64(DRAFT_IMAGE_MAX_BYTES + 1) }), DraftImageError);
  // Exactly at the cap is allowed: the check is "over", not "at or over".
  assert.equal(validateDraftImage({ name: 'a.png', dataBase64: b64(DRAFT_IMAGE_MAX_BYTES) }).bytes, DRAFT_IMAGE_MAX_BYTES);
});

test('re-staging the same image is a replacement, but the same name under another draft is not', () => {
  const existing = Array.from({ length: DRAFT_IMAGES_MAX_COUNT }, (_, i) => ({ id: `post:p${i}:f.png`, bytes: 10 }));
  // At the count cap, replacing one that is already there still succeeds...
  assert.doesNotThrow(() => checkDraftImageQuota(existing, { id: 'post:p0:f.png', bytes: 20 }));
  // ...while adding a new one does not.
  assert.throws(() => checkDraftImageQuota(existing, { id: 'post:new:f.png', bytes: 20 }), DraftImageError);
  // The identity is item + name, not the bare file name: same name, different draft, is a NEW image.
  assert.throws(() => checkDraftImageQuota(existing, { id: 'post:p0:other.png', bytes: 20 }), DraftImageError);
  // And the replaced image's old size leaves the total, or repeated replacement would fill the store.
  const big = [{ id: 'post:a:a.png', bytes: DRAFT_IMAGES_MAX_TOTAL_BYTES - 10 }];
  assert.doesNotThrow(() => checkDraftImageQuota(big, { id: 'post:a:a.png', bytes: DRAFT_IMAGES_MAX_TOTAL_BYTES - 10 }));
  assert.throws(() => checkDraftImageQuota(big, { id: 'post:a:b.png', bytes: 1000 }), DraftImageError);
});

test('contentTypeFor covers every extension the name validator admits', () => {
  for (const [n, t] of [['a.png', 'image/png'], ['a.jpg', 'image/jpeg'], ['a.jpeg', 'image/jpeg'], ['a.webp', 'image/webp'], ['a.gif', 'image/gif']]) {
    assert.equal(contentTypeFor(n), t);
    assert.ok(imageNameOf(n), `${n} must be an admissible name, or this row tests nothing`);
  }
});

test('put then get round-trips the bytes for the owner', async () => {
  const kv = fakeKv();
  const res = await handleDraftImage(put('shot.png', 64), {}, { kv, authorize: okAuth(), now: () => 1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'shot.png');
  assert.equal(res.body.bytes, 64);
  assert.ok(kv.store.has(`draftimg:10:${ITEM}:shot.png`), 'the write must be item-scoped');
  const got = await handleDraftImage(GET('shot.png'), {}, { kv, authorize: okAuth() });
  assert.equal(got.status, 200);
  assert.equal(got.body.dataBase64, b64(64));
  assert.equal(got.body.contentType, 'image/png');
});

test('a put with no valid item is refused, because that is what reopens the cross-draft collision', async () => {
  const kv = fakeKv();
  for (const bad of [undefined, '', 'not-a-token', 'article:x']) {
    const r = await handleDraftImage(POST({ op: 'put', item: bad, name: 'a.png', dataBase64: b64(8) }), {}, { kv, authorize: okAuth() });
    assert.equal(r.status, 400, `item ${JSON.stringify(bad)} must be refused`);
    assert.equal(r.body.error, 'bad_request');
  }
  assert.equal(kv.store.size, 0, 'a refused put must not write');
});

test('two drafts staging the SAME file name do not overwrite each other', async () => {
  const kv = fakeKv();
  await handleDraftImage(put('cover.png', 11, 'post:alpha'), {}, { kv, authorize: okAuth('10') });
  await handleDraftImage(put('cover.png', 22, 'post:beta'), {}, { kv, authorize: okAuth('10') });
  const alpha = await handleDraftImage(GET('cover.png', 'post:alpha'), {}, { kv, authorize: okAuth('10') });
  const beta = await handleDraftImage(GET('cover.png', 'post:beta'), {}, { kv, authorize: okAuth('10') });
  assert.equal(alpha.body.dataBase64, b64(11), 'the first draft must still hold its own picture');
  assert.equal(beta.body.dataBase64, b64(22));
  assert.equal((await listStagedImages(kv, '10')).length, 2, 'they are two images, not one replaced twice');
});

test('a read falls back to the pre-item key, so an in-flight draft does not lose its image', async () => {
  // The shape written before the item segment shipped. Nothing writes it any more; a READ must still find it
  // or an author mid-edit would watch their picture vanish on the day this deployed.
  const kv = fakeKv({ 'draftimg:10:legacy.png': JSON.stringify({ dataBase64: b64(5), contentType: 'image/png', bytes: 5 }) });
  const got = await handleDraftImage(GET('legacy.png'), {}, { kv, authorize: okAuth('10') });
  assert.equal(got.status, 200);
  assert.equal(got.body.dataBase64, b64(5));
  // Still scoped to the member: another account does not reach it.
  assert.equal((await handleDraftImage(GET('legacy.png'), {}, { kv, authorize: okAuth('20') })).status, 404);
});

test('another member reading the same name gets a miss, not the owner\'s image', async () => {
  const kv = fakeKv();
  await handleDraftImage(put('shot.png', 64), {}, { kv, authorize: okAuth('10', 'alice') });
  const other = await handleDraftImage(GET('shot.png'), {}, { kv, authorize: okAuth('20', 'bob') });
  assert.equal(other.status, 404);
  assert.equal(other.body.error, 'not_found');
});

test('a miss is a plain 404, because "not staged" is the normal steady state after publish', async () => {
  const kv = fakeKv();
  const got = await handleDraftImage(GET('never.png'), {}, { kv, authorize: okAuth() });
  assert.equal(got.status, 404);
  // The caller is expected to fall back to the CDN on this, so it must not read as a failure.
  assert.equal(got.body.error, 'not_found');
});

test('the route is closed to an unauthenticated caller and to a banned account', async () => {
  const kv = fakeKv();
  const r = await handleDraftImage(GET('shot.png'), {}, { kv, authorize: denyAuth });
  assert.equal(r.status, 401);
  // authorizeMember itself denies banned; assert the handler surfaces the authorizer verdict untouched.
  const banned = await handleDraftImage(put('a.png', 4), {},
    { kv, authorize: async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'this account is not permitted' } }) });
  assert.equal(banned.status, 403);
  assert.equal(kv.store.size, 0, 'a denied put must not write');
});

test('delete removes it, and erasure removes every one the member holds, both key shapes', async () => {
  const kv = fakeKv({ 'draftimg:10:old.png': JSON.stringify({ dataBase64: b64(3), contentType: 'image/png', bytes: 3 }) });
  for (const n of ['a.png', 'b.png', 'c.png']) {
    await handleDraftImage(put(n, 8), {}, { kv, authorize: okAuth('10') });
  }
  await handleDraftImage(put('other.png', 8), {}, { kv, authorize: okAuth('20') });
  assert.equal((await listStagedImages(kv, '10')).length, 4, 'three item-scoped plus the pre-item one');

  const del = await handleDraftImage(POST({ op: 'delete', item: ITEM, name: 'b.png' }), {}, { kv, authorize: okAuth('10') });
  assert.equal(del.status, 200);
  assert.equal((await listStagedImages(kv, '10')).length, 3);

  const erased = await eraseMemberDraftImages({}, '10', { kv });
  assert.equal(erased.ok, true);
  assert.equal(erased.deleted, 3);
  assert.equal((await listStagedImages(kv, '10')).length, 0, 'erasure must reach the pre-item key too');
  // The other member is untouched: erasure is prefix-scoped, not a store wipe.
  assert.equal((await listStagedImages(kv, '20')).length, 1);
});

test('the COUNT quota is enforced through the route, not only in the helper', async () => {
  // Deliberately separate from the size case below. An oversized image is refused by validateDraftImage, so
  // a test that only sends a huge file passes even with the quota call deleted from the handler: that is
  // exactly what the first version of this file did, and the mutation run caught it.
  const kv = fakeKv();
  for (let i = 0; i < DRAFT_IMAGES_MAX_COUNT; i++) {
    const r = await handleDraftImage(put(`f${i}.png`, 8), {}, { kv, authorize: okAuth() });
    assert.equal(r.status, 200, `image ${i} should fit under the cap`);
  }
  const over = await handleDraftImage(put('one-too-many.png', 8), {}, { kv, authorize: okAuth() });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, 'invalid');
  assert.match(over.body.message, /staged image limit reached/);
  assert.equal(kv.store.size, DRAFT_IMAGES_MAX_COUNT, 'the refused image must not be written');
  // Replacing one that is already there still works at the cap.
  const replace = await handleDraftImage(put('f0.png', 9), {}, { kv, authorize: okAuth() });
  assert.equal(replace.status, 200);
});

test('the SIZE cap is enforced through the route, not only in the helper', async () => {
  const kv = fakeKv();
  const r = await handleDraftImage(put('huge.png', DRAFT_IMAGE_MAX_BYTES + 1), {}, { kv, authorize: okAuth() });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid');
  assert.match(r.body.message, /over 1 MB/);
  assert.equal(kv.store.size, 0, 'a refused image must not be written');
});

test('listStagedImages totals from key metadata, so the quota never fetches image bodies', async () => {
  const kv = fakeKv();
  await handleDraftImage(put('a.png', 1234), {}, { kv, authorize: okAuth('10') });
  const listed = await listStagedImages(kv, '10');
  assert.deepEqual(listed, [{ key: `draftimg:10:${ITEM}:a.png`, id: `${ITEM}:a.png`, bytes: 1234 }]);
  // Prove the size really came from metadata rather than from parsing the value.
  assert.equal(kv.meta.get(`draftimg:10:${ITEM}:a.png`).bytes, 1234);
});

test('a bad op and a bad method are refused', async () => {
  const kv = fakeKv();
  assert.equal((await handleDraftImage(POST({ op: 'nope' }), {}, { kv, authorize: okAuth() })).status, 400);
  const bad = new Request('https://signup.gbti.network/membership/draft-image', { method: 'PUT' });
  assert.equal((await handleDraftImage(bad, {}, { kv, authorize: okAuth() })).status, 405);
  assert.equal((await handleDraftImage(GET('a.png'), {}, { kv: null, authorize: okAuth() })).status, 500);
});
