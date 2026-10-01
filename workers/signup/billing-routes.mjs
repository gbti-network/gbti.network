// The billing routes: Stripe Checkout and its success landing, Stripe Connect onboarding for referral payouts, the
// Stripe webhook and the Resend bounce webhook. Moved out of index.mjs at the 900-line limit (owner, 2026-09-30).
// index.mjs calls handleBillingRoutes at the point in its router where these checks stood.

import { verifySession, readSessionCookie } from './session.mjs';
import { resolveCustomerId, createCheckout } from './checkout.mjs';
import { buildCheckoutPriceMap, resolveCheckoutPrice } from '../../membership/checkout-prices.mjs'; // sow-185 3b: multi-price allowlist
import { startOnboarding } from './connect.mjs';
import { verifyStripeSignature, isDuplicateEvent, markEventSeen, handleStripeEvent } from './webhook.mjs';
import { verifyResendSignature, handleResendBounceEvent } from './resend-webhook.mjs'; // sow-324: auto-unsubscribe on email bounce
import { freezeAndPersist } from './conversion-snapshot-store.mjs'; // SOW-059 P1c-B: freeze the attribution at conversion
import { requireOrigin } from './csrf.mjs'; // sow-158 Phase 1b: Origin-only for form-POST routes
import { json, redirect, clientsFromEnv, discordConfig } from './route-helpers.mjs';

async function handleCheckout(request, env) {
  // Cookie-authenticated + state-changing, but it CANNOT use requireCsrf: the site drives this as a top-level
  // form POST so the Lax cookie rides and we can 302 to Stripe, and a form cannot set X-GBTI-CSRF. Enforce the
  // half that IS possible rather than neither (SecurityMaster, 2026-08-11).
  const origin = requireOrigin(request, env);
  if (!origin.ok) return json(origin.body, origin.status);
  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  if (!session) return json({ error: 'no_session' }, 401);

  const { stripe } = clientsFromEnv(env);
  const customerId = await resolveCustomerId({ githubId: session.github_id, kv: env.SIGNUP_KV, stripe });
  if (!customerId) return json({ error: 'no_customer' }, 409); // fail closed

  // sow-185 phase 3b: a requested `?tier=&period=` selects a CONFIGURED price from the allowlist, FAIL CLOSED (an
  // unknown or un-provisioned plan is a 400, never a silent charge at the wrong price). With NEITHER param sent,
  // the default stays the legacy Content Creator annual (env.STRIPE_PRICE_ID), so today's single-price checkout
  // is unchanged until the client CTAs begin sending a tier + period.
  const params = new URL(request.url).searchParams;
  const reqTier = params.get('tier');
  const reqPeriod = params.get('period');
  let priceId = env.STRIPE_PRICE_ID;
  if (reqTier || reqPeriod) {
    priceId = resolveCheckoutPrice({ tier: reqTier, period: reqPeriod }, buildCheckoutPriceMap(env));
    if (!priceId) return json({ error: 'invalid_plan', message: 'that membership plan is not available' }, 400);
  }

  const checkout = await createCheckout({
    stripe,
    customerId,
    priceId,
    githubId: session.github_id,
    baseUrl: env.PUBLIC_BASE_URL,
  });
  return redirect(checkout.url);
}

// FIX 1: the post-payment landing. Stripe's success_url (built in checkout.mjs) points here with a
// `gh` param. We validate that gh against the signed session cookie (the github_id MUST match the
// session) before kicking the targeted re-gate that releases the member's held content PRs and
// upgrades their Discord role right away. Fail closed: if the session is missing or gh does not match
// the session, we still redirect to /account (so the browser lands somewhere sane) but we do NOT kick
// the re-gate; the daily scheduled reconcile heals that member on its next run.
async function handleCheckoutSuccess(request, env) {
  const url = new URL(request.url);
  const gh = url.searchParams.get('gh') || '';
  const accountUrl = `${env.SITE_BASE_URL}/account`;

  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  // The gh param must match the authenticated session's github_id. A missing session, a missing gh,
  // or a mismatch means we cannot trust the caller to nudge a re-gate, so we skip it (fail closed).
  if (!session || !gh || String(session.github_id) !== String(gh)) {
    return redirect(accountUrl);
  }

  const { kickRegate } = await import('./checkout.mjs');
  await kickRegate(
    { githubId: session.github_id, dispatchToken: env.REGATE_DISPATCH_TOKEN, contentRepo: env.GITHUB_CONTENT_REPO },
    globalThis.fetch,
  );
  return redirect(accountUrl);
}

// SOW-007: Stripe Connect Express onboarding for referral payouts. Gated behind REFERRAL_ENABLED (an
// env flag the owner sets to mirror house/referral-config.yml `enabled` when the feature goes live), so
// the onboarding entry point stays dark until referrals are advertised. Both /start (a POST from the
// account page) and /refresh (Stripe's redirect when an Account Link expires) mint a fresh onboarding
// link for the session's own customer. Fail closed: no session or no customer means no onboarding.
async function handleConnectOnboard(request, env) {
  if (env.REFERRAL_ENABLED !== 'true') return json({ error: 'referral_disabled' }, 403);
  // Same shape as /checkout: cookie-authenticated, state-changing, reached without the CSRF choke point.
  const origin = requireOrigin(request, env);
  if (!origin.ok) return json(origin.body, origin.status);
  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  if (!session) return json({ error: 'no_session' }, 401);

  const { stripe } = clientsFromEnv(env);
  const customerId = await resolveCustomerId({ githubId: session.github_id, kv: env.SIGNUP_KV, stripe });
  if (!customerId) return json({ error: 'no_customer' }, 409); // fail closed
  const customer = await stripe.getCustomer(customerId);

  const { url } = await startOnboarding({ stripe, customer, email: customer.email, baseUrl: env.PUBLIC_BASE_URL });
  return redirect(url);
}

