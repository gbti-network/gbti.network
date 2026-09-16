// sow-274 Part 4: the member's GitHub client after the fork path was deleted. It says who the member is, makes
// one public read, and asks the network for everything about pull requests and canonical files. It has no way
// to write, and this file checks that by what the client exposes rather than by what its source says.
//
// Replaces test/client-publish.test.mjs and test/repo-client-app-mode.test.mjs, whose subjects (the fork
// writers, and the choice between reading GitHub directly and reading through the network) are gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRepoClient, GitHubError } from '../client/src/github-repo.mjs';
import { branchName } from '../client/src/hosted-publish.mjs';

const SIGNUP = 'https://signup.example';

/** A fetch that records each call and answers from a table of { match, body, status }. */
function recorder(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', auth: init.headers?.Authorization });
    const hit = routes.find((r) => u.includes(r.match));
    const status = hit?.status ?? (hit ? 200 : 404);
    const body = hit?.body ?? {};
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  return { calls, fetch };
}
const client = (fetch) => createRepoClient({ token: 'tok', upstream: 'gbti-network/gbti.network', fetch, signupBase: SIGNUP });

test('the client has no way to write to GitHub', () => {
  const repo = client(async () => ({}));
  const methods = Object.keys(repo).filter((k) => typeof repo[k] === 'function').sort();
  assert.deepEqual(methods, ['gateStatus', 'getAuthUser', 'getFileContent', 'listCommits', 'listMyPulls', 'listOpenPulls']);
});

test('identity and commit history are read from GitHub with the member token', async () => {
  const { calls, fetch } = recorder([
    { match: 'api.github.com/user', body: { login: 'Alice', id: 7 } },
    { match: '/commits?', body: [{ sha: 'a' }] },
  ]);
  const repo = client(fetch);
  assert.deepEqual(await repo.getAuthUser(), { login: 'Alice', id: '7' });
  assert.deepEqual(await repo.listCommits('members/alice/posts/x/index.md'), [{ sha: 'a' }]);
  assert.ok(calls.every((c) => c.url.startsWith('https://api.github.com/') && c.method === 'GET' && c.auth === 'Bearer tok'));
  assert.match(calls[1].url, /sha=main/);
});

test('pull requests and canonical files are read through the network, never by searching GitHub', async () => {
  const { calls, fetch } = recorder([
    { match: '/membership/my-pulls', body: { items: [{ number: 1 }] } },
    { match: '/membership/open-pulls', body: { items: [{ number: 2 }] } },
    { match: '/membership/pr-status', body: { state: 'success', meaning: 'mergeable', sha: 's' } },
    { match: '/membership/file', body: { text: 'hello' } },
  ]);
  const repo = client(fetch);
  assert.deepEqual(await repo.listMyPulls('alice'), [{ number: 1 }]);
  assert.deepEqual(await repo.listOpenPulls(), [{ number: 2 }]);
  assert.equal((await repo.gateStatus(5)).meaning, 'mergeable');
  assert.equal(await repo.getFileContent('members/alice/posts/x/index.md', 'abc'), 'hello');
  assert.ok(calls.every((c) => c.url.startsWith(`${SIGNUP}/membership/`)), 'a read went somewhere else');
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
  assert.match(calls[2].url, /pr-status\?number=5$/);
  assert.match(calls[3].url, /ref=abc$/);
});

test('a file read with no ref asks for main, not for a branch named undefined', async () => {
  // Every publishing caller passes a path alone. Before the default, the query said ref=undefined, GitHub had
  // no such branch, and the network answered "no file", so a rename's collision check passed for a taken slug.
  const { calls, fetch } = recorder([{ match: '/membership/file', body: { text: 'taken' } }]);
  assert.equal(await client(fetch).getFileContent('members/alice/posts/x/index.md'), 'taken');
  assert.match(calls[0].url, /ref=main$/);
  assert.doesNotMatch(calls[0].url, /undefined/);
});

test('a refused read surfaces as an error with its status', async () => {
  const { fetch } = recorder([{ match: '/membership/my-pulls', status: 401, body: { error: 'unauthorized' } }]);
  await assert.rejects(client(fetch).listMyPulls(), (e) => e instanceof GitHubError && e.status === 401);
});

test('a client cannot be made without a token or an upstream', () => {
  assert.throws(() => createRepoClient({ upstream: 'a/b' }), /token is required/);
  assert.throws(() => createRepoClient({ token: 't' }), /upstream/);
});

test('branchName: deterministic per item, house items prefixed so they cannot collide with a member item', () => {
  assert.equal(branchName('post', 'hello'), 'gbti/post-hello');
  assert.equal(branchName('post', 'hello', 'house'), 'gbti/house-post-hello');
  assert.equal(branchName('profile'), 'gbti/profile');
});
