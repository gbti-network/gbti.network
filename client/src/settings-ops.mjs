// Settings / Billing / Referrals operations (SOW-006). The CMS panes are thin presentation over these.
// Billing and referral payouts are NEVER handled in the client: it deep-links to Stripe's hosted customer
// portal and to the signup Worker's Connect onboarding. Settings persists to the local store and toggles
// the user-level autostart. Reuses the shared OperationError so the API maps codes consistently.

import { install as autostartInstall, remove as autostartRemove, status as autostartStatus } from './autostart.mjs';
import { OperationError } from './operations.mjs';
import { SIGNUP_BASE } from './signup-base.mjs';

export const SITE_BASE = process.env.GBTI_SITE_BASE || 'https://gbti.network';
export { SIGNUP_BASE }; // SOW-016: single source of truth is signup-base.mjs (node-free; safe in the extension bundle)
// Stripe-hosted customer portal login (email-keyed); the client only deep-links, never handles cards.
export const BILLING_PORTAL = process.env.GBTI_BILLING_PORTAL || 'https://billing.stripe.com/p/login/cN23cvdQF4b0eTC000';

function safeAutostartStatus() {
  try {
    return autostartStatus();
  } catch {
    return { installed: null, kind: 'unknown' };
  }
}

export function getSettings(ctx) {
  const s = ctx.store;
  return {
    preferredPort: s.get('preferredPort') ?? 4500,
    mcpEnabled: s.get('mcpEnabled') !== false,
    repoPath: s.get('repoPath') ?? null,
    endpointToken: s.get('endpointToken') ?? null, // shown so the user can paste it into an agent config
    authenticated: Boolean(s.get('githubToken')),
    autostart: safeAutostartStatus(),
  };
}

/** Update settings. Recognized keys: mcpEnabled, preferredPort, repoPath, autostart (boolean -> install/remove). */
export function updateSettings(ctx, patch = {}) {
  const s = ctx.store;
  const set = {};
  if (patch.mcpEnabled !== undefined) set.mcpEnabled = Boolean(patch.mcpEnabled);
  if (patch.repoPath !== undefined) set.repoPath = patch.repoPath || null;
  if (patch.preferredPort !== undefined) {
    const p = Number(patch.preferredPort);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) throw new OperationError('bad-request', 'preferredPort must be 1..65535');
    set.preferredPort = p;
  }
  if (Object.keys(set).length) s.set(set);

  if (patch.autostart !== undefined) {
    if (patch.autostart) autostartInstall();
    else autostartRemove();
  }
  return getSettings(ctx);
}

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
    // SOW-008: each piece of content can delegate part of its 30% commission to its contributors (up to 7%)
    // and commenters (up to 3%). Set it per content via the `delegation` field in the Author form; the
    // remainder is always yours. See referral-terms for how the split is computed and paid out.
    delegation: {
      contributionCap: 0.07,
      commentCap: 0.03,
      hint: 'Set `delegation` on a post/product/prompt to share up to 7% with contributors and 3% with commenters. Default: you keep 100%.',
    },
  };
}
