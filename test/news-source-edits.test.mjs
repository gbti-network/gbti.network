import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSource, setSourceEnabled, removeSource, slugify, hostOf, NewsSourceEditError } from '../membership/news-source-edits.mjs';

const ctx = { actor: { githubId: 7, login: 'admin' }, now: '2026-06-22T00:00:00.000Z' };
const doc = (sources = []) => ({ sources });

test('slugify / hostOf derive stable kebab ids + bare domains', () => {
  assert.equal(slugify('The Next Web'), 'the-next-web');
  assert.equal(slugify('', 'https://hackaday.com/feed/'), 'hackaday-com');
  assert.equal(hostOf('https://www.theverge.com/rss'), 'www.theverge.com');
});

test('addSource appends with a derived id + domain description, defaults enabled', () => {
  const r = addSource(doc(), { name: 'Hackaday', url: 'https://hackaday.com/feed/' }, ctx);
  assert.equal(r.changed, true);
  assert.deepEqual(r.next.sources[0], { id: 'hackaday', name: 'Hackaday', url: 'https://hackaday.com/feed/', description: 'hackaday.com', enabled: true });
  assert.equal(r.audit.action, 'news-source.add');
  assert.equal(r.audit.actor.github_id, '7');
});

test('addSource is idempotent on identical id+url, rejects id/url clashes + bad urls', () => {
  const base = doc([{ id: 'hackaday', name: 'Hackaday', url: 'https://hackaday.com/feed/', description: 'hackaday.com', enabled: true }]);
  assert.equal(addSource(base, { id: 'hackaday', name: 'Hackaday', url: 'https://hackaday.com/feed/' }, ctx).changed, false);
  assert.throws(() => addSource(base, { id: 'hackaday', name: 'X', url: 'https://other.com/feed' }, ctx), NewsSourceEditError); // id clash, different url
  assert.throws(() => addSource(base, { name: 'Dup url', url: 'https://hackaday.com/feed/' }, ctx), NewsSourceEditError); // duplicate url
  assert.throws(() => addSource(base, { name: 'No proto', url: 'hackaday.com/feed' }, ctx), NewsSourceEditError); // bad url
  assert.throws(() => addSource(base, { name: '' , url: 'https://x.com/feed' }, ctx), NewsSourceEditError); // no name
});

test('setSourceEnabled toggles, is idempotent, and errors on a missing id', () => {
  const base = doc([{ id: 'a', name: 'A', url: 'https://a.com/feed', description: 'a.com', enabled: true }]);
  const off = setSourceEnabled(base, { id: 'a', enabled: false }, ctx);
  assert.equal(off.changed, true);
  assert.equal(off.next.sources[0].enabled, false);
  assert.equal(setSourceEnabled(off.next, { id: 'a', enabled: false }, ctx).changed, false); // already disabled
  assert.throws(() => setSourceEnabled(base, { id: 'nope', enabled: false }, ctx), NewsSourceEditError);
});

test('removeSource drops the entry and errors on a missing id; inputs are not mutated', () => {
  const base = doc([{ id: 'a', name: 'A', url: 'https://a.com/feed', description: 'a.com', enabled: true }, { id: 'b', name: 'B', url: 'https://b.com/feed', description: 'b.com', enabled: true }]);
  const r = removeSource(base, { id: 'a' }, ctx);
  assert.deepEqual(r.next.sources.map((s) => s.id), ['b']);
  assert.equal(base.sources.length, 2, 'the input doc is cloned, not mutated');
  assert.throws(() => removeSource(base, { id: 'nope' }, ctx), NewsSourceEditError);
});
