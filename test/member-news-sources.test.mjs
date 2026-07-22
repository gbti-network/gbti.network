// sow-140: the member news source merge. The approval registry is the moderation boundary; everything
// else fails closed (no approval, unpublished, members-only, feed missing/non-https, duplicate ids).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMemberSources } from '../src/lib/member-news-sources.mjs';

const HOUSE = [{ id: 'pytorch', name: 'PyTorch', url: 'https://pytorch.org/feed', description: '', enabled: true }];
const product = (over = {}) => ({
  slug: 'radle', title: 'Radle', author: 'atwellpub',
  status: 'published', visibility: 'public', newsFeed: 'https://radle.dev/feed.xml',
  ...over,
});

test('an approved published public product with an https feed joins the pool, prefixed and credited', () => {
  const out = mergeMemberSources(HOUSE, [{ product: 'radle' }], [product()]);
  assert.equal(out.length, 2);
  const m = out[1];
  assert.equal(m.id, 'member-radle');
  assert.equal(m.name, 'Radle');
  assert.equal(m.url, 'https://radle.dev/feed.xml');
  assert.match(m.description, /by atwellpub/);
  assert.equal(m.enabled, true);
});

test('everything fails closed: no approval, missing product, unpublished, members-only, no feed, http feed', () => {
  assert.equal(mergeMemberSources(HOUSE, [], [product()]).length, 1); // declared but never approved
  assert.equal(mergeMemberSources(HOUSE, [{ product: 'gone' }], [product()]).length, 1);
  assert.equal(mergeMemberSources(HOUSE, [{ product: 'radle' }], [product({ status: 'draft' })]).length, 1);
  assert.equal(mergeMemberSources(HOUSE, [{ product: 'radle' }], [product({ visibility: 'members' })]).length, 1);
  assert.equal(mergeMemberSources(HOUSE, [{ product: 'radle' }], [product({ newsFeed: undefined })]).length, 1);
  assert.equal(mergeMemberSources(HOUSE, [{ product: 'radle' }], [product({ newsFeed: 'http://insecure/feed' })]).length, 1);
  assert.equal(mergeMemberSources(HOUSE, [{}], [product()]).length, 1); // malformed row
});

test('house ids always win a collision and the inputs are not mutated', () => {
  const clash = [{ id: 'member-radle', name: 'House', url: 'https://x/feed', description: '', enabled: true }];
  const out = mergeMemberSources(clash, [{ product: 'radle' }], [product()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'House');
  const house = [...HOUSE];
  mergeMemberSources(house, [{ product: 'radle' }], [product()]);
  assert.deepEqual(house, HOUSE);
});
