// sow-427 B2: KV access for prepared listings (workers/signup/prepared-store.mjs). An in-memory KV with the four
// methods the Worker binding has, plus a paged list, so the cursor loop is exercised rather than assumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readListing, writeListing, deleteListing, listListingIds, listListings, readListingImage, putListingImage,
  listListingImages, deleteListingImages, deleteListingImageNames, readListingImageMap, readStagedImage,
  collectListingImages, imageBytesOf, writeCollectedImages, deleteStagedCopies,
} from '../workers/signup/prepared-store.mjs';
import { draftImageKey, legacyDraftImageKey, DRAFT_IMAGE_MAX_BYTES } from '../membership/draft-images.mjs';

const ID = 'ABCDEFGHJKMNPQRS';
const ID2 = 'SRQPNMKJHGFEDCBA';
const ME = '2002207';
const b64 = (n) => Buffer.alloc(n, 7).toString('base64');

/** A KV fake. `pageSize` makes list() page, so a caller that reads only the first page is caught. */
function fakeKv(seed = {}, { pageSize = 1000, failPut = null, failList = false, failGet = null } = {}) {
  const store = new Map(Object.entries(seed));
  const meta = new Map();
  const gets = [];
  return {
    store, meta, gets,
    async get(key, type) {
      gets.push(key);
      if (failGet && failGet(key)) throw new Error('kv get failed');
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value, opts = {}) {
      if (failPut && failPut(key)) throw new Error('kv put failed');
      store.set(key, value);
      if (opts.metadata) meta.set(key, opts.metadata);
    },
    async delete(key) { store.delete(key); meta.delete(key); },
    async list({ prefix, cursor }) {
      if (failList) throw new Error('kv list failed');
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const keys = all.slice(start, start + pageSize).map((name) => ({ name, metadata: meta.get(name) }));
      const next = start + pageSize;
      return next >= all.length ? { keys, list_complete: true } : { keys, list_complete: false, cursor: String(next) };
    },
  };
}

test('a listing round-trips, and a malformed id is refused at every entry point', async () => {
  const kv = fakeKv();
  const rec = { id: ID, type: 'project', slug: 'surfacedby' };
  assert.equal(await writeListing(kv, rec), true);
  assert.deepEqual(await readListing(kv, ID), rec);
  assert.ok(kv.store.has(`invite-listing:${ID}`), 'stored under invite-listing:, never under invite:');
  for (const bad of ['', 'abc', 'ABCDEFGHJKMNPQR1', `${ID}X`, null, '../x']) {
    assert.equal(await readListing(kv, bad), null, String(bad));
    assert.equal(await deleteListing(kv, bad), false, String(bad));
  }
  assert.equal(await writeListing(kv, { ...rec, id: 'nope' }), false);
  assert.equal(await deleteListing(kv, ID), true);
  assert.equal(await readListing(kv, ID), null);
});

test('reads fail soft: a throwing store, junk and a non-object all read as absent', async () => {
  assert.equal(await readListing(fakeKv({}, { failGet: () => true }), ID), null);
  assert.equal(await readListing(fakeKv({ [`invite-listing:${ID}`]: '[1,2]' }), ID), null);
  assert.equal(await readListing(null, ID), null);
  assert.equal(await writeListing(fakeKv({}, { failPut: () => true }), { id: ID }), false, 'a failed write reports false, never throws');
});

test('the list pages through every listing, and a list that fails is null, never a short list', async () => {
  const seed = {};
  for (const id of [ID, ID2, '2222222222222222']) seed[`invite-listing:${id}`] = JSON.stringify({ id });
  seed['invite:ABC123'] = JSON.stringify({ code: 'ABC123' }); // a plain invite is not a listing
  seed[`invite-listing-img:${ID}:icon.png`] = JSON.stringify({ dataBase64: 'AA' }); // nor is an image
  const kv = fakeKv(seed, { pageSize: 1 });
  assert.deepEqual((await listListingIds(kv)).sort(), ['2222222222222222', ID, ID2].sort());
  const all = await listListings(kv);
  assert.equal(all.length, 3);
  assert.ok(all.every(({ id, rec }) => rec.id === id));
  assert.equal(await listListingIds(fakeKv(seed, { failList: true })), null);
  assert.equal(await listListings(fakeKv(seed, { failList: true })), null);
});

