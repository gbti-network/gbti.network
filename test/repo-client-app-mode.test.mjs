// SOW-026: the fork-aware repo client in APP mode (fork-scoped token): ensureFork VERIFIES (not creates),
// openPull delegates to the Worker, findOpenPull is a no-op. Classic mode is unchanged. Injected appMode +
// signupBase + fetch, so no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepoClient, GitHubError } from '../client/src/github-repo.mjs';

const UP = 'gbti-network/gbti.network';
const SB = 'https://signup.example';

function recorder(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    for (const [frag, resp] of Object.entries(routes)) {
      if (url.includes(frag)) { const r = typeof resp === 'function' ? resp() : resp; return r; }
    }
    return { ok: false, status: 404, async text() { return 'not found'; } };
  };
  return { fetch, calls };
}
const ghOk = (body) => ({ ok: true, status: 200, async text() { return JSON.stringify(body); } });
const appClient = (fetch) => createRepoClient({ token: 'tok', upstream: UP, fetch, appMode: true, signupBase: SB });

test('app mode ensureFork VERIFIES an existing fork (GET), never POST /forks', async () => {
  const { fetch, calls } = recorder({
    '/user': ghOk({ login: 'Alice', id: 1 }),
    '/repos/alice/gbti.network': ghOk({ full_name: 'alice/gbti.network', owner: { login: 'alice' }, fork: true, default_branch: 'main' }),
  });
  const f = await appClient(fetch).ensureFork();
  assert.equal(f.full_name, 'alice/gbti.network');
  assert.ok(!calls.some((c) => c.method === 'POST' && /\/forks$/.test(c.url)), 'no fork creation in app mode');
});

test('app mode ensureFork throws a setup hint when the fork is missing (404)', async () => {
  const { fetch } = recorder({ '/user': ghOk({ login: 'alice', id: 1 }) }); // /repos -> default 404
  await assert.rejects(() => appClient(fetch).ensureFork(), (e) => e instanceof GitHubError && /Finish setup/.test(e.body));
});

test('app mode ensureFork rejects a same-named non-fork (409)', async () => {
  const { fetch } = recorder({ '/user': ghOk({ login: 'alice', id: 1 }), '/repos/alice/gbti.network': ghOk({ full_name: 'alice/gbti.network', fork: false }) });
  await assert.rejects(() => appClient(fetch).ensureFork(), (e) => e instanceof GitHubError && e.status === 409);
});

test('app mode openPull delegates to the Worker /membership/open-pr with the bearer token', async () => {
  const { fetch, calls } = recorder({ '/membership/open-pr': ghOk({ ok: true, number: 12, html_url: 'https://x/pull/12' }) });
  const r = await appClient(fetch).openPull({ title: 'T', head: 'alice:b', base: 'main', body: 'B' });
  assert.deepEqual(r, { number: 12, html_url: 'https://x/pull/12', already: false });
  const c = calls.find((c) => c.url.includes('/membership/open-pr'));
  assert.equal(c.method, 'POST');
  assert.equal(c.auth, 'Bearer tok');
  assert.deepEqual(c.body, { title: 'T', head: 'alice:b', base: 'main', body: 'B' });
});

test('app mode openPull surfaces the Worker already-exists result', async () => {
  const { fetch } = recorder({ '/membership/open-pr': ghOk({ ok: true, number: null, html_url: null, already: true }) });
  const r = await appClient(fetch).openPull({ title: 'T', head: 'alice:b', base: 'main' });
  assert.equal(r.already, true);
});

test('app mode findOpenPull is a no-op (no upstream read)', async () => {
  const { fetch, calls } = recorder({});
  const r = await appClient(fetch).findOpenPull({ head: 'alice:b' });
  assert.equal(r, null);
  assert.equal(calls.length, 0, 'no upstream fetch in app mode');
});

