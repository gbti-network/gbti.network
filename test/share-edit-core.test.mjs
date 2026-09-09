// sow-304: the pure rules behind editing a published share. The composer is the editor and re-publishes the same
// id, so the whole product decision lives in the INPUT it sends: url frozen but removable, createdAt preserved and
// updatedAt stamped, the stale ciphertext pointer never carried, the audience free in either direction, unpublish
// as a status flip. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editInputFor, encRemovalFor, audienceChangeNote, shareRowState, sharePublicUrl } from '../client-ui/src/share-post-core.mjs';

const stored = {
  id: '20260610-astro-content-layer', author: 'alice', path: 'members/alice/shares/20260610-astro-content-layer.md',
  createdAt: '2026-06-10T14:00:00.000Z', url: 'https://example.com/post', title: 'Old', shortDescription: 'Old blurb',
  visibility: 'members', status: 'published', encryptedBody: 'members/alice/_enc/share-20260610-astro-content-layer-body.enc',
  tags: ['astro'], category: 'devops',
};
const NOW = '2026-09-09T16:00:00.000Z';

test('an edit keeps the id and createdAt, stamps updatedAt, and takes the editable fields from the form', () => {
  const input = editInputFor({ share: stored, now: NOW, fields: { title: ' New title ', shortDescription: 'New blurb', category: 'ai', tags: ['astro', 'islands'], image: 'https://img/x.png', visibility: 'members' } });
  assert.equal(input.id, stored.id);
  assert.equal(input.createdAt, stored.createdAt);
  assert.equal(input.updatedAt, NOW);
  assert.equal(input.title, 'New title');
  assert.equal(input.shortDescription, 'New blurb');
  assert.equal(input.category, 'ai');
  assert.deepEqual(input.tags, ['astro', 'islands']);
  assert.equal(input.image, 'https://img/x.png');
  assert.equal(input.status, 'published');
});

test('the url is frozen: the stored one survives whatever the form says, and only removeUrl drops it', () => {
  const kept = editInputFor({ share: stored, now: NOW, fields: { url: 'https://other.example/changed' } });
  assert.equal(kept.url, stored.url, 'a changed url in the form is ignored');
  const removed = editInputFor({ share: stored, now: NOW, fields: { removeUrl: true } });
  assert.ok(!('url' in removed), 'removeUrl drops the link');
});

test('encryptedBody is never carried, in either audience', () => {
  for (const visibility of ['members', 'public']) {
    const input = editInputFor({ share: stored, now: NOW, fields: { visibility } });
    assert.ok(!('encryptedBody' in input), visibility);
    assert.equal(input.visibility, visibility);
  }
});

test('unpublish and publish-again are status flips on the same id; anything else is published', () => {
  assert.equal(editInputFor({ share: stored, now: NOW, status: 'draft' }).status, 'draft');
  assert.equal(editInputFor({ share: { ...stored, status: 'draft' }, now: NOW }).status, 'draft', 'a removed share stays removed on a plain save');
  assert.equal(editInputFor({ share: { ...stored, status: 'draft' }, now: NOW, status: 'published' }).status, 'published');
  assert.equal(editInputFor({ share: stored, now: NOW, status: 'weird' }).status, 'published');
});

test('a share without a usable id cannot be edited', () => {
  assert.equal(editInputFor({ share: { ...stored, id: '' }, now: NOW }), null);
  assert.equal(editInputFor({ share: { ...stored, id: '../x' }, now: NOW }), null);
  assert.equal(editInputFor({ share: null }), null);
});

test('the stale ciphertext is deleted only on a members-to-public flip, and only from the member\'s own _enc/', () => {
  assert.equal(encRemovalFor({ share: stored, visibility: 'public', username: 'alice' }), stored.encryptedBody);
  assert.equal(encRemovalFor({ share: stored, visibility: 'members', username: 'alice' }), null, 'staying members re-encrypts to the same path');
  assert.equal(encRemovalFor({ share: { ...stored, encryptedBody: null }, visibility: 'public', username: 'alice' }), null, 'a public share has nothing to remove');
  assert.equal(encRemovalFor({ share: { ...stored, encryptedBody: 'members/bob/_enc/share-x-body.enc' }, visibility: 'public', username: 'alice' }), null, 'never another folder');
});

test('the audience note reads only when the audience changes', () => {
  assert.equal(audienceChangeNote('members', 'members'), '');
  assert.match(audienceChangeNote('public', 'members'), /public page goes away/);
  assert.match(audienceChangeNote('members', 'public'), /anyone can read it/);
  for (const s of [audienceChangeNote('public', 'members'), audienceChangeNote('members', 'public')]) assert.ok(!/[—–]/.test(s), 'no dashes in user-facing copy');
});

test('row state and the public url: only a published public share has a page', () => {
  assert.deepEqual(shareRowState(stored), { label: 'Published', tone: 'ok', published: true });
  assert.deepEqual(shareRowState({ ...stored, status: 'draft' }), { label: 'Removed', tone: 'muted', published: false });
  assert.equal(sharePublicUrl(stored), '', 'members share: no page');
  assert.equal(sharePublicUrl({ ...stored, visibility: 'public' }), 'https://gbti.network/shares/alice/20260610-astro-content-layer/');
  assert.equal(sharePublicUrl({ ...stored, visibility: 'public', status: 'draft' }), '', 'removed: no page');
  assert.equal(sharePublicUrl({ ...stored, visibility: 'public', author: null }), 'https://gbti.network/shares/alice/20260610-astro-content-layer/', 'author from the path');
});
