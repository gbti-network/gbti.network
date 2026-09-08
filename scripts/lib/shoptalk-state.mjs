// sow-314: the two pieces of shared state the Shop Talk sweep needs, over the KV REST API.
//
//   shoptalk:placed          one document, { "<address>": "<githubId>" }: what THIS SYSTEM put on the guest
//                            list. It is the entire basis for removal, and the reason the sweep can never
//                            strip a guest the owner added by hand.
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
// So neither is allowed to answer with an empty collection. The caller aborts the sweep instead.

import { listKvByPrefix, readKvValue } from './erase-member.mjs';
import { putKvJson } from './kv-mirror.mjs';

export const PLACED_KEY = 'shoptalk:placed';
export const OPTOUT_PREFIX = 'shoptalk:optout:';

const hasCreds = (env) => !!(env?.CF_ACCOUNT_ID && env?.CF_KV_NAMESPACE_ID && env?.CF_API_TOKEN);
const NO_CREDS = 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN are not set';

/**
 * The placed record.
 * @returns {{ ok: true, placed: Map }} or {{ ok: false, reason: string }}
 */
export async function readPlaced({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!hasCreds(env)) return { ok: false, reason: NO_CREDS };
  const raw = await readKvValue({ key: PLACED_KEY, env, fetchImpl });
  // Genuinely absent is a valid cold start and must not be confused with a failed read, so the credential
  // check above is what separates them. Past that point, null means the key does not exist yet.
  if (raw === null || raw === undefined || raw === '') return { ok: true, placed: new Map() };
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return { ok: false, reason: 'the placed record is not valid JSON; refusing to overwrite it' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, reason: 'the placed record is not an object; refusing to overwrite it' };
  }
  return { ok: true, placed: new Map(Object.entries(obj).map(([a, id]) => [String(a).trim().toLowerCase(), String(id)])) };
}

/** Write the placed record back. Keys sorted, so an unchanged run produces a byte-identical document. */
export async function writePlaced(placed, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const obj = {};
  for (const key of [...placed.keys()].sort()) obj[key] = String(placed.get(key));
  return putKvJson({ label: 'shoptalk placed', body: JSON.stringify(obj), env, fetchImpl, key: PLACED_KEY });
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
