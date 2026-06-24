// SOW-040: NODE-FREE account-surface ops — the Stripe customer-portal deep-link (billing) + the referral link.
// Extracted from settings-ops.mjs so the Chrome extension can serve /api/billing + /api/referral WITHOUT pulling
// settings-ops's node-only `autostart` graph (node:fs/path/os/child_process) into the MV3 bundle. settings-ops
// re-exports these so the npm host's existing imports keep working. Env is read via `globalThis.process?.env?.X`
// (the MV3 service worker has no `process`, so the optional chain safely falls to the default — same pattern as
// signup-base.mjs). Billing + referral payouts are NEVER handled in the client: it only deep-links to the
// Stripe-hosted portal + the Worker's Connect onboarding.

import { SIGNUP_BASE } from './signup-base.mjs';

export const SITE_BASE = (globalThis.process?.env?.GBTI_SITE_BASE) || 'https://gbti.network';
export { SIGNUP_BASE };
// Stripe-hosted customer-portal login (email-keyed); the client only deep-links, never handles cards.
export const BILLING_PORTAL = (globalThis.process?.env?.GBTI_BILLING_PORTAL) || 'https://billing.stripe.com/p/login/cN23cvdQF4b0eTC000';

export function getBilling(ctx) {
  return {
    portal: BILLING_PORTAL,
    status: ctx.store?.get('status') ?? null, // cached derived status, when present
    note: 'Manage your membership (update card, cancel, invoices) in the Stripe customer portal.',
  };
}

export function getReferral(ctx) {
  const id = ctx.identity?.();
  const code = id?.githubId ?? null;
  return {
    code,
    link: code ? `${SITE_BASE}/join?ref=${code}` : null,
    connectOnboarding: `${SIGNUP_BASE}/referral/connect/start`,
    terms: `${SITE_BASE}/referral-terms/`,
    note: 'Share your link, or earn from your published work. Earnings appear once Connect payouts are enabled (SOW-007).',
    // SOW-059: contributor + commenter rewards are AUTOMATIC under the touch-based model (a 5% collaboration mix on
    // the first-touch / last-touch items). Owners no longer set a per-content `delegation`, so no caps/hint here.
  };
}
