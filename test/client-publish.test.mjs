// SOW-006 publish orchestration + GitHub repo client. publishContent is tested against a fake repo client
// (orchestration logic: fork -> branch -> create-vs-update -> open-or-reuse PR); createRepoClient is tested
// against a fake fetch (the tricky REST paths: 404/422 handling, gate-status interpretation).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildContentFile } from '../client/src/content-ops.mjs';
import { publishContent, branchName } from '../client/src/publish.mjs';
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
