// SOW-038 P2: admin-only per-member Stripe status, for the superadmin dashboard roster. The dashboard already
// shows OVERRIDE-derived status (ban > staff > grandfather) from the public repo; this fills in the live Stripe
// tier (paid / trialing / expired / cancelled / none) that is NOT reachable from public data.
//
//   GET /membership/admin/statuses -> { ok, statuses: { <github_id>: '<stripe status>' } }
//
// authorizeAdmin() applies the SAME fail-closed gate as membership-content: identity from the verified GitHub
// token only, the caller's role read from the reconcile-written SIGNUP_KV overrides mirror with the same
// staleness + shape checks, and ONLY an admin/superadmin passes. Billing status is sensitive, so this never
// reaches a non-admin and is never cached. Pure over injected deps so it unit-tests with no network/secrets.

import { githubFetchUser } from './oauth.mjs';
import { rolesFromParsed, roleOf, isAdminRole, curatorsFromParsed, isCurator, canCurateNews, bansFromParsed, isBanned } from '../../membership/overrides-core.mjs';
import { deriveStatusFromCustomer } from '../../membership/derive-status.mjs';
import { createStripeClient } from '../../clients/stripe.mjs';
import { OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from './membership-content.mjs';

const fail = (status, error, message) => ({ ok: false, status, body: { error, message } });

/**
 * Authorize an ADMIN/superadmin caller. Identity comes ONLY from the verified token; the role comes from the
 * SIGNUP_KV overrides mirror (same staleness + shape checks as membership-content), FAIL CLOSED on a
 * missing/unverifiable token, a missing/stale/incomplete mirror, or a non-admin role.
 * Returns { ok:true, githubId, role } or { ok:false, status, body }.
 */
// Verify the token -> github_id and read the fresh overrides mirror, returning the caller's role + curator flag.
// Shared, fail-closed prefix for authorizeAdmin + authorizeCurator. Returns { ok, githubId, role, isCurator, mirror }.
async function resolveCaller(request, env, { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, now = new Date() } = {}) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return fail(401, 'unauthorized', 'a GitHub bearer token is required');

  let user;
  try { user = await fetchUser(token, fetchImpl); } catch { return fail(401, 'unauthorized', 'could not verify the GitHub token'); }
  if (!user?.githubId) return fail(401, 'unauthorized', 'the GitHub token has no user id');
  const githubId = String(user.githubId);

  let mirror = null;
  try { mirror = await env.SIGNUP_KV.get(OVERRIDES_KV_KEY, 'json'); } catch { mirror = null; }
  if (!mirror || !mirror.generatedAt) return fail(403, 'forbidden', 'member overrides are unavailable right now');
  const ageMs = now.getTime() - new Date(mirror.generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OVERRIDES_AGE_MS) return fail(403, 'forbidden', 'member overrides are stale right now');
  const isSection = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
  if (!isSection(mirror.roles)) return fail(403, 'forbidden', 'member overrides are incomplete right now');

  // SOW-078: ban > staff. This admin/curator path read ONLY roles, so a banned admin/superadmin/curator kept full
  // powers (statuses enumeration, ops dispatch, news publish, syndication). Read the bans section too (fail closed
  // if it is missing/malformed, exactly like roles) and deny a banned caller before any role grant.
  if (!isSection(mirror.bans)) return fail(403, 'forbidden', 'member overrides are incomplete right now');
  if (isBanned(githubId, bansFromParsed(mirror.bans))) return fail(403, 'forbidden', 'this account is not permitted');

  const role = roleOf(githubId, rolesFromParsed(mirror.roles));
  return { ok: true, githubId, role, isCurator: isCurator(githubId, curatorsFromParsed(mirror.roles)), mirror };
}

/**
 * Authorize an ADMIN/superadmin caller. Identity comes ONLY from the verified token; the role from the SIGNUP_KV
 * overrides mirror. FAIL CLOSED on a missing/unverifiable token, a missing/stale/incomplete mirror, or a
 * non-admin role. Returns { ok:true, githubId, role } or { ok:false, status, body }.
 */
export async function authorizeAdmin(request, env, deps = {}) {
  const r = await resolveCaller(request, env, deps);
  if (!r.ok) return r;
  if (!isAdminRole(r.role)) return fail(403, 'forbidden', 'admin access is required');
  return { ok: true, githubId: r.githubId, role: r.role };
}

/**
 * SOW-046 C: authorize a NEWS CURATOR (admin/superadmin OR an explicit `curators:` listing) for the news->Discord
 * publish. Same fail-closed mirror gate; a plain member with no curator grant is denied. Returns
 * { ok:true, githubId, role, isCurator } or { ok:false, status, body }.
 */
export async function authorizeCurator(request, env, deps = {}) {
  const r = await resolveCaller(request, env, deps);
  if (!r.ok) return r;
  if (!canCurateNews(r.role, r.isCurator)) return fail(403, 'forbidden', 'news curator access is required');
  return { ok: true, githubId: r.githubId, role: r.role, isCurator: r.isCurator };
}

/**
 * GET /membership/admin/statuses — admin-only. Enumerate Stripe customers and return a { github_id -> status }
 * map (the same deriveStatusFromCustomer the reconcile job uses). A customer with no github_id metadata is
 * skipped (not a membership customer). Stripe errors fail closed to a 502 (no partial/guessed data).
 */
export async function membershipAdminStatuses(request, env, deps = {}) {
  const auth = await authorizeAdmin(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!env?.STRIPE_SECRET_KEY) return { status: 500, body: { error: 'misconfigured', message: 'Stripe is not configured' } };

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const stripe = (deps.makeStripe ?? createStripeClient)({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl });
  const now = deps.now ?? new Date();
  const statuses = {};
  try {
    for await (const customer of stripe.listCustomers()) {
      const gid = String(customer?.metadata?.github_id ?? '');
      if (!gid) continue; // not a membership customer
      statuses[gid] = deriveStatusFromCustomer(customer, now);
    }
  } catch {
    return { status: 502, body: { error: 'stripe_unavailable', message: 'could not read membership statuses' } };
  }
  return { status: 200, body: { ok: true, statuses } };
}
