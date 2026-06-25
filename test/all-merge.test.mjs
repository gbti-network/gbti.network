// SOW-042: the shared "All" merge (client-ui/src/all-merge.mjs) used by both the Browse All directory and the
// new-tab Activity All river. Tests the ONE visitor/Locked policy (omit Shares unless paid/trialing), the newest-
// first ordering across mixed date fields (content publishedAt ms vs Share createdAt ISO), and the share projection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAll, canSeeShares, shareToItem, shareTitle, hostOf, toMs } from '../client-ui/src/all-merge.mjs';

const post = (slug, ms) => ({ type: 'post', slug, title: slug, author: 'gbti', visibility: 'public', publishedAt: ms });
const share = (id, iso, extra = {}) => ({ type: 'share', id, author: 'hudson', visibility: 'members', createdAt: iso, ...extra });

test('canSeeShares: only paid + trialing see Shares; Locked/unknown/empty do not (fail-closed)', () => {
  // The exact effectiveMembership vocabulary from membership.mjs (a grandfather grant resolves to 'paid').
  for (const m of ['paid', 'trialing']) assert.equal(canSeeShares(m), true, m);
  for (const m of ['expired', 'cancelled', 'none', 'banned']) assert.equal(canSeeShares(m), false, m);
  assert.equal(canSeeShares('unknown'), false);
  assert.equal(canSeeShares('active'), false); // a raw Stripe status is NOT the effective vocabulary -> fail-closed
  assert.equal(canSeeShares(''), false);
  assert.equal(canSeeShares(null), false);
  assert.equal(canSeeShares(undefined), false);
});

test('canSeeShares is case-insensitive', () => {
  assert.equal(canSeeShares('PAID'), true);
  assert.equal(canSeeShares('Banned'), false);
});

test('mergeAll omits Shares for a non-member, includes them for a member', () => {
  const items = [post('a', 100)];
  const shares = [share('s1', '2026-06-15T00:00:00Z')];
  assert.equal(mergeAll({ items, shares, membership: 'none' }).length, 1); // Locked: no Shares
  assert.equal(mergeAll({ items, shares, membership: 'unknown' }).length, 1); // unknown: fail-closed
  const member = mergeAll({ items, shares, membership: 'paid' });
  assert.equal(member.length, 2);
  assert.ok(member.some((x) => x.type === 'share'));
});

test('SOW-077: a PUBLIC share is visible to free/banned; a MEMBER share stays paid|trialing only', () => {
  const items = [post('a', 100)];
  const pub = share('p1', '2026-06-15T00:00:00Z', { visibility: 'public' });
  const mem = share('m1', '2026-06-15T00:00:00Z', { visibility: 'members' });
  const shareIds = (m) => mergeAll({ items, shares: [pub, mem], membership: m }).filter((x) => x.type === 'share').map((x) => x.id);
  for (const m of ['none', 'expired', 'cancelled', 'banned']) {
    assert.deepEqual(shareIds(m), ['p1'], `${m} sees only the public share`);
  }
  assert.deepEqual(shareIds('paid').sort(), ['m1', 'p1']); // paid sees both
  assert.deepEqual(shareIds('trialing').sort(), ['m1', 'p1']); // trial sees both
  // Fail-closed: a share with no explicit visibility (defaults to members in shareSummary) is NOT public.
  assert.deepEqual(mergeAll({ items, shares: [share('x', '2026-06-15T00:00:00Z')], membership: 'none' }).filter((x) => x.type === 'share'), []);
});

test('mergeAll sorts newest-first across publishedAt (ms) and createdAt (ISO)', () => {
  const items = [post('old', Date.parse('2026-01-01T00:00:00Z')), post('new', Date.parse('2026-06-16T00:00:00Z'))];
  const shares = [share('mid', '2026-03-01T00:00:00Z')];
  const out = mergeAll({ items, shares, membership: 'paid' });
  assert.deepEqual(out.map((x) => x.slug ?? x.id), ['new', 'mid', 'old']);
});

test('mergeAll does not mutate the input items array', () => {
  const items = [post('a', 100), post('b', 200)];
  const before = items.slice();
  mergeAll({ items, shares: [share('s', '2026-06-15T00:00:00Z')], membership: 'paid' });
  assert.deepEqual(items, before);
});

test('mergeAll tolerates null/absent shares and empty items', () => {
  assert.deepEqual(mergeAll({ items: [post('a', 1)], shares: null, membership: 'paid' }).map((x) => x.slug), ['a']);
  assert.deepEqual(mergeAll({ items: [], shares: [], membership: 'paid' }), []);
  assert.deepEqual(mergeAll({}), []); // all defaults
});

test('shareToItem projects a raw Share onto the card shape, carrying the full Share for the reader', () => {
  const raw = share('s1', '2026-06-15T00:00:00Z', { title: 'Hello', shortDescription: 'desc', url: 'https://example.com/x', body: 'note', encryptedBody: null });
  const it = shareToItem(raw);
  assert.equal(it.type, 'share');
  assert.equal(it.title, 'Hello');
  assert.equal(it.excerpt, 'desc'); // a titled Share keeps its description as the excerpt
  assert.equal(it.thumb, null);
  assert.equal(it.createdAt, '2026-06-15T00:00:00Z');
  assert.equal(it.body, 'note'); // the full Share rides through so the reader can open it
  assert.equal(it.author, 'hudson');
});

test('SOW-057: a Share featured image becomes the card thumbnail', () => {
  const withImg = shareToItem(share('s2', '2026-06-15T00:00:00Z', { title: 'Hi', image: 'https://example.com/og.jpg' }));
  assert.equal(withImg.thumb, 'https://example.com/og.jpg');
  // no image still yields a null thumb (the glyph fallback)
  const noImg = shareToItem(share('s3', '2026-06-15T00:00:00Z', { title: 'Hi' }));
  assert.equal(noImg.thumb, null);
});

test('shareTitle falls back to short description, then the link host, then a default', () => {
  assert.equal(shareTitle({ title: 'T' }), 'T');
  assert.equal(shareTitle({ shortDescription: 'D' }), 'D');
  assert.equal(shareTitle({ url: 'https://www.example.com/path' }), 'Link: example.com');
  assert.equal(shareTitle({}), 'Member share');
});

test('an untitled Share has an empty excerpt (its description became the title)', () => {
  const it = shareToItem(share('s', '2026-06-15T00:00:00Z', { shortDescription: 'only desc' }));
  assert.equal(it.title, 'only desc');
  assert.equal(it.excerpt, '');
});

test('hostOf strips www and fails soft to "link"', () => {
  assert.equal(hostOf('https://www.github.com/x'), 'github.com');
  assert.equal(hostOf('not a url'), 'link');
});

test('toMs normalizes numbers, ISO strings, and absent/garbage to 0', () => {
  assert.equal(toMs(1234), 1234);
  assert.equal(toMs('2026-06-15T00:00:00Z'), Date.parse('2026-06-15T00:00:00Z'));
  assert.equal(toMs(null), 0);
  assert.equal(toMs('not-a-date'), 0);
  assert.equal(toMs(undefined), 0);
});
