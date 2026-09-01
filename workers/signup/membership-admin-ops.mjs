// SOW-038 Phase 3: superadmin/admin-gated OPERATIONS triggers. The dashboard fires reconcile / E2E-smoke from a
// button instead of the owner running `gh workflow run` by hand. The Worker holds the dispatch token and fires a
// GitHub `repository_dispatch` (the SAME API + token the post-payment `regate` already uses) for an ALLOW-LISTED
// event type only — a caller can never name an arbitrary workflow/event. Fail-closed: the admin gate (token ->
// github_id -> role from the fresh KV overrides mirror) runs FIRST; a missing token is a clean 500 (inert until the
// owner sets REGATE_DISPATCH_TOKEN, exactly like the regate path). Pure over injected authorize/fetch.

import { authorizeAdmin } from './membership-admin.mjs';

// action -> the repository_dispatch event_type the matching workflow listens for. The ONLY operations a caller can
// trigger; anything else 400s. (reconcile.yml: types [regate, admin-reconcile]; e2e-smoke.yml: types [admin-e2e];
// sync-overrides-mirror.yml: types [sync-mirror].)
//
// WHY sync-mirror IS ITS OWN OP AND NOT JUST "RUN RECONCILE" (sow-213, 2026-08-21). The Worker gates effective-paid
// (ban > staff > grandfather > Stripe) on the KV `overrides:mirror` blob, and the ONLY writers of that blob are two
// Actions: the daily reconcile and sync-overrides-mirror.yml's 6-hourly cron. Nothing fires the mirror refresh on a
// WRITE. So a ban committed to house/bans.yml did not reach the edge for up to six hours, during which the banned
// account kept paid access: member-content decrypt, the publish routes, KV writes. A ban sits at the TOP of the
// precedence chain precisely because it is the emergency stop, and an emergency stop with a six-hour delay is not
// one. `reconcile` also rewrites the mirror, but it is a full Stripe sweep that can abort before the mirror write
// (the exact starvation sync-overrides-mirror.yml exists to prevent), so it is the wrong tool right after a ban.
// This op is the ~1s Stripe-free refresh: ban, then fire this, and the edge agrees immediately.
const OPS = Object.freeze({
  reconcile: 'admin-reconcile',
  e2e: 'admin-e2e',
  'category-migrate': 'category-migrate', // SOW-055
  'sync-mirror': 'sync-mirror',           // sow-213: refresh overrides:mirror NOW, not on the next 6h tick
});
const MIGRATE_ACTIONS = new Set(['move', 'rename', 'remove', 'merge']);

/** POST /membership/admin/ops { action } -> fires the mapped repository_dispatch (admin/superadmin only). */
export async function membershipAdminOps(request, env, { authorize = authorizeAdmin, fetch = globalThis.fetch, allowCookie = false, ...deps } = {}) {
  // sow-161 A least-privilege: read the action FIRST, only to scope the cookie path. Just ONE of the four ops
  // (category-migrate, which the website categories workspace needs) accepts a website COOKIE identity; reconcile
  // (a full --apply, per the note below), e2e and sync-mirror stay BEARER-ONLY even when the route enables
  // cookies, so needing category-migrate from the website does not make the other three reachable from a browser
  // session as a side effect. Reading the body before authorize is safe: the CSRF double-submit in resolveIdentity
  // uses a request header + cookie, never the body (the earlier code proved this by reading the body AFTER auth).
  let body;
  try { body = await request.json(); } catch { body = null; }
  const action = String(body?.action || '').trim();
  // Authorize BEFORE validating the action (fail-closed: an unauthenticated caller gets 401, not a 400 that would
  // leak which action names exist, and an invalid action over cookies is refused before anything, so the gate is
  // not an action-enumeration oracle). A bearer caller reaches all four; a cookie caller only category-migrate.
  // Letting an unauthenticated caller pick the auth path by naming the action is safe because the cookie path is
  // DIFFERENT, not WEAKER: it still requires a valid signed session HMAC plus the CSRF double-submit, and the
  // action is validated against OPS either way. Naming category-migrate buys a different identity requirement,
  // not a lower bar.
  const auth = await authorize(request, env, { ...deps, allowCookie: allowCookie && action === 'category-migrate' });
  if (!auth.ok) return { status: auth.status, body: auth.body };

  const eventType = OPS[action];
  if (!eventType) return { status: 400, body: { error: 'bad_request', message: 'unknown operation' } };

  // SOW-055: category-migrate forwards the (validated) migration params in client_payload; reconcile/e2e carry
  // only `by`. The migration params name a path-changing taxonomy op; the migrate-category Action + the pure core
  // re-validate, so the Worker only checks the shape (a known inner action + a non-empty source path).
  let clientPayload = { by: auth.githubId };
  if (action === 'category-migrate') {
    const p = (body && body.params) || {};
    if (!MIGRATE_ACTIONS.has(String(p.action)) || !String(p.from || '').trim()) {
      return { status: 400, body: { error: 'bad_request', message: 'category-migrate requires params { action: move|rename|remove|merge, from }' } };
    }
    const bool = (v) => (v === true || v === 'true' ? 'true' : 'false');
    clientPayload = {
      by: auth.githubId,
      action: String(p.action),
      from: String(p.from).trim(),
      to_parent: String(p.toParent ?? p.to_parent ?? '').trim(),
      new_key: String(p.newKey ?? p.new_key ?? '').trim(),
      reassign: bool(p.reassign),
      into: String(p.into ?? '').trim(), // merge destination path (slash-joined)
      apply: bool(p.apply),
    };
  }

  // NOTE: for reconcile, client_payload carries `by` (the actor), NOT `github_id` — reconcile's targetedGithubId
  // only narrows to a single member when client_payload.github_id is present, so admin-reconcile runs a FULL --apply.
  const fired = await fireRepositoryDispatch({ env, eventType, clientPayload, fetchImpl: fetch });
  if (fired.reason === 'not configured') return { status: 500, body: { error: 'misconfigured', message: 'operations dispatch is not configured yet' } };
  if (!fired.fired) return { status: 502, body: { error: 'dispatch_failed', message: fired.reason } };
  return { status: 200, body: { ok: true, triggered: action } };
}

/**
 * sow-213 Phase 2b: fire one repository_dispatch. Extracted from membershipAdminOps so the admin AUTHOR
 * endpoint can reuse it after a role change without a second copy of the dispatch call.
 *
 * WHY A ROLE CHANGE NEEDS THIS AND A BAN NO LONGER DOES. Bans and grandfather grants are now dual-written
 * straight into overrides:mirror by the author endpoint, so they reach the edge within the request. Roles are
 * deliberately NOT dual-written: house/roles.yml is the root of trust for the anti-escalation model, and
 * letting the Worker write staff status into KV would create an escalation path that does not exist today, one
 * that bypasses CODEOWNERS entirely. So the role change goes to git, and this asks the workflow to re-derive
 * the mirror FROM git. Authority stays where it was; only the latency changes, from six hours to about a second.
 */
export async function fireRepositoryDispatch({ env, eventType, clientPayload = {}, fetchImpl = globalThis.fetch }) {
  const token = env?.REGATE_DISPATCH_TOKEN;
  const repo = env?.GITHUB_CONTENT_REPO;
  if (!token || !repo) return { fired: false, reason: 'not configured' };
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/dispatches`, {
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
    if (res.status === 204) return { fired: true, reason: null };
    return { fired: false, reason: `GitHub returned ${res.status}` };
  } catch {
    return { fired: false, reason: 'could not reach GitHub' };
  }
}
