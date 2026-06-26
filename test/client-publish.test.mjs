// SOW-006 publish orchestration + GitHub repo client. publishContent is tested against a fake repo client
// (orchestration logic: fork -> branch -> create-vs-update -> open-or-reuse PR); createRepoClient is tested
// against a fake fetch (the tricky REST paths: 404/422 handling, gate-status interpretation).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildContentFile } from '../client/src/content-ops.mjs';
import { publishContent, publishFiles, commitToBranchOnFork, branchName } from '../client/src/publish.mjs';
import { createRepoClient, toBase64, interpretGateState } from '../client/src/github-repo.mjs';

function fakeRepo({ existingFileSha = null, existingPull = null } = {}) {
  const calls = [];
  return {
    upstream: 'gbti-network/gbti.network',
    calls,
    async ensureFork() { calls.push(['ensureFork']); return { full_name: 'alice/gbti.network', owner: 'alice' }; },
    async getDefaultBranch(r) { calls.push(['getDefaultBranch', r]); return 'main'; },
    async getBranchSha(r, b) { calls.push(['getBranchSha', r, b]); return 'basesha'; },
    async ensureBranch(r, b, sha) { calls.push(['ensureBranch', r, b, sha]); },
    async getFileSha(r, p, ref) { calls.push(['getFileSha', r, p, ref]); return existingFileSha; },
    async putFile(r, p, opts) { calls.push(['putFile', r, p, opts]); },
    async deleteFile(r, p, opts) { calls.push(['deleteFile', r, p, opts]); },
    async findOpenPull({ head }) { calls.push(['findOpenPull', head]); return existingPull; },
    async openPull(opts) { calls.push(['openPull', opts]); return { number: 42, html_url: 'https://github.com/gbti-network/gbti.network/pull/42' }; },
  };
}

const samplePost = () => buildContentFile({
  type: 'post', username: 'alice',
  input: { title: 'Hello', slug: 'hello' }, body: 'Body',
});

test('branchName: deterministic per item', () => {
  assert.equal(branchName('post', 'hello'), 'gbti/post-hello');
  assert.equal(branchName('profile'), 'gbti/profile');
});

test('publishContent: new content forks, branches, creates the file, opens a PR', async () => {
  const repo = fakeRepo();
  const out = await publishContent({ repo, change: samplePost() });
  assert.equal(out.updated, false);
  assert.equal(out.prNumber, 42);
  assert.equal(out.branch, 'gbti/post-hello');
  assert.equal(out.fork, 'alice/gbti.network');

  const put = repo.calls.find((c) => c[0] === 'putFile');
  assert.equal(put[1], 'alice/gbti.network');
  assert.equal(put[2], 'members/alice/posts/hello/index.md');
  assert.equal(put[3].branch, 'gbti/post-hello');
  assert.equal(put[3].sha, undefined, 'a new file has no prior blob sha');

  const open = repo.calls.find((c) => c[0] === 'openPull');
  assert.equal(open[1].head, 'alice:gbti/post-hello');
  assert.equal(open[1].base, 'main');
});

test('publishContent: an existing file on the branch is UPDATED (passes the blob sha)', async () => {
  const repo = fakeRepo({ existingFileSha: 'blob-sha-1' });
  await publishContent({ repo, change: samplePost() });
  const put = repo.calls.find((c) => c[0] === 'putFile');
  assert.equal(put[3].sha, 'blob-sha-1');
});

test('publishContent: an existing open PR is reused, not duplicated', async () => {
  const repo = fakeRepo({ existingPull: { number: 7, html_url: 'https://github.com/x/pull/7' } });
  const out = await publishContent({ repo, change: samplePost() });
  assert.equal(out.updated, true);
  assert.equal(out.prNumber, 7);
  assert.equal(repo.calls.some((c) => c[0] === 'openPull'), false, 'must not open a second PR');
});

test('publishContent: rejects a change that is not a built content file', async () => {
  await assert.rejects(publishContent({ repo: fakeRepo(), change: { type: 'post' } }), /built content change/);
});

// ---- SOW-082: commitToBranchOnFork (the shared fork-commit primitive; Save uses it WITHOUT opening a PR) ----