// The return_url after onboarding finishes (or the referrer backs out). Onboarding completeness is
// verified server-side by the payout job (it reads the Connect account's payouts_enabled), so here we
// only need to land the browser somewhere sane.
async function handleConnectReturn(request, env) {
  return redirect(`${env.SITE_BASE_URL}/account?connect=done`);
}

async function handleWebhook(request, env) {
  const payload = await request.text();
  const event = await verifyStripeSignature({
    payload,
    signature: request.headers.get('Stripe-Signature'),
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  if (!event) return json({ error: 'invalid_signature' }, 400); // fail closed

  // FIX 2: check-seen BEFORE processing (return early on a true duplicate), but persist the seen-mark
  // ONLY AFTER the handler succeeds. If the handler throws (for example a transient Discord failure),
  // we do NOT mark the event seen and we return a non-2xx so Stripe retries; the retry then re-runs
  // the idempotent handler. Marking seen up front would make a transient failure look like a duplicate
  // on retry and silently drop the role change.
  if (await isDuplicateEvent({ kv: env.SIGNUP_KV, eventId: event.id })) {
    return json({ ok: true, duplicate: true });
  }

  const { stripe, discord } = clientsFromEnv(env);
  let summary;
  try {
    summary = await handleStripeEvent({
      event,
      stripe,
      discord,
      config: discordConfig(env),
      signalDisable: async (githubId) => {
        // Reuse the checkout re-gate dispatch mechanism to signal SOW-005 to disable content.
        const { kickRegate } = await import('./checkout.mjs');
        await kickRegate(
          { githubId, dispatchToken: env.REGATE_DISPATCH_TOKEN, contentRepo: env.GITHUB_CONTENT_REPO },
          globalThis.fetch,
        );
      },
      // SOW-059 P1c-B: at the paid conversion, freeze + persist the attribution snapshot (flag-gated + idempotent;
      // handleStripeEvent already wraps this fail-soft so it never blocks the role swap).
      onConversion: async ({ customer, conversionAt }) => {
        await freezeAndPersist({ env, customer, conversionAt });
      },
    });
  } catch (err) {
    // Do NOT mark the event seen. Return non-2xx so Stripe retries the delivery; the idempotent
    // handler re-runs on the next attempt. Fail closed: no seen-mark is persisted on a failed handler.
    console.error('webhook handler failed', event.id, err?.message);
    return json({ error: 'handler_failed' }, 500);
  }

  // Handler succeeded: now it is safe to record the event id so future retries short-circuit.
  await markEventSeen({ kv: env.SIGNUP_KV, eventId: event.id });
  return json({ ok: true, summary });
}

// sow-324: the Resend bounce/complaint webhook. Mirrors handleWebhook: verify the svix signature over the raw
// body BEFORE parsing, fail closed, dedupe on the svix id, and mark the event seen only after the handler
// succeeds so a transient failure is retried rather than dropped. A permanent bounce or a spam complaint writes
// the same suppression marker a one-click unsubscribe writes, so the drain skips the address on every send.
async function handleResendWebhook(request, env) {
  const payload = await request.text();
  const svixId = request.headers.get('svix-id');
  const event = await verifyResendSignature({
    id: svixId,
    timestamp: request.headers.get('svix-timestamp'),
    signatureHeader: request.headers.get('svix-signature'),
    secret: env.RESEND_WEBHOOK_SECRET,
    body: payload,
  });
  // Fail closed. This is also the state before the owner provisions RESEND_WEBHOOK_SECRET, so the route is inert
  // until then and safe to ship first.
  if (!event) return json({ error: 'invalid_signature' }, 400);

  if (await isDuplicateEvent({ kv: env.SIGNUP_KV, eventId: svixId })) {
    return json({ ok: true, duplicate: true });
  }

  let summary;
  try {
    summary = await handleResendBounceEvent({ event, kv: env.SIGNUP_KV, secret: env.MAIL_SUPPRESS_KEY });
  } catch (err) {
    console.error('resend webhook handler failed', svixId, err?.message);
    return json({ error: 'handler_failed' }, 500);
  }

  await markEventSeen({ kv: env.SIGNUP_KV, eventId: svixId });
  return json({ ok: true, summary });
}

/**
 * The checkout, referral payout and webhook checks from the router, in the order they stood there. Returns the
 * Response for a path and method this group serves, or null so the router goes on to its next check.
 */
export async function handleBillingRoutes(request, env, ctx, { pathname, method }) {
  if (method === 'POST' && pathname === '/checkout') return await handleCheckout(request, env);
  if (method === 'GET' && pathname === '/checkout/success') return await handleCheckoutSuccess(request, env);

  if (method === 'POST' && pathname === '/referral/connect/start') return await handleConnectOnboard(request, env);
  if (method === 'GET' && pathname === '/referral/connect/refresh') return await handleConnectOnboard(request, env);
  if (method === 'GET' && pathname === '/referral/connect/return') return await handleConnectReturn(request, env);

  if (method === 'POST' && pathname === '/webhook') return await handleWebhook(request, env);
  if (method === 'POST' && pathname === '/resend/webhook') return await handleResendWebhook(request, env); // sow-324: auto-unsubscribe on bounce
  return null;
}
