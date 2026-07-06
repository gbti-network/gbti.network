// SOW-106 Phase A: POST /membership/sync-fork — sync the member fork's MAIN branch with upstream, server-side.
// The PR merge-base is frozen at the member's fork point, so any file authored AFTER the fork add/add-conflicts
// on every later edit (the PR #44 class). The member's own token cannot fix this (merge-upstream needs the
// workflows permission; create-ref off an unfetched upstream SHA 404s), but the publisher App is installed on
// each member fork, so the Worker syncs with a FORK-installation token.
//
// The CLIENT calls this best-effort ONLY when the publish path is about to CREATE a branch; existing staged
// branches are never touched, so the SOW-053 concurrent-edit protection (stale-base 3-way merge for edits in
// flight) is preserved. Every outcome is a 200 with { ok, synced, reason? } — a sync miss must never block a
// publish (the client proceeds exactly as before and the SOW-053 conflict surfacing remains the backstop).
//
// Tier: paid OR trialing (whoever may stage drafts, SOW-011/082). Banned/lapsed/none are denied. Pure over
// injected authorize/fetch/token deps, so it unit-tests with fakes.

import { authorizeMember } from './membership-content.mjs';
import { getForkInstallationToken } from './github-app.mjs';

const GH = 'https://api.github.com';
const STAGING_OK = new Set(['paid', 'trialing']); // mirrors membership-content READ_TRIAL_OK (module-private there)
const BRANCH_RE = /^[\w.\/-]{1,100}$/;

export async function membershipSyncFork(request, env, {
  fetchImpl = globalThis.fetch,
  authorize = authorizeMember,
  forkToken = getForkInstallationToken,
  upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
} = {}) {
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  const auth = await authorize(request, env, { fetchImpl });
  if (!auth.ok) return auth;
  if (!STAGING_OK.has(String(auth.status || ''))) {
    return { status: 403, body: { error: 'forbidden', message: 'an active membership is required to publish' } };
  }
  const login = String(auth.login || '').toLowerCase();
  if (!login) return { status: 401, body: { error: 'unauthorized', message: 'could not resolve the member login' } };

  let payload;
  try { payload = await request.json(); } catch { payload = null; }
  const branch = String(payload?.branch || 'main');
  if (!BRANCH_RE.test(branch)) return { status: 400, body: { error: 'bad_request', message: 'invalid branch' } };

  const repoName = String(upstream).split('/')[1] || 'gbti.network';
  const token = await forkToken(env, login, { fetchImpl });
  // No token = the App is not installed on the fork, or the config is absent. A clean miss, never an error.
  if (!token) return { status: 200, body: { ok: true, synced: false, reason: 'unavailable' } };

  let res;
  try {
    res = await fetchImpl(`${GH}/repos/${login}/${repoName}/merge-upstream`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network', 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    });
  } catch {
    return { status: 200, body: { ok: true, synced: false, reason: 'network' } };
  }
  if (res && res.ok) {
    const data = await res.json().catch(() => ({}));
    return { status: 200, body: { ok: true, synced: true, state: data?.merge_type || 'merged' } };
  }
  // 409: the fork branch has diverged (a conflict merge-upstream refuses). 422: the sync would modify workflow
  // files and the App lacks the workflows permission (not yet approved on this installation), or the branch is
  // not tracking upstream. Both are clean misses the client proceeds past.
  const reason = res?.status === 409 ? 'diverged' : res?.status === 422 ? 'permissions' : 'failed';
  return { status: 200, body: { ok: true, synced: false, reason } };
}
