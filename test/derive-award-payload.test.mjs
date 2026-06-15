// SOW-008: deriving the award payload from a merged contribution PR's metadata (pure core).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveAwardPayload, classFromLabels } from '../scripts/derive-award-payload.mjs';

// github_id -> username, like house/members-index.yml
const MEMBERS = new Map([
  ['111', 'alice'],
  ['222', 'bob'],
]);
const NO_BANS = new Map();

const base = {
  prUser: { login: 'bob', id: '222' }, // bob contributes to alice's post
  mergeCommitSha: 'abc123',
  labels: ['contribution-accepted', 'contribution:correction'],
  changedPaths: ['members/alice/posts/hello-world/index.md'],
  membersIndex: MEMBERS,
  bans: NO_BANS,
  repo: 'gbti-network/gbti.network',
};

test('happy path: resolves owner, contributor, class, commit URL, and target', () => {
  const r = deriveAwardPayload(base);
  assert.equal(r.ready, true);
  assert.equal(r.payload.targetFile, 'members/alice/posts/hello-world/index.md');
  assert.equal(r.payload.ownerGithubId, '111');
  assert.equal(r.payload.contributorGithubId, '222');
  assert.deepEqual(r.payload.contributor, {
    login: 'bob',
    commit: 'abc123',
    url: 'https://github.com/gbti-network/gbti.network/commit/abc123',
    class: 'correction',
  });
  assert.deepEqual(r.payload.target, { type: 'post', slug: 'hello-world', username: 'alice' });
  assert.equal(r.payload.banned, false);
});

test('class is read from the label; defaults to correction when absent', () => {
  assert.equal(classFromLabels(['contribution:addition']), 'addition');
  assert.equal(classFromLabels(['class:grammar']), 'grammar');
  assert.equal(classFromLabels(['contribution-accepted']), 'correction'); // no class label -> default
  assert.equal(classFromLabels([]), 'correction');
  const r = deriveAwardPayload({ ...base, labels: ['contribution:addition'] });
  assert.equal(r.payload.contributor.class, 'addition');
});

test('profile target: type profile, slug null', () => {
  const r = deriveAwardPayload({ ...base, changedPaths: ['members/alice/profile.md'] });
  assert.equal(r.ready, true);
  assert.deepEqual(r.payload.target, { type: 'profile', slug: null, username: 'alice' });
});

test('product and prompt targets map to the right type', () => {
  const p1 = deriveAwardPayload({ ...base, changedPaths: ['members/alice/products/my-plugin/index.md'] });
  assert.equal(p1.payload.target.type, 'product');
  const p2 = deriveAwardPayload({ ...base, changedPaths: ['members/alice/prompts/a-prompt/index.md'] });
  assert.equal(p2.payload.target.type, 'prompt');
});

test('not ready: more than one content file (ambiguous target)', () => {
  const r = deriveAwardPayload({
    ...base,
    changedPaths: ['members/alice/posts/one/index.md', 'members/alice/posts/two/index.md'],
  });
  assert.equal(r.ready, false);
  assert.match(r.reason, /exactly one/);
});

test('not ready: no content file at all (e.g. only an image changed)', () => {
  const r = deriveAwardPayload({ ...base, changedPaths: ['members/alice/images/pic.png'] });
  assert.equal(r.ready, false);
});

test('not ready: owner username not in the members-index', () => {
  const r = deriveAwardPayload({ ...base, changedPaths: ['members/carol/posts/x/index.md'] });
  assert.equal(r.ready, false);
  assert.match(r.reason, /no github_id/);
});

test('not ready: self-contribution (owner == contributor) earns no award', () => {
  const r = deriveAwardPayload({
    ...base,
    prUser: { login: 'alice', id: '111' }, // alice editing alice's own folder
  });
  assert.equal(r.ready, false);
  assert.match(r.reason, /self-contribution/);
});

test('banned contributor: payload still derives but is flagged banned (buildAward will award 0)', () => {
  const r = deriveAwardPayload({ ...base, bans: new Map([['222', { reason: 'spam' }]]) });
  assert.equal(r.ready, true);
  assert.equal(r.payload.banned, true);
});

test('.mdx content files are recognized', () => {
  const r = deriveAwardPayload({ ...base, changedPaths: ['members/alice/posts/hello/index.mdx'] });
  assert.equal(r.ready, true);
  assert.equal(r.payload.target.slug, 'hello');
});
