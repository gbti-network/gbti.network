// SOW-011: the membership-status oracle. The local client (the Chrome extension + the npm host) holds no
// Stripe key, so it asks the Worker for the signed-in member's Stripe-derived status. We authenticate the
// caller by their GitHub token: verify it against GitHub /user to resolve the immutable github_id, then derive
// the status from Stripe. The client folds in the git-native overrides (staff / grandfather / ban) itself. The
// token is used read-only to identify the caller and is never stored.
//
// Returns { status, body } so the router can wrap it in json() with CORS headers. Pure over injected
// fetch/clients, so it is unit-tested with fakes (no network, no secrets).

import { githubFetchUser } from './oauth.mjs';
import { deriveStatus } from '../../membership/derive-status.mjs';
import { createStripeClient } from '../../clients/stripe.mjs';
import { rolesFromParsed, roleOf, curatorsFromParsed, isCurator, canCurateNews } from '../../membership/overrides-core.mjs';
import { OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from './membership-content.mjs';

// SOW-046 C: best-effort read of the caller's NEWS-CURATOR capability from the KV overrides mirror. Used ONLY to
// hint the client UI (show the "Add to Discord" action); the Worker re-checks server-side on every publish, so a
// stale/absent mirror just hides the button (fail-closed for the capability, never for the status itself).
async function readCanCurate(env, githubId, now = new Date()) {
  try {
    const mirror = await env.SIGNUP_KV.get(OVERRIDES_KV_KEY, 'json');
    if (!mirror || !mirror.generatedAt || mirror.roles == null || typeof mirror.roles !== 'object' || Array.isArray(mirror.roles)) return false;
    const ageMs = now.getTime() - new Date(mirror.generatedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OVERRIDES_AGE_MS) return false;
    const role = roleOf(githubId, rolesFromParsed(mirror.roles));
    return canCurateNews(role, isCurator(githubId, curatorsFromParsed(mirror.roles)));
  } catch {
    return false;
  }
}

export async function membershipStatus(request, env, { fetchImpl = globalThis.fetch, makeStripe = createStripeClient, fetchUser = githubFetchUser, now = new Date() } = {}) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return { status: 401, body: { error: 'unauthorized', message: 'a GitHub bearer token is required' } };

  let user;
  try {
    user = await fetchUser(token, fetchImpl);
  } catch {
    return { status: 401, body: { error: 'unauthorized', message: 'could not verify the GitHub token' } };
  }
  if (!user?.githubId) return { status: 401, body: { error: 'unauthorized', message: 'the GitHub token has no user id' } };

  if (!env?.STRIPE_SECRET_KEY) return { status: 500, body: { error: 'misconfigured', message: 'Stripe is not configured' } };
  const stripe = makeStripe({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl });

  // deriveStatus already fails closed to 'none' on any lookup error, so a Stripe outage never default-opens.
  const status = await deriveStatus(user.githubId, stripe);
  const canCurate = await readCanCurate(env, String(user.githubId), now); // SOW-046 C: UI hint only; the Worker re-checks on publish
  return { status: 200, body: { ok: true, github_id: user.githubId, login: user.githubLogin || null, status, canCurate } };
}
