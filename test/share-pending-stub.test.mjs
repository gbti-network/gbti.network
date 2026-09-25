// sow-224: the pending-share stub core. Pure store logic (injected clock + store) and copy (sow-404 removed the per-host link).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  shareSlug, pendingTitle, pendingStubView,
  rememberPending, livePending, dropPublished, clearPending,
  PENDING_NOTE, PENDING_MAX_AGE_MS,
} from '../client-ui/src/share-pending-stub.mjs';

// A minimal in-memory sessionStorage double.
function fakeStore() {
  let v = {};
  return {
    getItem: (k) => (k in v ? v[k] : null),
    setItem: (k, val) => { v[k] = String(val); },
    removeItem: (k) => { delete v[k]; },
    _dump: () => v,
  };
}
const item = { type: 'share', author: 'me', id: 'abc', title: 'Hello world', url: 'https://ex.com' };

test('shareSlug + pendingTitle: composite slug, and the title fallback chain', () => {
  assert.equal(shareSlug(item), 'me/abc');
  assert.equal(shareSlug({ author: 'me' }), ''); // missing id
  assert.equal(shareSlug(null), '');
  assert.equal(pendingTitle(item), 'Hello world');
  assert.equal(pendingTitle({ shortDescription: 'a note' }), 'a note');
  assert.equal(pendingTitle({}), 'Your share');
});

// sow-404 (owner, 2026-09-25): the stub used to end with "Track it under Pull requests", linking the member to a
// tab that is now superadmin-only. The note stays; the link, its text and its per-host href are gone.
test('pendingStubView: the fixed note, and no Pull requests link', () => {
  const entry = { slug: 'me/abc', title: 'Hello world', prUrl: 'https://github.com/o/r/pull/9' };
  const view = pendingStubView(entry);
  assert.equal(view.note, PENDING_NOTE);
  assert.equal(view.prUrl, 'https://github.com/o/r/pull/9');
  assert.equal('prsHref' in view, false);
  assert.equal('linkText' in view, false);
});

test('neither renderer links a queued share to Pull requests', () => {
  for (const f of ['client-ui/src/elements/gbti-shares-feed.mjs', 'src/lib/feed-pending-stub.ts', 'client-ui/src/share-pending-stub.mjs']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.equal(src.includes('Track it under Pull requests'), false, `${f} still carries the link text`);
    assert.equal(/#tab=prs/.test(src), false, `${f} still links the Pull requests tab`);
  }
});

test('rememberPending stores by slug; livePending returns it newest-first', () => {
  const store = fakeStore();
  rememberPending({ item, prNumber: 9, prUrl: 'https://pr' }, { store, now: 1000 });
  rememberPending({ item: { author: 'me', id: 'def', title: 'Second' }, prUrl: 'https://pr2' }, { store, now: 2000 });
  const live = livePending({ store, now: 2500 });
  assert.equal(live.length, 2);
  assert.equal(live[0].slug, 'me/def'); // newest first
  assert.equal(live[1].slug, 'me/abc');
  assert.equal(live[1].prNumber, 9);
  // A slug-less item is not stored.
  assert.equal(rememberPending({ item: { author: 'me' } }, { store, now: 3000 }), null);
});

test('livePending prunes entries older than the max age (about 15 min)', () => {
  const store = fakeStore();
  rememberPending({ item }, { store, now: 0 });
  // Just under the backstop: still live.
  assert.equal(livePending({ store, now: PENDING_MAX_AGE_MS - 1 }).length, 1);
  // Past the backstop: pruned, and removed from the store.
  assert.equal(livePending({ store, now: PENDING_MAX_AGE_MS + 1 }).length, 0);
  assert.equal(livePending({ store, now: PENDING_MAX_AGE_MS + 2 }).length, 0); // stays gone
});

test('dropPublished evicts a stub whose slug is now in the stream (the deploy landed)', () => {
  const store = fakeStore();
  rememberPending({ item }, { store, now: 1000 }); // me/abc
  rememberPending({ item: { author: 'me', id: 'def' } }, { store, now: 1000 });
  // The published stream now carries me/abc: its stub is dropped, me/def remains.
  const remaining = dropPublished(['me/abc'], { store, now: 1500 });
  assert.deepEqual(remaining.map((e) => e.slug), ['me/def']);
  // An empty/absent published set drops nothing.
  assert.equal(dropPublished(null, { store, now: 1600 }).length, 1);
});

test('clearPending removes one entry; a missing store is a no-op (never throws)', () => {
  const store = fakeStore();
  rememberPending({ item }, { store, now: 1000 });
  clearPending('me/abc', { store });
  assert.equal(livePending({ store, now: 1100 }).length, 0);
  // No store available (private mode / SSR): remember builds the entry but nothing persists, and reads are empty.
  const r = rememberPending({ item }, { store: null });
  assert.ok(r && r.slug === 'me/abc');
  assert.deepEqual(livePending({ store: null }), []);
});