test('commitToBranchOnFork: commits to the fork branch and NEVER opens (or looks for) a PR', async () => {
  const repo = fakeRepo();
  const out = await commitToBranchOnFork({
    repo, branch: 'gbti/post-hello',
    files: [{ path: 'members/alice/posts/hello/index.md', content: 'Body' }],
    message: 'Draft: hello',
  });
  assert.deepEqual(out, { fork: 'alice/gbti.network', owner: 'alice', branch: 'gbti/post-hello', base: 'main' });
  const put = repo.calls.find((c) => c[0] === 'putFile');
  assert.equal(put[2], 'members/alice/posts/hello/index.md');
  assert.equal(put[3].branch, 'gbti/post-hello');
  assert.equal(put[3].message, 'Draft: hello');
  // the whole point: a Save must not touch the canonical PR surface
  assert.equal(repo.calls.some((c) => c[0] === 'findOpenPull'), false, 'must not look for a PR');
  assert.equal(repo.calls.some((c) => c[0] === 'openPull'), false, 'must not open a PR');
});

test('commitToBranchOnFork: content:null deletes the file (passing the blob sha), no putFile', async () => {
  const repo = fakeRepo({ existingFileSha: 'blob-7' });
  await commitToBranchOnFork({ repo, branch: 'gbti/post-x', files: [{ path: 'members/alice/posts/x/index.md', content: null }] });
  const del = repo.calls.find((c) => c[0] === 'deleteFile');
  assert.ok(del, 'a content:null file is deleted');
  assert.equal(del[3].sha, 'blob-7');
  assert.equal(repo.calls.some((c) => c[0] === 'putFile'), false);
});

test('commitToBranchOnFork: requires a branch and at least one file', async () => {
  await assert.rejects(commitToBranchOnFork({ repo: fakeRepo(), branch: '', files: [{ path: 'a', content: 'x' }] }), /branch name is required/);
  await assert.rejects(commitToBranchOnFork({ repo: fakeRepo(), branch: 'gbti/post-x', files: [] }), /at least one file/);
});

test('publishFiles: still commits then opens a PR (refactor regression)', async () => {
  const repo = fakeRepo();
  const out = await publishFiles({ repo, branch: 'gbti/post-x', files: [{ path: 'members/alice/posts/x/index.md', content: 'Body' }], message: 'Update' });
  assert.equal(out.prNumber, 42);
  assert.equal(out.fork, 'alice/gbti.network');
  const open = repo.calls.find((c) => c[0] === 'openPull');
  assert.equal(open[1].head, 'alice:gbti/post-x');
  assert.equal(open[1].base, 'main');
});

// ---- createRepoClient against a fake fetch ----

function fetchRouter(routes) {
  return async (url, opts = {}) => {
    const method = (opts.method ?? 'GET').toUpperCase();
    for (const r of routes) {
      if (r.method === method && url.includes(r.match)) {
        const body = r.json !== undefined ? JSON.stringify(r.json) : (r.body ?? '');
        const status = r.status ?? 200;
        return { status, ok: status < 400, text: async () => body };
      }
    }
    return { status: 404, ok: false, text: async () => `no route for ${method} ${url}` };
  };
}

test('toBase64 + interpretGateState', () => {
  assert.equal(Buffer.from(toBase64('hi'), 'base64').toString('utf8'), 'hi');
  assert.equal(interpretGateState('success'), 'mergeable');
  assert.equal(interpretGateState('failure'), 'held');
  assert.equal(interpretGateState('pending'), 'checking');
});

test('toBase64: works without a Buffer global (the MV3 service worker path), incl. UTF-8', () => {
  // The npm host has Buffer; the extension worker does NOT. Simulate the worker by hiding Buffer and confirm
  // the TextEncoder + btoa fallback produces identical, correct base64 (including multibyte characters).
  const saved = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    assert.equal(typeof Buffer, 'undefined'); // the fallback branch is now the live path
    assert.equal(toBase64('hi'), 'aGk=');
    // round-trips a multibyte string back through node's Buffer once restored
    var encoded = toBase64('héllo · 世界 🚀');
  } finally {
    globalThis.Buffer = saved;
  }
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), 'héllo · 世界 🚀');
  assert.equal(toBase64('héllo · 世界 🚀'), encoded, 'Buffer and fallback paths agree byte-for-byte');
});