test('a record that will not parse is listed with rec null, so the manager can flag it rather than lose it', async () => {
  const kv = fakeKv({ [`invite-listing:${ID}`]: '"just a string"' });
  assert.deepEqual(await listListings(kv), [{ id: ID, rec: null }]);
});

test('images: put records the size in metadata, read returns the draft-image wire shape, list and delete by key', async () => {
  const kv = fakeKv();
  assert.equal(await putListingImage(kv, ID, 'icon.png', b64(30), { now: 5 }), true);
  assert.equal(await putListingImage(kv, ID, 'cover.webp', b64(60)), true);
  assert.equal(await putListingImage(kv, ID2, 'icon.png', b64(9)), true);
  assert.deepEqual(kv.meta.get(`invite-listing-img:${ID}:icon.png`), { bytes: 30 });
  const img = await readListingImage(kv, ID, 'icon.png');
  assert.deepEqual(img, { dataBase64: b64(30), contentType: 'image/png', bytes: 30 });
  assert.deepEqual((await listListingImages(kv, ID)).map((i) => [i.name, i.bytes]).sort(), [['cover.webp', 60], ['icon.png', 30]]);

  // Refused names never shape a key.
  for (const bad of ['Icon.PNG', 'x.svg', '../icon.png', 'a/b.png', '']) {
    assert.equal(await putListingImage(kv, ID, bad, b64(3)), false, bad);
    assert.equal(await readListingImage(kv, ID, bad), null, bad);
  }
  assert.equal(await putListingImage(kv, ID, 'empty.png', ''), false, 'no bytes, no image');

  const kept = await deleteListingImages(kv, ID, { keep: ['icon.png'] });
  assert.deepEqual(kept, { ok: true, deleted: 1 });
  assert.ok(kv.store.has(`invite-listing-img:${ID}:icon.png`));
  assert.deepEqual(await deleteListingImages(kv, ID), { ok: true, deleted: 1 });
  assert.ok(kv.store.has(`invite-listing-img:${ID2}:icon.png`), 'another listing\'s images are never touched');
  assert.equal((await deleteListingImages(fakeKv({}, { failList: true }), ID)).ok, false);
});

test('deleteListingImageNames removes only the named images', async () => {
  const kv = fakeKv();
  for (const n of ['a.png', 'b.png', 'c.png']) await putListingImage(kv, ID, n, b64(3));
  assert.deepEqual(await deleteListingImageNames(kv, ID, ['a.png', 'c.png', 'NOPE.PNG']), { ok: true, deleted: 2 });
  assert.deepEqual((await listListingImages(kv, ID)).map((i) => i.name), ['b.png']);
});

test('readListingImageMap hands the claim every image, or names the ones missing', async () => {
  const kv = fakeKv();
  await putListingImage(kv, ID, 'icon.png', b64(3));
  const hit = await readListingImageMap(kv, ID, ['icon.png']);
  assert.equal(hit.ok, true);
  assert.equal(hit.images.get('icon.png'), b64(3));
  assert.deepEqual(await readListingImageMap(kv, ID, ['icon.png', 'cover.png']), { ok: false, missing: ['cover.png'] });
});

test('a staged image is read from the CALLER\'s own store only, item key first, then the pre-item key', async () => {
  const kv = fakeKv({
    [draftImageKey(ME, 'project:surfacedby', 'icon.png')]: JSON.stringify({ dataBase64: 'ITEM', contentType: 'image/png' }),
    [legacyDraftImageKey(ME, 'icon.png')]: JSON.stringify({ dataBase64: 'LEGACY' }),
    [legacyDraftImageKey(ME, 'old.png')]: JSON.stringify({ dataBase64: 'OLD' }),
    [draftImageKey('999', 'project:surfacedby', 'cover.png')]: JSON.stringify({ dataBase64: 'SOMEONE ELSE' }),
  });
  assert.equal((await readStagedImage(kv, ME, 'project:surfacedby', 'icon.png')).dataBase64, 'ITEM');
  assert.equal((await readStagedImage(kv, ME, 'project:surfacedby', 'old.png')).dataBase64, 'OLD');
  assert.equal(await readStagedImage(kv, ME, 'project:surfacedby', 'cover.png'), null, 'another member\'s staged image is unreachable');
  assert.equal(await readStagedImage(kv, null, 'project:surfacedby', 'icon.png'), null);
});

