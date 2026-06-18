// Settings / Billing / Referrals operations (SOW-006). The CMS panes are thin presentation over these.
// Billing and referral payouts are NEVER handled in the client: it deep-links to Stripe's hosted customer
// portal and to the signup Worker's Connect onboarding. Settings persists to the local store and toggles
// the user-level autostart. Reuses the shared OperationError so the API maps codes consistently.

import { install as autostartInstall, remove as autostartRemove, status as autostartStatus } from './autostart.mjs';
import { OperationError } from './operations.mjs';
// SOW-040: getBilling/getReferral + their constants live in the NODE-FREE account-ops.mjs so the extension can
// bundle them without this file's node-only autostart graph; re-export here so the npm host's imports are unchanged.
import { SITE_BASE, SIGNUP_BASE, BILLING_PORTAL, getBilling, getReferral } from './account-ops.mjs';
export { SITE_BASE, SIGNUP_BASE, BILLING_PORTAL, getBilling, getReferral };

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

// getBilling + getReferral are re-exported from account-ops.mjs (see the import above) so they ship in the
// node-free extension bundle without this file's autostart graph.
