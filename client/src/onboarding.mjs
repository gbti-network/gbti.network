// SOW-026: the first-run onboarding readiness model (the pure core). The member must end with a GitHub App
// token scoped to ONLY their fork of the canonical repo, which forces three irreducible, GitHub-hosted manual
// steps we can only deep-link + detect: (1) device-flow sign in, (2) FORK the repo via the web UI (must be
// first so the fork exists to be picked), (3) INSTALL the GBTI App on "Only select repositories" -> their fork.
//
// Readiness is the FIRST-FALSE of three booleans derived from DURABLE GitHub state (never a local "firstRunDone"
// flag), so clearing the local store costs at most a re-login, never a re-fork or re-install loop. This module
// is pure (no IO): the host probes GitHub (github-repo.mjs) and feeds the booleans in here. Copy follows the
// writing conventions (no em/en dashes, no contractions) and avoids GitHub jargon for a non-technical creator.

import { GITHUB_APP_SLUG, UPSTREAM_REPO } from './signup-base.mjs';

export const STEP_ORDER = ['signin', 'fork', 'install'];

/** Resolve the active onboarding step from the durable booleans. First-false wins; all true = ready. */
export function nextStep({ signedIn = false, forkReady = false, installReady = false } = {}) {
  if (!signedIn) return 'signin';
  if (!forkReady) return 'fork';
  if (!installReady) return 'install';
  return 'ready';
}

/** True only when all three durable facts hold. */
export function isReady(state) {
  return nextStep(state) === 'ready';
}

// ---- deep links (GitHub-hosted; we only open them + detect the return) ----
export const deviceVerificationUrl = () => 'https://github.com/login/device';
export const forkUrl = () => `https://github.com/${UPSTREAM_REPO}/fork`;
export const manageInstallsUrl = () => 'https://github.com/settings/installations';
/** The App install/permissions chooser. targetId (the member's numeric account id) preselects their account. */
export function appInstallUrl({ targetId } = {}) {
  const base = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;
  return targetId ? `${base}/permissions?suggested_target_id=${encodeURIComponent(targetId)}` : base;
}

// The expected fork name for a member login (used by the probe + the UI mismatch hint).
export const forkFullName = (login) => `${String(login || '').toLowerCase()}/${UPSTREAM_REPO.split('/')[1]}`;

// ---- step copy (one source for the wizard UI; jargon-free) ----
export const STEPS = {
  signin: {
    id: 'signin',
    title: 'Sign in with GitHub',
    why: 'This connects the extension to your GitHub account so your posts publish under your name. We never see your password.',
    preview: 'After you enter the code, GitHub asks you to authorize GBTI Network to act on your behalf. That is what lets us open pull requests for your drafts. It can only ever touch your own copy of the content.',
    button: 'Sign in with GitHub',
    doneLabel: 'Signed in',
  },
  fork: {
    id: 'fork',
    title: 'Make your copy of the network',
    why: 'You write in your own copy first, then send it to GBTI for review. Nothing is public until it is approved.',
    preview: 'GitHub opens a page with one green Create fork button. Click it and leave every option as-is.',
    button: 'Make my copy on GitHub',
    doneLabel: 'Your copy is ready',
  },
  install: {
    id: 'install',
    title: 'Give access to just your copy',
    why: 'This lets the extension save your drafts into your copy and nothing else. You can remove it anytime in GitHub settings.',
    preview: 'GitHub asks which repositories. Choose Only select repositories, pick gbti.network, then Install. Please do not pick All repositories.',
    button: 'Give access on GitHub',
    doneLabel: 'Access granted to your copy',
  },
};
