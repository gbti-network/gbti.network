// sow-387: the extension hands setup to the website. The owner ruled (2026-09-22) that the welcome belongs to the
// website, and (2026-09-23) that it opens right after a member's FIRST extension sign-in, already signed in there,
// and not for anyone whose setup is handled. Nothing opens at install: at install the member is signed in nowhere,
// so the page would ask for a website sign-in and the extension would then ask again on a different GitHub screen.
//
// This module holds the parts of that handoff the background worker can hand to node tests: the per-account record
// key, the decision, and the client the progress read runs through. It touches no `chrome` and no network itself;
// the worker passes in storage and its own dispatcher.

import { createHttpClient } from '../../client-ui/src/client.mjs';

/**
 * The record that says this account has already been handed to the website welcome on this browser. It lives
 * outside the `gbti:wb:` prefix that sign-out clears, so a sign-out and a later sign-in is NOT a first sign-in.
 */
export const HANDOFF_PREFIX = 'gbti:welcome-handoff:';
export function handoffKey(githubId) {
  const id = String(githubId ?? '').trim();
  return id ? `${HANDOFF_PREFIX}${id}` : null;
}

/**
 * Claim the record for this account, BEFORE anything is read, so two sign-ins cannot both open a tab. Returns true
 * only for the call that wrote it. `storage` is chrome.storage.local (or a test double with the same get/set).
 * A storage failure claims nothing: a welcome that opens on every sign-in is worse than one that never opens here,
 * because the WorkBench card still links to it.
 */
export async function claimHandoff(storage, githubId, now = Date.now()) {
  const key = handoffKey(githubId);
  if (!key || !storage) return false;
  try {
    const got = await storage.get(key);
    if (got && got[key]) return false;
    await storage.set({ [key]: { at: now } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the website welcome only when this call claimed the record AND the member has a step still to do. A skipped
 * step counts as handled, because skipping is the member's own choice (membership/onboarding.mjs). Progress that
 * could not be read (null, or `known: false`) still opens it: a new member left without the welcome is worse than
 * one who is shown steps they have finished.
 */
export function shouldOpenWelcome({ claimed, progress } = {}) {
  if (!claimed) return false;
  if (!progress || !progress.known || !Array.isArray(progress.steps)) return true;
  return progress.steps.some((s) => s?.state === 'todo');
}

/**
 * A client-ui client whose requests run in-process through the background's own dispatcher, the same shape the
 * extension pages get from messagingFetch (extension/src/page-client.mjs), minus the message hop. `dispatch` is
 * `(req) => Promise<{ status, json }>`, built by the caller after the fresh token is stored.
 */
export function createDispatchClient(dispatch) {
  const fetch = async (url, init = {}) => {
    const u = new URL(url, 'https://gbti.network');
    const r = (await dispatch({
      method: init.method || 'GET',
      pathname: u.pathname,
      query: Object.fromEntries(u.searchParams.entries()),
      body: init.body ? JSON.parse(init.body) : undefined,
    })) || { status: 500, json: { error: 'no_response' } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  };
  return createHttpClient({ baseUrl: '', token: 'extension', fetch });
}

/** Resolve with `promise`'s value, or with `fallback` once `ms` passes. Never rejects. */
export function withTimeout(promise, ms, fallback = null) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

/**
 * Existing members are seeded when the extension updates, so the release that adds the handoff never counts their
 * next re-sign-in (an expired session, a sign-out) as a first one. Only `update` seeds; nothing here opens a tab.
 * Returns true when a record was written.
 */
export async function seedOnUpdate(storage, { reason, githubId } = {}, now = Date.now()) {
  if (reason !== 'update') return false;
  return claimHandoff(storage, githubId, now);
}
