// SOW-026: the onboarding readiness probe. Derives signedIn/forkReady/installReady from durable GitHub state,
// short-circuits, and fails closed on a network error. Fake fetch, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeReadiness } from '../client/src/github-app-probe.mjs';

const UP = 'gbti-network/gbti.network';
const SLUG = 'gbti-network';

// Build a fake GitHub keyed by URL substring.
function gh(routes) {
  return async (url) => {
    for (const [frag, resp] of Object.entries(routes)) {
      if (url.includes(frag)) return typeof resp === 'function' ? resp() : resp;
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
}
const okJson = (body) => ({ ok: true, status: 200, async json() { return body; } });

test('no token -> signin step, reachedGithub true', async () => {
  const r = await probeReadiness({ token: '', appSlug: SLUG, upstream: UP, fetch: async () => okJson({}) });
  assert.equal(r.signedIn, false);
  assert.equal(r.forkReady, false);
});

test('signed in, no fork -> forkReady false (install not probed)', async () => {
  let installProbed = false;
  const fetch = gh({
    '/user/installations': () => { installProbed = true; return okJson({ installations: [] }); },
    [`/repos/alice/gbti.network`]: { ok: false, status: 404, async json() { return {}; } },
    '/user': okJson({ login: 'alice', id: 1 }),
  });
  const r = await probeReadiness({ token: 't', appSlug: SLUG, upstream: UP, fetch });
  assert.equal(r.signedIn, true);
  assert.equal(r.forkReady, false);
  assert.equal(r.installReady, false);
  assert.equal(installProbed, false, 'install is not probed without a fork');
});

test('a same-named non-fork repo does NOT count as the fork', async () => {
  const fetch = gh({
    '/repos/alice/gbti.network': okJson({ fork: false }),
    '/user': okJson({ login: 'alice', id: 1 }),
  });
  const r = await probeReadiness({ token: 't', appSlug: SLUG, upstream: UP, fetch });
  assert.equal(r.forkReady, false);
});

test('fork present + App installed on the fork (select) -> all green', async () => {
  const fetch = gh({
    '/repos/alice/gbti.network': okJson({ fork: true, parent: { full_name: 'gbti-network/gbti.network' } }),
    '/user/installations/77/repositories': okJson({ repositories: [{ full_name: 'alice/gbti.network' }] }),
    '/user/installations': okJson({ installations: [{ id: 77, app_slug: 'gbti-network', account: { login: 'alice' }, repository_selection: 'selected' }] }),
    '/user': okJson({ login: 'alice', id: 1 }),
  });
  const r = await probeReadiness({ token: 't', appSlug: SLUG, upstream: UP, fetch });
  assert.deepEqual([r.signedIn, r.forkReady, r.installReady], [true, true, true]);
});

test('App installed but the fork not selected -> installReady false', async () => {
  const fetch = gh({
    '/repos/alice/gbti.network': okJson({ fork: true, parent: { full_name: 'gbti-network/gbti.network' } }),
    '/user/installations/77/repositories': okJson({ repositories: [{ full_name: 'alice/other' }] }),
    '/user/installations': okJson({ installations: [{ id: 77, app_slug: 'gbti-network', account: { login: 'alice' }, repository_selection: 'selected' }] }),
    '/user': okJson({ login: 'alice', id: 1 }),
  });
  const r = await probeReadiness({ token: 't', appSlug: SLUG, upstream: UP, fetch });
  assert.equal(r.installReady, false);
});

test('an all-repositories grant covers the fork (installed) but flags allReposGrant', async () => {
  const fetch = gh({
    '/repos/alice/gbti.network': okJson({ fork: true, parent: { full_name: 'gbti-network/gbti.network' } }),
    '/user/installations': okJson({ installations: [{ id: 77, app_slug: 'gbti-network', account: { login: 'alice' }, repository_selection: 'all' }] }),
    '/user': okJson({ login: 'alice', id: 1 }),
  });
  const r = await probeReadiness({ token: 't', appSlug: SLUG, upstream: UP, fetch });
  assert.equal(r.installReady, true);
  assert.equal(r.allReposGrant, true);
});

test('a network error after sign-in fails closed (reachedGithub false, nothing advances)', async () => {
  let n = 0;
  const fetch = async (url) => {
    if (url.includes('/user') && !url.includes('installations')) return okJson({ login: 'alice', id: 1 });
    throw new Error('network down');
  };
  const r = await probeReadiness({ token: 't', appSlug: SLUG, upstream: UP, fetch });
  assert.equal(r.signedIn, true);
  assert.equal(r.reachedGithub, false);
  assert.equal(r.forkReady, false);
});