test('app mode listMyPulls proxies to the Worker /membership/my-pulls (no upstream search)', async () => {
  // SOW-033 P4: the Worker returns state + merged; the client passes its items through verbatim.
  const { fetch, calls } = recorder({ '/membership/my-pulls': ghOk({ ok: true, items: [{ number: 7, title: 'Mine', html_url: 'u7', state: 'closed', merged: true }] }) });
  const r = await appClient(fetch).listMyPulls('alice');
  assert.deepEqual(r, [{ number: 7, title: 'Mine', html_url: 'u7', state: 'closed', merged: true }]);
  const c = calls.find((c) => c.url.includes('/membership/my-pulls'));
  assert.equal(c.method, 'GET');
  assert.equal(c.auth, 'Bearer tok');
  assert.ok(!calls.some((c) => c.url.includes('/search/issues')), 'no upstream search in app mode');
});

test('app mode gateStatus proxies to the Worker /membership/pr-status with the PR number', async () => {
  const { fetch, calls } = recorder({ '/membership/pr-status': ghOk({ ok: true, state: 'failure', meaning: 'held', sha: 'abc', description: 'publishing requires paid membership' }) });
  const r = await appClient(fetch).gateStatus(7);
  assert.deepEqual(r, { state: 'failure', meaning: 'held', sha: 'abc', description: 'publishing requires paid membership' });
  const c = calls.find((c) => c.url.includes('/membership/pr-status'));
  assert.equal(c.method, 'GET');
  assert.ok(c.url.includes('number=7'), 'passes the PR number');
  assert.ok(!calls.some((c) => /\/repos\/.+\/commits\//.test(c.url)), 'no upstream commit-status read in app mode');
});

test('classic mode listMyPulls + gateStatus still read the upstream directly (unchanged)', async () => {
  const { fetch, calls } = recorder({
    // SOW-033 P4: open + merged + closed PRs are returned, each with state + a merged flag (from pull_request.merged_at).
    '/search/issues': ghOk({ items: [
      { number: 3, title: 'C', html_url: 'u3', state: 'open' },
      { number: 4, title: 'M', html_url: 'u4', state: 'closed', pull_request: { merged_at: '2026-06-01T00:00:00Z' } },
      { number: 5, title: 'X', html_url: 'u5', state: 'closed', pull_request: { merged_at: null } },
    ] }),
    '/pulls/3': ghOk({ head: { sha: 'sha3' } }),
    '/commits/sha3/status': ghOk({ state: 'success', statuses: [{ context: 'membership-gate', state: 'success' }] }),
  });
  const c = createRepoClient({ token: 'tok', upstream: UP, fetch, appMode: false, signupBase: SB });
  assert.deepEqual(await c.listMyPulls('alice'), [
    { number: 3, title: 'C', html_url: 'u3', state: 'open', merged: false },
    { number: 4, title: 'M', html_url: 'u4', state: 'closed', merged: true },
    { number: 5, title: 'X', html_url: 'u5', state: 'closed', merged: false },
  ]);
  // the search query no longer pins state:open (so closed/merged are returned), still scoped to author + repo
  const search = calls.find((x) => x.url.includes('/search/issues'));
  assert.ok(/author%3Aalice/.test(search.url) && !/state%3Aopen/.test(search.url), 'author-scoped, no state:open pin');
  const gs = await c.gateStatus(3);
  assert.equal(gs.meaning, 'mergeable');
  assert.ok(!calls.some((x) => x.url.includes('/membership/')), 'classic mode never hits the Worker');
});

test('classic mode is unchanged: ensureFork POSTs /forks, openPull POSTs upstream pulls', async () => {
  const { fetch, calls } = recorder({
    '/forks': ghOk({ full_name: 'alice/gbti.network', owner: { login: 'alice' }, default_branch: 'main' }),
    '/pulls': ghOk({ number: 5, html_url: 'u' }),
  });
  const c = createRepoClient({ token: 'tok', upstream: UP, fetch, appMode: false, signupBase: SB });
  await c.ensureFork();
  await c.openPull({ title: 'T', head: 'alice:b', base: 'main', body: '' });
  assert.ok(calls.some((x) => x.method === 'POST' && /\/repos\/gbti-network\/gbti\.network\/forks$/.test(x.url)));
  assert.ok(calls.some((x) => x.method === 'POST' && /\/repos\/gbti-network\/gbti\.network\/pulls$/.test(x.url)));
});
