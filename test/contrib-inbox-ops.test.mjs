// SOW-028 P1: the owner's incoming-contribution review inbox operation (listIncomingContributions). The host
// injects identity + a fake repo client; the op lists OPEN upstream PRs and keeps only the ones whose files sit
// entirely inside the signed-in member's folder (the gate's contribution-pending-owner set), excluding the
// owner's own PRs and any mixed / other-folder / privilege-escalating PR. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listIncomingContributions, OperationError } from '../client/src/operations.mjs';

function fakeRepo({ open = [], filesByNumber = {} } = {}) {
  const calls = { files: [] };
  return {
    calls,
    async listOpenPulls() { return open; },
    async listPullFiles(n) {
      calls.files.push(n);
      const f = filesByNumber[n];
      if (f instanceof Error) throw f;
      return f ?? [];
    },
  };
}

function ctx({ identity = { login: 'alice', githubId: '1', username: 'alice' }, repo } = {}) {
  return { identity: () => identity, getRepoClient: () => repo };
}

const f = (filename, extra = {}) => ({ filename, status: 'modified', additions: 0, deletions: 0, ...extra });

test('keeps only open PRs that touch the owner folder; drops own/other/mixed/unreadable', async () => {
  const repo = fakeRepo({
    open: [
      { number: 10, title: 'Fix a typo', html_url: 'u10', author: { login: 'bob', id: '2' }, headSha: 's10', createdAt: '2026-01-02T00:00:00Z' },
      { number: 11, title: 'My own edit', html_url: 'u11', author: { login: 'alice', id: '1' }, headSha: 's11' }, // own -> excluded (no file fetch)
      { number: 12, title: 'Other folder', html_url: 'u12', author: { login: 'bob', id: '2' }, headSha: 's12' }, // to carol -> excluded
      { number: 13, title: 'Mixed w/ infra', html_url: 'u13', author: { login: 'bob', id: '2' }, headSha: 's13' }, // mixed -> excluded
      { number: 14, title: 'Unreadable', html_url: 'u14', author: { login: 'dave', id: '4' }, headSha: 's14' }, // files throw -> skipped
    ],
    filesByNumber: {
      10: [f('members/alice/posts/x/index.md', { additions: 3, deletions: 1 })],
      11: [f('members/alice/posts/y/index.md', { additions: 1 })],
      12: [f('members/carol/posts/z/index.md', { additions: 2 })],
      13: [f('members/alice/posts/w/index.md'), f('house/roles.yml')],
      14: new Error('cannot read files'),
    },
  });
  const { contributions } = await listIncomingContributions(ctx({ repo }));
  assert.equal(contributions.length, 1);
  const c = contributions[0];
  assert.equal(c.number, 10);
  assert.equal(c.author.login, 'bob');
  assert.equal(c.fileCount, 1);
  assert.equal(c.additions, 3);
  assert.equal(c.deletions, 1);
  assert.equal(c.headSha, 's10');
  // The owner's own PR (#11) is skipped BEFORE fetching files (cheap exclusion).
  assert.ok(!repo.calls.files.includes(11), 'own PR files should not be fetched');
});

test('excludes the owner own PR by login when github ids are missing', async () => {
  const repo = fakeRepo({
    open: [{ number: 20, title: 'mine', html_url: 'u20', author: { login: 'alice', id: '1' }, headSha: 's20' }],
    filesByNumber: { 20: [f('members/alice/posts/x/index.md')] },
  });
  const { contributions } = await listIncomingContributions(ctx({ identity: { login: 'alice', githubId: null, username: 'alice' }, repo }));
  assert.equal(contributions.length, 0);
});

test('an empty open-PR list yields an empty inbox', async () => {
  const { contributions } = await listIncomingContributions(ctx({ repo: fakeRepo({ open: [] }) }));
  assert.deepEqual(contributions, []);
});

test('no signed-in identity -> no-identity; no repo -> not-authenticated', async () => {
  await assert.rejects(
    () => listIncomingContributions({ identity: () => null, getRepoClient: () => fakeRepo() }),
    (e) => e instanceof OperationError && e.code === 'no-identity',
  );
  await assert.rejects(
    () => listIncomingContributions({ identity: () => ({ login: 'a', githubId: '1', username: 'a' }), getRepoClient: () => null }),
    (e) => e instanceof OperationError && e.code === 'not-authenticated',
  );
});
