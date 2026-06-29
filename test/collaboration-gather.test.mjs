// SOW-059 C-gather: reconstruct a snapshot's collaboration points (the 5% pool) from git at payout. No real fs
// (readFile + the comment file list are injected). Verifies username->github_id resolution, the contribution `at`
// window, comment authorIntro/owner exclusion, and the end-to-end 5% split through distributeSnapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationEvents, readContributorsForItem, readCommentsIndex, gatherSnapshotPoints, reverseMembersIndex, itemKey, typeSlugKey } from '../scripts/lib/collaboration-gather.mjs';
import { distributeSnapshot } from '../membership/revenue-model.mjs';

const conv = Date.parse('2026-06-01T00:00:00Z');
const before = '2026-05-01';
const after = '2026-07-01';
const membersIndex = new Map([['100', 'alice'], ['200', 'bob'], ['300', 'dana']]);
const reverseIndex = reverseMembersIndex(membersIndex);
const firstItem = { owner: '100', type: 'post', slug: 'a' };  // alice
const lastItem = { owner: '200', type: 'product', slug: 'b' }; // bob

test('reverseMembersIndex inverts github_id->username to username(lower)->github_id', () => {
  assert.equal(reverseIndex.get('alice'), '100');
  assert.equal(reverseIndex.get('dana'), '300');
});

test('readContributorsForItem reads contributors[] (login + at) from the resolved member path', () => {
  const readFile = (p) => {
    assert.ok(p.replace(/\\/g, '/').endsWith('members/alice/posts/a/index.md'));
    return `---\nauthor: alice\ncontributors:\n  - login: dana\n    at: "${before}"\n  - login: noone\n---\nbody`;
  };
  const out = readContributorsForItem('/root', firstItem, membersIndex, { readFile });
  assert.deepEqual(out, [{ login: 'dana', at: before }, { login: 'noone', at: undefined }]);
  // an unknown owner / missing file -> empty
  assert.deepEqual(readContributorsForItem('/root', { owner: '999', type: 'post', slug: 'x' }, membersIndex, { readFile: () => { throw new Error('nope'); } }), []);
});

test('readCommentsIndex maps target type+slug -> comments (author, date, authorIntro from authorNote)', () => {
  const files = ['c1.md', 'c2.md', 'skip.md'];
  const readFile = (f) => ({
    'c1.md': `---\ntype: comment\nauthor: dana\ntargetType: product\ntargetSlug: b\ncreatedAt: ${before}\n---\nx`,
    'c2.md': `---\ntype: comment\nauthor: alice\ntargetType: product\ntargetSlug: b\ncreatedAt: ${before}\nauthorNote: true\n---\nx`,
    'skip.md': `---\ntype: post\n---\nnot a comment`,
  }[f]);
  const idx = readCommentsIndex('/root', { files, readFile });
  const list = idx.get(typeSlugKey('product', 'b'));
  assert.equal(list.length, 2);
  assert.equal(list.find((c) => c.author === 'alice').authorIntro, true);
  assert.equal(list.find((c) => c.author === 'dana').authorIntro, false);
});

test('readCommentsIndex EXCLUDES a removed (status:draft) comment from the payout pool, keeps status-less + published', () => {
  const files = ['ok.md', 'removed.md', 'explicit.md'];
  const readFile = (f) => ({
    'ok.md': `---\ntype: comment\nauthor: dana\ntargetType: product\ntargetSlug: b\ncreatedAt: ${before}\n---\nx`,           // status-less -> Zod default 'published' -> counts
    'removed.md': `---\ntype: comment\nauthor: spammer\ntargetType: product\ntargetSlug: b\ncreatedAt: ${before}\nstatus: draft\n---\nx`, // hideContent removal -> excluded
    'explicit.md': `---\ntype: comment\nauthor: erin\ntargetType: product\ntargetSlug: b\ncreatedAt: ${before}\nstatus: published\n---\nx`,
  }[f]);
  const list = readCommentsIndex('/root', { files, readFile }).get(typeSlugKey('product', 'b'));
  assert.equal(list.length, 2);
  assert.ok(!list.some((c) => c.author === 'spammer'), 'the removed (draft) comment earns no collaboration point');
  assert.ok(list.some((c) => c.author === 'dana') && list.some((c) => c.author === 'erin'));
});

test('buildCollaborationEvents resolves actors to github_ids and drops non-members', () => {
  const contributorsByItem = new Map([[itemKey(firstItem), [{ login: 'dana', at: before }, { login: 'ghost', at: before }]]]);
  const commentsIndex = new Map([[typeSlugKey('product', 'b'), [{ author: 'dana', at: before, authorIntro: false }]]]);
  const events = buildCollaborationEvents({ items: [firstItem, lastItem], contributorsByItem, commentsIndex, reverseIndex });
  // dana resolves (300); ghost is dropped (not in the index)
  assert.deepEqual(events.map((e) => e.member).sort(), ['300', '300']);
  assert.equal(events.find((e) => e.kind === 'contribution').member, '300');
  assert.ok(Number.isFinite(events[0].at));
});

test('gatherSnapshotPoints: a non-owner contribution + comment before conversion -> the contributor earns points', () => {
  const readFile = () => `---\nauthor: alice\ncontributors:\n  - login: dana\n    at: "${before}"\n---\nx`;
  const commentsIndex = new Map([['product b', [
    { author: 'dana', at: before, authorIntro: false },  // counts
    { author: 'bob', at: before, authorIntro: false },   // owner of b -> excluded
    { author: 'dana', at: after, authorIntro: false },   // after conversion -> excluded
    { author: 'dana', at: before, authorIntro: true },   // author-intro -> excluded
  ]]]);
  const snapshot = { firstItem, lastItem, conversionAt: conv };
  const points = gatherSnapshotPoints({ root: '/r', snapshot, membersIndex, reverseIndex, commentsIndex, readFile });
  // dana: 1 contribution on a + 1 valid comment on b = 2 points
  assert.deepEqual(points, [{ member: '300', points: 2 }]);
});

test('gatherSnapshotPoints: a contribution missing `at` earns nothing (window drops a non-finite date)', () => {
  const readFile = () => `---\nauthor: alice\ncontributors:\n  - login: dana\n---\nx`; // no at
  const snapshot = { firstItem, lastItem, conversionAt: conv };
  assert.deepEqual(gatherSnapshotPoints({ root: '/r', snapshot, membersIndex, reverseIndex, commentsIndex: new Map(), readFile }), []);
});

test('END TO END: the gathered 5% pool flows through distributeSnapshot (alice 30 / bob 10 / dana 5 / 55 retained)', () => {
  const readFile = () => `---\nauthor: alice\ncontributors:\n  - login: dana\n    at: "${before}"\n---\nx`;
  const snapshot = { firstOwner: '100', lastOwner: '200', firstItem, lastItem, inviter: null, conversionAt: conv };
  snapshot.points = gatherSnapshotPoints({ root: '/r', snapshot, membersIndex, reverseIndex, commentsIndex: new Map(), readFile });
  const d = distributeSnapshot(snapshot, { eligible: () => true });
  assert.equal(d.shares['100'], 30); assert.equal(d.shares['200'], 10);
  assert.ok(Math.abs(d.shares['300'] - 5) < 1e-9); // dana, the sole pool member, gets the full 5%
  assert.ok(Math.abs(d.retainedPct - 55) < 1e-9);
});
