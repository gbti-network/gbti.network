#!/usr/bin/env node
// sow-481: the ONE-TIME LAUNCH STAMP for the Invitations tab's sent state.
//
//   node --env-file-if-exists=.env scripts/stamp-invitations-sent.mjs                # dry run: what it would stamp
//   node --env-file-if-exists=.env scripts/stamp-invitations-sent.mjs --apply        # write it
//   ... --before 2026-10-27T00:00:00Z                                               # a cutoff other than now
//
// WHY. Before sow-481 nothing recorded that an invitation had been sent, so every prepared listing would open the
// new tab in Ready to send, including the ones already sent weeks ago. The owner ruled on 2026-10-26: everything
// prepared before the cutoff counts as sent. This sets `sentAtLaunch: true` on each such record and nothing else.
// It does NOT invent a send date (`sentAt` stays null), so the card says "Counted as sent at launch" and counts its
// age from when it was prepared rather than presenting the launch day as the day it went out.
//
// The two that were genuinely never sent are then moved back with the tab's own "Not sent yet" button.
//
// WHAT IT TOUCHES. Only `invite-listing:<ID>` records that are `prepared` (not revoked, publishing or claimed), have
// no sent fields yet, and were created before the cutoff. A second run stamps nothing, because the first one's
// records are already marked. Each record is read again immediately before its write and the decision is made
// again on that copy, so a claim that took its lock in between is not overwritten (the same re-read the Worker's
// ops use; KV has no compare-and-set, so the residual window is that single round trip). `updatedAt` is left alone,
// for the reason listingMarkSent gives.
//
// It prints listing ids and counts only: never a name, a message or a code (the code is a bearer secret).
// Needs CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID and CF_API_TOKEN; without them it refuses rather than reporting zero.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { kvRestShim } from './lib/kv-rest.mjs';
import { LISTING_KEY_PREFIX, isListingId, listingState, LISTING_STATE } from '../membership/prepared-listings.mjs';

/** Why a record is or is not stamped. `stamp` is the only outcome that writes. */
export const STAMP = Object.freeze({
  stamp: 'stamp', notPrepared: 'not_prepared', alreadySent: 'already_sent', afterCutoff: 'after_cutoff', noDate: 'no_date',
});

/** The decision for one record against the cutoff (a Date). Pure. */
export function launchStampFor(rec, cutoff) {
  if (!rec || typeof rec !== 'object' || listingState(rec) !== LISTING_STATE.prepared) return STAMP.notPrepared;
  if (rec.sentAt || rec.sentAtLaunch === true) return STAMP.alreadySent;
  const created = Date.parse(String(rec.createdAt ?? ''));
  if (!Number.isFinite(created)) return STAMP.noDate;
  return created < cutoff.getTime() ? STAMP.stamp : STAMP.afterCutoff;
}

/** The stamped record: the launch flag, and no invented who or when. */
export function launchStamped(rec) {
  return { ...rec, sentAt: null, sentBy: null, sentByLogin: null, sentAtLaunch: true };
}

async function listAllKeys(kv, prefix) {
  const names = [];
  let cursor;
  for (let page = 0; page < 10000; page += 1) {
    const r = await kv.list({ prefix, cursor });
    for (const k of r?.keys ?? []) if (k?.name) names.push(k.name);
    if (r?.list_complete !== false || !r?.cursor) break;
    cursor = r.cursor;
  }
  return names;
}

/**
 * Walk every listing and stamp the ones that qualify. `kv` is Workers-KV shaped (get/put/list), so the same code
 * runs against the REST shim here and a fake in the tests. Returns a report of ids and counts.
 */
export async function stampLaunchSent({ kv, cutoff, apply = false }) {
  if (!(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime())) throw new Error('a valid cutoff date is required');
  const report = { listed: 0, stamped: [], counts: {}, unreadable: [], raced: [] };
  const bump = (k) => { report.counts[k] = (report.counts[k] || 0) + 1; };
  for (const key of await listAllKeys(kv, LISTING_KEY_PREFIX)) {
    const id = key.slice(LISTING_KEY_PREFIX.length);
    if (!isListingId(id)) continue; // not a listing record (the prefix is literal, so images never reach here)
    report.listed += 1;
    let rec;
    try { rec = await kv.get(key, 'json'); } catch { report.unreadable.push(id); continue; }
    const decision = launchStampFor(rec, cutoff);
    bump(decision);
    if (decision !== STAMP.stamp) continue;
    if (!apply) { report.stamped.push(id); continue; }
    let fresh;
    try { fresh = await kv.get(key, 'json'); } catch { report.unreadable.push(id); continue; }
    if (launchStampFor(fresh, cutoff) !== STAMP.stamp) { report.raced.push(id); continue; }
    await kv.put(key, JSON.stringify(launchStamped(fresh)));
    report.stamped.push(id);
  }
  return report;
}

export function parseArgs(argv) {
  const i = argv.indexOf('--before');
  const before = i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  return { apply: argv.includes('--apply') && !argv.includes('--dry-run'), before };
}

async function main() {
  const { apply, before } = parseArgs(process.argv.slice(2));
  const cutoff = before ? new Date(before) : new Date();
  if (!Number.isFinite(cutoff.getTime())) { console.error(`error: --before ${before} is not a date`); process.exitCode = 1; return; }
  const kv = kvRestShim({ env: process.env });
  if (!kv) {
    console.error('REFUSED: CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID and CF_API_TOKEN are needed to read the listings. Nothing was read or written.');
    process.exitCode = 1;
    return;
  }
  console.log(`\nLaunch stamp for prepared invitations created before ${cutoff.toISOString()}  [${apply ? 'APPLY' : 'DRY-RUN'}]\n`);
  const r = await stampLaunchSent({ kv, cutoff, apply });
  console.log(`  listings read      ${r.listed}`);
  for (const [k, n] of Object.entries(r.counts).sort()) console.log(`  ${k.padEnd(18)} ${n}`);
  console.log(`  ${(apply ? 'stamped' : 'would stamp').padEnd(18)} ${r.stamped.length}${r.stamped.length ? `: ${r.stamped.join(' ')}` : ''}`);
  if (r.raced.length) console.log(`  changed meanwhile  ${r.raced.length}: ${r.raced.join(' ')} (left alone)`);
  if (r.unreadable.length) {
    console.log(`  UNREADABLE         ${r.unreadable.length}: ${r.unreadable.join(' ')} (left alone; run again)`);
    process.exitCode = 1;
  }
  console.log(apply ? '\nDone.\n' : '\nDry run: nothing was written. Re-run with --apply to stamp.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`error: ${String(e?.message || e).split('\n')[0]}`); process.exitCode = 1; });
}
