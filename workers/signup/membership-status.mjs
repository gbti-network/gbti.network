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

export async function membershipStatus(request, env, { fetchImpl = globalThis.fetch, makeStripe = createStripeClient, fetchUser = githubFetchUser } = {}) {
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
  return { status: 200, body: { ok: true, github_id: user.githubId, login: user.githubLogin || null, status } };
}
