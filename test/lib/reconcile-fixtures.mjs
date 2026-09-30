// Shared fixtures for the SOW-005 reconcile suites. They were declared inside test/reconcile.test.mjs until it
// passed the 900-line limit (owner, 2026-09-30) and was split into the planner suite that kept the old name,
// reconcile-cli, reconcile-enact and reconcile-coupon-grants.
//
// Not a test file (no .test. in the name), so the test runner never runs it on its own.

import { effectiveStatus } from '../../membership/overrides.mjs';

export const NOW = new Date('2026-06-02T00:00:00Z');
export const DAY = 24 * 60 * 60 * 1000;

/** Build an effective-status object the way the CLI does, so the test mirrors production wiring. */
export function effective(githubId, derived, { bans = new Map(), grandfathers = new Map() } = {}) {
  return effectiveStatus(githubId, derived, { bans, grandfathers }, NOW);
}

/** Repo entry helper: files with their current status. */
export const file = (p, status, visibility = 'public') => ({ path: p, status, visibility });

// helper to find actions by kind/type
export const ofKind = (actions, kind) => actions.filter((a) => a.kind === kind);

// An empty overrides set (no roles, bans, grandfathers or members-index entries), for the folder resolution tests.
export const noOverrides = () => ({ roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map() });
