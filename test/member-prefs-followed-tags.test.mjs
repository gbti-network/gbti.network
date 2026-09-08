// sow-307: followed tags live in the member's account (the prefs record), bounded by shape, dedupe and a cap
// of 50. The core is pure; the route test crosses the Worker boundary with a fake KV and a stubbed authorizer,
// the same fixtures test/membership-prefs.test.mjs uses.
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePrefs, applyPrefs, normalizeTag, cleanTags, MAX_TAGS, PrefsError } from '../membership/member-prefs.mjs';
import { handlePrefs } from '../workers/signup/membership-prefs.mjs';

test('normalizeTag: lowercased, trimmed, a leading # dropped; anything that is not a slug is null', () => {
  assert.equal(normalizeTag('  #Claude-Code '), 'claude-code');
  assert.equal(normalizeTag('RATE-LIMITS'), 'rate-limits');
  assert.equal(normalizeTag('#'), null);
  assert.equal(normalizeTag('two words'), null);
  assert.equal(normalizeTag('a'.repeat(41)), null, '40 characters is the ceiling');
  assert.equal(normalizeTag('a'.repeat(40)), 'a'.repeat(40));
  assert.equal(normalizeTag(42), null);
  assert.equal(normalizeTag('-leading'), null, 'must start with a letter or digit');
});

test('cleanTags: normalizes, dedupes case-insensitively, drops junk, caps', () => {
  assert.deepEqual(cleanTags(['#AI', 'ai', 'Devops', '', 7, 'bad tag', 'ai']), ['ai', 'devops']);
  const many = Array.from({ length: 80 }, (_, i) => `t${i}`);
  assert.equal(cleanTags(many).length, MAX_TAGS);
  assert.deepEqual(cleanTags(null), []);
});

test('the stored record carries followedTags, normalized', () => {
  const p = normalizePrefs({ followedTags: ['#Claude-Code', 'claude-code', 'x y'] });
  assert.deepEqual(p.followedTags, ['claude-code']);
  assert.deepEqual(normalizePrefs({}).followedTags, []);
});

test('followTag: follow and unfollow one tag, idempotent, other fields untouched', () => {
  let p = applyPrefs({ categories: ['ai'] }, { followTag: { tag: '#Rate-Limits', on: true } });
  assert.deepEqual(p.followedTags, ['rate-limits']);
  assert.deepEqual(p.categories, ['ai']);
  p = applyPrefs(p, { followTag: { tag: 'rate-limits', on: true } });
  assert.deepEqual(p.followedTags, ['rate-limits'], 're-following is a no-op');
  p = applyPrefs(p, { followTag: { tag: 'RATE-LIMITS', on: false } });
  assert.deepEqual(p.followedTags, []);
  assert.throws(() => applyPrefs({}, { followTag: { tag: 'not a tag' } }), PrefsError);
});

test('the cap: the fifty-first follow is REFUSED with the limit in the message, and nothing is dropped', () => {
  const full = { followedTags: Array.from({ length: MAX_TAGS }, (_, i) => `tag-${i}`) };
  assert.throws(() => applyPrefs(full, { followTag: { tag: 'one-more', on: true } }), (err) => err instanceof PrefsError && /limit is 50/.test(err.message));
  const p = applyPrefs(full, { followTag: { tag: 'tag-0', on: false } });
  assert.equal(p.followedTags.length, MAX_TAGS - 1, 'unfollowing at the cap still works');
  assert.throws(() => applyPrefs({}, { followedTags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`) }), /limit is 50/);
});

test('followedTags: replace, for the one-time push from the browser', () => {
  const p = applyPrefs({ followedTags: ['old'] }, { followedTags: ['#New', 'new', 'and-this'] });
  assert.deepEqual(p.followedTags, ['new', 'and-this']);
  assert.throws(() => applyPrefs({}, { followedTags: 'nope' }), PrefsError);
});

// ---- through the Worker route ----
const fakeKV = (init = {}) => {
  const store = new Map(Object.entries(init));
  return {
    store,
    async get(k, t) { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
};
const paid = () => ({ ok: true, githubId: '1' });
const REQ = (method, body) => new Request('https://x/membership/prefs', { method, ...(body ? { body: JSON.stringify(body) } : {}) });

test('route: a tag toggle persists to the member key and reads back; the cap answers 400 with the limit', async () => {
  const kv = fakeKV();
  let r = await handlePrefs(REQ('POST', { followTag: { tag: '#Claude-Code', on: true } }), {}, { kv, authorize: paid });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs.followedTags, ['claude-code']);
  assert.deepEqual(JSON.parse(kv.store.get('prefs:1')).followedTags, ['claude-code'], 'written to the account');
  r = await handlePrefs(REQ('GET'), {}, { kv, authorize: paid });
  assert.deepEqual(r.body.prefs.followedTags, ['claude-code'], 'and read back from it');
  kv.store.set('prefs:1', JSON.stringify({ followedTags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`) }));
  r = await handlePrefs(REQ('POST', { followTag: { tag: 'one-more', on: true } }), {}, { kv, authorize: paid });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid');
  assert.match(r.body.message, /limit is 50/, 'the panel shows this rather than dropping a tag');
});

test('route: the one-time push replaces the list', async () => {
  const kv = fakeKV();
  const r = await handlePrefs(REQ('POST', { followedTags: ['#a', 'b', 'a'] }), {}, { kv, authorize: paid });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prefs.followedTags, ['a', 'b']);
});
