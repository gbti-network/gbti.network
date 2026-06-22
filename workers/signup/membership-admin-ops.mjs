// SOW-038 Phase 3: superadmin/admin-gated OPERATIONS triggers. The dashboard fires reconcile / E2E-smoke from a
// button instead of the owner running `gh workflow run` by hand. The Worker holds the dispatch token and fires a
// GitHub `repository_dispatch` (the SAME API + token the post-payment `regate` already uses) for an ALLOW-LISTED
// event type only — a caller can never name an arbitrary workflow/event. Fail-closed: the admin gate (token ->
// github_id -> role from the fresh KV overrides mirror) runs FIRST; a missing token is a clean 500 (inert until the
// owner sets REGATE_DISPATCH_TOKEN, exactly like the regate path). Pure over injected authorize/fetch.

import { authorizeAdmin } from './membership-admin.mjs';

// action -> the repository_dispatch event_type the matching workflow listens for. The ONLY operations a caller can
// trigger; anything else 400s. (reconcile.yml: types [regate, admin-reconcile]; e2e-smoke.yml: types [admin-e2e].)
const OPS = Object.freeze({ reconcile: 'admin-reconcile', e2e: 'admin-e2e', 'category-migrate': 'category-migrate' }); // SOW-055
const MIGRATE_ACTIONS = new Set(['move', 'rename', 'remove']);

/** POST /membership/admin/ops { action } -> fires the mapped repository_dispatch (admin/superadmin only). */
export async function membershipAdminOps(request, env, { authorize = authorizeAdmin, fetch = globalThis.fetch, ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };

  let body;
  try { body = await request.json(); } catch { body = null; }
  const action = String(body?.action || '').trim();
  const eventType = OPS[action];
  if (!eventType) return { status: 400, body: { error: 'bad_request', message: 'unknown operation' } };

  // SOW-055: category-migrate forwards the (validated) migration params in client_payload; reconcile/e2e carry
  // only `by`. The migration params name a path-changing taxonomy op; the migrate-category Action + the pure core
  // re-validate, so the Worker only checks the shape (a known inner action + a non-empty source path).
  let clientPayload = { by: auth.githubId };
  if (action === 'category-migrate') {
    const p = (body && body.params) || {};
    if (!MIGRATE_ACTIONS.has(String(p.action)) || !String(p.from || '').trim()) {
      return { status: 400, body: { error: 'bad_request', message: 'category-migrate requires params { action: move|rename|remove, from }' } };
    }
    const bool = (v) => (v === true || v === 'true' ? 'true' : 'false');
    clientPayload = {
      by: auth.githubId,
      action: String(p.action),
      from: String(p.from).trim(),
      to_parent: String(p.toParent ?? p.to_parent ?? '').trim(),
      new_key: String(p.newKey ?? p.new_key ?? '').trim(),
      reassign: bool(p.reassign),
      apply: bool(p.apply),
    };
  }

  const token = env.REGATE_DISPATCH_TOKEN;
  const repo = env.GITHUB_CONTENT_REPO;
  if (!token || !repo) return { status: 500, body: { error: 'misconfigured', message: 'operations dispatch is not configured yet' } };

  // NOTE: for reconcile, client_payload carries `by` (the actor), NOT `github_id` — reconcile's targetedGithubId
  // only narrows to a single member when client_payload.github_id is present, so admin-reconcile runs a FULL --apply.
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gbti-network-signup',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
    });
    if (res.status === 204) return { status: 200, body: { ok: true, triggered: action } };
    return { status: 502, body: { error: 'dispatch_failed', message: `GitHub returned ${res.status}` } };
  } catch {
    return { status: 502, body: { error: 'dispatch_failed', message: 'could not reach GitHub' } };
  }
}
