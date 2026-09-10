// sow-314: the three pieces of shared state the Shop Talk sweep needs, over the KV REST API.
//
//   shoptalk:placed          one document, { "<address>": "<githubId>" }: what THIS SYSTEM put on the guest
//                            list. It is the entire basis for removal, and the reason the sweep can never
//                            strip a guest the owner added by hand.
//   shoptalk:seen            one document, same shape: every member address the sweep has ever seen on the
//                            event or placed there. Rule 5 (2026-09-10): an address in here is never added by
//                            the sweep again, whoever removed it. Read by the Worker too, so the account
//                            page can tell a member their seat was removed and offer Rejoin.
//   shoptalk:optout:<id>     one marker per member who asked to come off. Written by the Worker route,
//                            read here. Per-member rather than one document so it is erasable on its own and
//                            so two members opting out at once cannot clobber each other.
//
// EVERY READER RETURNS AN EXPLICIT ok FLAG, AND THAT IS THE WHOLE DESIGN OF THIS FILE.
//
// The underlying helpers do not distinguish "I could not look" from "there is nothing there". `readKvValue`
// returns null for a missing credential, a missing key AND a failed read alike; `listKvByPrefix` returns
// `{ available: false, keys: [] }` when the credentials are unset rather than throwing. Both collapse into an
// empty answer, and an empty answer here is not harmless:
//
//   an unreadable OPT-OUT list looks like nobody opted out, so the sweep puts them back on the guest list and
//   Google mails them an invitation they explicitly declined. Worse than doing nothing.
//
//   an unreadable PLACED document looks like we own no addresses. Removal then does nothing, which is merely
//   annoying, but WRITING BACK afterwards would replace the real record with only this run's additions and
//   permanently forget every address we already owned. That is data loss, not a hiccup.
//
//   an unreadable SEEN document looks like nobody was ever invited, so every member who has left the event
//   would be re-invited. That is the exact mail the owner ruled out.
//
// So none of them is allowed to answer with an empty collection. The caller aborts the sweep instead.

import { listKvByPrefix, readKvValue } from './erase-member.mjs';
import { putKvJson } from './kv-mirror.mjs';

export const PLACED_KEY = 'shoptalk:placed';
export const SEEN_KEY = 'shoptalk:seen';
export const OPTOUT_PREFIX = 'shoptalk:optout:';

const hasCreds = (env) => !!(env?.CF_ACCOUNT_ID && env?.CF_KV_NAMESPACE_ID && env?.CF_API_TOKEN);
const NO_CREDS = 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN are not set';

/** One address -> githubId document, read fail-closed. Genuinely absent is a valid cold start. */
async function readAddressMap({ key, label, env, fetchImpl }) {
  if (!hasCreds(env)) return { ok: false, reason: NO_CREDS };
  const raw = await readKvValue({ key, env, fetchImpl });
  // Genuinely absent is a valid cold start and must not be confused with a failed read, so the credential
  // check above is what separates them. Past that point, null means the key does not exist yet.
  if (raw === null || raw === undefined || raw === '') return { ok: true, map: new Map() };
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return { ok: false, reason: `the ${label} record is not valid JSON; refusing to overwrite it` }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, reason: `the ${label} record is not an object; refusing to overwrite it` };
  }
  return { ok: true, map: new Map(Object.entries(obj).map(([a, id]) => [String(a).trim().toLowerCase(), String(id)])) };
}

/** Write one address -> githubId document. Keys sorted, so an unchanged run produces a byte-identical document. */
function writeAddressMap(map, { key, label, env, fetchImpl }) {
  const obj = {};
  for (const k of [...map.keys()].sort()) obj[k] = String(map.get(k));
  return putKvJson({ label, body: JSON.stringify(obj), env, fetchImpl, key });
}

/**
 * The placed record.
 * @returns {{ ok: true, placed: Map }} or {{ ok: false, reason: string }}
 */
export async function readPlaced({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const r = await readAddressMap({ key: PLACED_KEY, label: 'placed', env, fetchImpl });
  return r.ok ? { ok: true, placed: r.map } : r;
}

/** Write the placed record back. */
export function writePlaced(placed, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return writeAddressMap(placed, { key: PLACED_KEY, label: 'shoptalk placed', env, fetchImpl });
}

/**
 * The seen record (rule 5).
 * @returns {{ ok: true, seen: Map }} or {{ ok: false, reason: string }}
 */
export async function readSeen({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const r = await readAddressMap({ key: SEEN_KEY, label: 'seen', env, fetchImpl });
  return r.ok ? { ok: true, seen: r.map } : r;
}

/** Write the seen record back. */
export function writeSeen(seen, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return writeAddressMap(seen, { key: SEEN_KEY, label: 'shoptalk seen', env, fetchImpl });
}

/**
 * Every member who has opted out.
 * @returns {{ ok: true, optedOut: Set }} or {{ ok: false, reason: string }}
 */
export async function readOptedOut({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!hasCreds(env)) return { ok: false, reason: NO_CREDS };
  // listKvByPrefix THROWS on a failed listing page, which is what we want: a short list must never read as a
  // short keyspace. It is deliberately not caught here.
  const listed = await listKvByPrefix({ prefix: OPTOUT_PREFIX, env, fetchImpl, keysOnly: true });
  if (!listed || listed.available === false) return { ok: false, reason: listed?.reason || 'the opt-out list could not be read' };
  const out = new Set();
  for (const name of listed.keys ?? []) {
    if (typeof name !== 'string' || !name.startsWith(OPTOUT_PREFIX)) continue;
    const id = name.slice(OPTOUT_PREFIX.length).trim();
    if (id) out.add(id);
  }
  return { ok: true, optedOut: out };
}
