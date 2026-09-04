// sow-313: PURGE the KV left behind by upvoting and the SOW-126 popular promoter.
//
// Both features are gone from every surface, but the person-keyed records they wrote are still in KV:
//
//   upvotes:share:*        per-target voter sets, each holding member github_ids
//   content-opens:*        per-item distinct-opener sets, same
//   activity:<github_id>   an `upvotes` array inside each member's record
//
// THE ORDER MATTERS AND IT IS NOT NEGOTIABLE. `eraseShareVotes` and `eraseContentOpens` in
// scripts/lib/erase-member.mjs deliberately OUTLIVE the features, so a right-to-erasure request can still
// reach this data. They come out only AFTER this purge is confirmed. Removing them first would strand
// person-keyed records that nothing could then delete, which is the sow-213 failure this project has already
// paid for once.
//
// DRY RUN BY DEFAULT, like reconcile. It counts what it would delete and prints a per-prefix baseline; pass
// --apply to enact. The exit baseline is DERIVED from the same listing rather than a number typed in here, so
// it cannot silently disagree with what the store actually holds.
//
// Requires CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN. Without them it is a reported no-op, never a
// throw, so a local run is harmless.
//
// Usage:
//   node scripts/purge-retired-engagement.mjs              # dry run: count and report
//   node scripts/purge-retired-engagement.mjs --apply      # delete
//
// Related: sow-313 (this), SOW-057 (upvoting), SOW-126 (the popular promoter), sow-213 (why the order).

import { listKvByPrefix, deleteKvKey } from './lib/erase-member.mjs';

const PREFIXES = ['upvotes:share:', 'content-opens:'];
const ACTIVITY_PREFIX = 'activity:';

/**
 * Strip the retired `upvotes` array from one activity record. PURE, and it returns `changed:false` when the
 * key is absent, so a re-run after a successful purge writes nothing at all.
 */
export function stripUpvotes(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { record, changed: false };
  if (!('upvotes' in record)) return { record, changed: false };
  const { upvotes, ...rest } = record;
  return { record: rest, changed: true };
}

async function putValue({ key, value, env, fetchImpl }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/storage/kv/namespaces/${env.CF_KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { method: 'PUT', headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` }, body: JSON.stringify(value) });
  if (!res || !res.ok) throw new Error(`KV put failed for ${key}: ${res ? res.status : 'no response'}`);
}

export async function main({ argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const apply = argv.includes('--apply');
  log(apply ? 'purge-retired-engagement: APPLY (this deletes data)' : 'purge-retired-engagement: DRY RUN (pass --apply to enact)');

  const report = { deleted: 0, stripped: 0, prefixes: {}, activity: { scanned: 0, carrying: 0 } };

  // 1) The two whole-key prefixes. keysOnly: the values are being deleted, so fetching them would move data
  //    for nothing.
  for (const prefix of PREFIXES) {
    const listed = await listKvByPrefix({ prefix, env, fetchImpl, keysOnly: true });
    if (!listed.available) { log(`  ${prefix} SKIPPED (${listed.reason})`); report.prefixes[prefix] = null; continue; }
    report.prefixes[prefix] = listed.keys.length;
    log(`  ${prefix} ${listed.keys.length} key(s)${apply ? '' : ' would be deleted'}`);
    if (!apply) continue;
    for (const key of listed.keys) {
      const r = await deleteKvKey({ key, env, fetchImpl });
      if (r.deleted) report.deleted++;
    }
  }

  // 2) The `upvotes` array inside each member's activity record. This one needs the VALUES, because it is a
  //    partial rewrite rather than a delete: favorites and collections in the same record are kept.
  const acts = await listKvByPrefix({ prefix: ACTIVITY_PREFIX, env, fetchImpl });
  if (!acts.available) {
    log(`  ${ACTIVITY_PREFIX} SKIPPED (${acts.reason})`);
  } else {
    report.activity.scanned = acts.keys.length;
    for (const { key, value } of acts.entries) {
      const { record, changed } = stripUpvotes(value);
      if (!changed) continue;
      report.activity.carrying++;
      if (!apply) continue;
      await putValue({ key, value: record, env, fetchImpl });
      report.stripped++;
    }
    log(`  ${ACTIVITY_PREFIX} ${acts.keys.length} record(s) scanned, ${report.activity.carrying} still carrying an upvotes array${apply ? ` (${report.stripped} rewritten)` : ' would be rewritten'}`);
    // An unreadable key is a record that MAY still carry the array and was NOT rewritten. Saying so is the
    // difference between "there was nothing left" and "we could not look", which is the whole point of the
    // incompleteScan discipline the erasure steps use.
    if (acts.unreadable) log(`  WARNING: ${acts.unreadable} activity key(s) could not be READ, so this run cannot claim they are clean.`);
  }

  if (apply) {
    log(`purge-retired-engagement: deleted ${report.deleted} key(s), rewrote ${report.stripped} activity record(s).`);
    log('Now RE-RUN WITHOUT --apply. Every count must read 0. Only then remove eraseShareVotes and');
    log('eraseContentOpens from scripts/lib/erase-member.mjs (sow-313 phase 4 step 3).');
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('purge-retired-engagement FAILED:', e?.message ?? e); process.exit(1); });
}