test('collect WRITES NOTHING, prefers a fresh staged upload over the stored copy, and names what is missing', async () => {
  const kv = fakeKv({
    [draftImageKey(ME, 'project:surfacedby', 'cover.png')]: JSON.stringify({ dataBase64: 'NEWCOVER' }),
  });
  await putListingImage(kv, ID, 'icon.png', 'STOREDICON');
  await putListingImage(kv, ID, 'cover.png', 'OLDCOVER');
  const before = new Map(kv.store);

  const got = await collectListingImages(kv, { callerId: ME, stagedItem: 'project:surfacedby', id: ID, names: ['icon.png', 'cover.png'] });
  assert.equal(got.ok, true);
  assert.deepEqual(kv.store, before, 'collecting changes nothing in the store');
  assert.deepEqual(got.images.get('cover.png'), { dataBase64: 'NEWCOVER', source: 'staged', key: draftImageKey(ME, 'project:surfacedby', 'cover.png') });
  assert.equal(got.images.get('icon.png').source, 'listing');
  assert.deepEqual([...imageBytesOf(got.images)], [['icon.png', 'STOREDICON'], ['cover.png', 'NEWCOVER']]);

  const miss = await collectListingImages(kv, { callerId: ME, stagedItem: 'project:surfacedby', id: null, names: ['icon.png', 'shot.png'] });
  assert.deepEqual(miss, { ok: false, error: 'image_missing', missing: ['icon.png', 'shot.png'] }, 'a create has no stored copies to fall back on');
});

test('collect refuses an image over the 1 MiB cap even when the store holds it', async () => {
  const kv = fakeKv({
    [draftImageKey(ME, 'project:big', 'huge.png')]: JSON.stringify({ dataBase64: b64(DRAFT_IMAGE_MAX_BYTES + 3) }),
  });
  const r = await collectListingImages(kv, { callerId: ME, stagedItem: 'project:big', names: ['huge.png'] });
  assert.deepEqual(r, { ok: false, error: 'image_too_large', names: ['huge.png'] });
});

test('write copies only the staged images, and the staged copies are deleted last and only on request', async () => {
  const stagedKey = draftImageKey(ME, 'project:surfacedby', 'cover.png');
  const kv = fakeKv({ [stagedKey]: JSON.stringify({ dataBase64: 'NEWCOVER' }) });
  await putListingImage(kv, ID, 'icon.png', 'STOREDICON');
  const got = await collectListingImages(kv, { callerId: ME, stagedItem: 'project:surfacedby', id: ID, names: ['icon.png', 'cover.png'] });

  const w = await writeCollectedImages(kv, ID, got.images, { now: 1 });
  assert.deepEqual(w, { ok: true, written: ['cover.png'] }, 'the stored icon is not rewritten');
  assert.equal((await readListingImage(kv, ID, 'cover.png')).dataBase64, 'NEWCOVER');
  assert.ok(kv.store.has(stagedKey), 'writing never deletes the staged copy; that is a separate, last step');

  assert.equal(await deleteStagedCopies(kv, got.images), 1);
  assert.equal(kv.store.has(stagedKey), false);
  assert.ok(kv.store.has(`invite-listing-img:${ID}:icon.png`), 'a listing-sourced image is never deleted as a staged copy');
});

test('a failed image write reports what landed, so the caller can remove it', async () => {
  const kv = fakeKv({
    [draftImageKey(ME, 'project:x', 'a.png')]: JSON.stringify({ dataBase64: 'A' }),
    [draftImageKey(ME, 'project:x', 'b.png')]: JSON.stringify({ dataBase64: 'B' }),
  }, { failPut: (k) => k.endsWith(':b.png') });
  const got = await collectListingImages(kv, { callerId: ME, stagedItem: 'project:x', names: ['a.png', 'b.png'] });
  assert.deepEqual(await writeCollectedImages(kv, ID, got.images), { ok: false, written: ['a.png'] });
});
