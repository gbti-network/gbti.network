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
  // SOW-059 / SOW-083: the link is the member's INVITE LANE. Sharing it earns a flat 10% LIFETIME commission on
  // anyone who joins through it, paid from the platform's retained share (it never reduces content earnings), with
  // the no-double-dip rule (inviting people to your own content earns the larger content share instead). Content
  // earnings (first-touch 30% / last-touch 10%) + the automatic 5% collaboration pool are SEPARATE and need no link.
  // Owners no longer set a per-content `delegation`. Earnings + payout state appear once the SOW-059 distribution +
  // Connect payouts are enabled (SOW-083 Phase 2 surfaces the breakdown).
  return {
    code,
    link: code ? `${SITE_BASE}/join?ref=${code}` : null,
    invitePct: '10%',
    connectOnboarding: `${SIGNUP_BASE}/referral/connect/start`,
    terms: `${SITE_BASE}/referral-terms/`,
    note: 'Share your invite link to earn a flat 10% lifetime commission on every member who joins through it. You also earn from your published work: 30% when it is the first content that brought a member in, and 10% when it is the last. Earnings and payout status appear here once payouts are enabled.',
  };
}
