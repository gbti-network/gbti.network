// Owner, 2026-09-29: the browser side of the bells' read state (membership/bell-seen.mjs). Both bells use it.
//
// The account record is the truth; this browser keeps a copy so a badge can clear the instant a member marks read,
// and so every open tab of one surface agrees. Before this, each tab loaded a "last read" time once, when it
// opened, and never looked again: marking read in one tab left every other open tab showing the old count, and the
// extension's two-minute refresh brought it back ("it keeps popping up"). Now a bell re-reads this copy on every
// load, hears the browser's `storage` event when another tab writes it, and merges the account's record in.
//
// The copy is keyed by account, so two accounts in one browser never share one read state.
import { normalizeSeen, mergeSeen } from '../../membership/bell-seen.mjs';

export const seenKey = (login) => `gbti-bell-seen:${String(login || '').toLowerCase()}`;

/** This browser's copy for one account, or null when there is none (or storage is unavailable). */
export function readLocalSeen(login) {
  if (!login) return null;
  try {
    const raw = localStorage.getItem(seenKey(login));
    return raw ? normalizeSeen(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function writeLocalSeen(login, seen) {
  if (!login) return;
  try { localStorage.setItem(seenKey(login), JSON.stringify(normalizeSeen(seen))); } catch { /* private mode */ }
}

/** A value the bells kept before the read state moved to the account (a "last read" time), read once to seed it. */
export function readLegacy(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** The account's record, or null when it cannot be read (the bell then works from this browser's copy alone). */
export async function fetchAccountSeen(client) {
  try {
    const r = await client?.getBellSeen?.();
    return r && r.bellSeen ? normalizeSeen(r.bellSeen) : null;
  } catch { return null; }
}

/** Send a record to the account in the background; resolves the merged record the Worker answers, or null. */
export async function pushAccountSeen(client, seen) {
  try {
    const r = await client?.markBellSeen?.(normalizeSeen(seen));
    return r && r.bellSeen ? normalizeSeen(r.bellSeen) : null;
  } catch { return null; }
}

/** Call `cb(merged)` when another tab of this surface changes the account's copy. Returns an unsubscribe. */
export function onLocalSeenChange(login, cb) {
  if (typeof window === 'undefined' || !login) return () => {};
  const handler = (e) => {
    if (e.key !== seenKey(login)) return;
    let next = null;
    try { next = e.newValue ? normalizeSeen(JSON.parse(e.newValue)) : null; } catch { next = null; }
    if (next) cb(next);
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export { mergeSeen };