test('repo.ensureFork: returns full_name + owner', async () => {
  const fetch = fetchRouter([
    { method: 'POST', match: '/forks', json: { full_name: 'alice/gbti.network', owner: { login: 'alice' }, default_branch: 'main' } },
  ]);
  const repo = createRepoClient({ token: 't', upstream: 'gbti-network/gbti.network', fetch });
  const fork = await repo.ensureFork();
  assert.equal(fork.full_name, 'alice/gbti.network');
  assert.equal(fork.owner, 'alice');
});

test('repo.getFileSha: 404 -> null, 200 -> sha', async () => {
  const missing = createRepoClient({ token: 't', upstream: 'u/r', fetch: fetchRouter([{ method: 'GET', match: '/contents/', status: 404 }]) });
  assert.equal(await missing.getFileSha('u/r', 'a.md', 'b'), null);

  const present = createRepoClient({ token: 't', upstream: 'u/r', fetch: fetchRouter([{ method: 'GET', match: '/contents/', json: { sha: 'blob9' } }]) });
  assert.equal(await present.getFileSha('u/r', 'a.md', 'b'), 'blob9');
});

test('repo.ensureBranch: a 422 (already exists) is swallowed', async () => {
  const repo = createRepoClient({ token: 't', upstream: 'u/r', fetch: fetchRouter([{ method: 'POST', match: '/git/refs', status: 422, body: 'exists' }]) });
  await repo.ensureBranch('u/r', 'gbti/post-x', 'sha'); // must not throw
});

// ---- SOW-082: fork-staged draft I/O on the repo client ----

test('repo.listMatchingRefs: maps refs/heads/<prefix>* to branch names; 404 -> []', async () => {
  const repo = createRepoClient({ token: 't', upstream: 'u/r', fetch: fetchRouter([
    { method: 'GET', match: '/git/matching-refs/heads/gbti/', json: [
      { ref: 'refs/heads/gbti/post-a', object: { sha: 's1' } },
      { ref: 'refs/heads/gbti/profile', object: { sha: 's2' } },
    ] },
  ]) });
  const refs = await repo.listMatchingRefs('alice/r', 'gbti/');
  assert.deepEqual(refs.map((r) => r.branch).sort(), ['gbti/post-a', 'gbti/profile']);
  assert.equal(refs[0].sha, 's1');

  const empty = createRepoClient({ token: 't', upstream: 'u/r', fetch: fetchRouter([{ method: 'GET', match: '/matching-refs/', status: 404 }]) });
  assert.deepEqual(await empty.listMatchingRefs('alice/r', 'gbti/'), []);
});

test('repo.getForkFileContent: decodes the fork file at a ref; 404 -> null', async () => {
  const present = createRepoClient({ token: 't', upstream: 'u/r', fetch: fetchRouter([{ method: 'GET', match: '/contents/', json: { content: toBase64('staged body') } }]) });
  assert.equal(await present.getForkFileContent('alice/r', 'members/alice/posts/a/index.md', 'gbti/post-a'), 'staged body');

  const missing = createRepoClient({ token: 't', upstream: 'u/r', fetch: fetchRouter([{ method: 'GET', match: '/contents/', status: 404 }]) });
  assert.equal(await missing.getForkFileContent('alice/r', 'x.md', 'b'), null);
});

test('repo.deleteBranch: DELETEs git/refs/heads with the RAW (unencoded) branch path', async () => {
  let seen = null;
  const fetch = async (url, opts = {}) => { seen = { url, method: (opts.method || 'GET').toUpperCase() }; return { status: 204, ok: true, text: async () => '' }; };
  const repo = createRepoClient({ token: 't', upstream: 'u/r', fetch });
  await repo.deleteBranch('alice/r', 'gbti/post-a');
  assert.equal(seen.method, 'DELETE');
  assert.match(seen.url, /\/repos\/alice\/r\/git\/refs\/heads\/gbti\/post-a$/); // real slashes, not %2F
});

test('repo.gateStatus: reads the membership-gate context and maps it', async () => {
  const fetch = fetchRouter([
    { method: 'GET', match: '/pulls/5', json: { head: { sha: 'abc' } } },
    { method: 'GET', match: '/commits/abc/status', json: { state: 'failure', statuses: [{ context: 'membership-gate', state: 'failure', description: 'held: awaiting paid membership' }] } },
  ]);
  const repo = createRepoClient({ token: 't', upstream: 'u/r', fetch });
  const gs = await repo.gateStatus(5);
  assert.equal(gs.sha, 'abc');
  assert.equal(gs.state, 'failure');
  assert.equal(gs.meaning, 'held');
});
