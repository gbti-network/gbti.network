// SOW-058: the cron drain. Every tick: read the config, list items past the one-hour hold, and post each to every
// READY channel (config-enabled + secrets present), recording per-channel results. Idempotent: a channel already
// "sent" is never re-posted (channelDone), a cron overlap is guarded by a fresh re-read + claim, and a late cancel
// is honored because the item is re-read immediately before posting. A failed channel is retried next tick up to
// MAX_DRAIN_ATTEMPTS, then the item is marked failed. Pure over an injected kv/now/fetch/adapters (unit-tested).

import { markClaimed, markSent, markFailed, recordChannel, channelDone } from '../../membership/syndication-queue.mjs';
import { resolveAdapterRun } from '../../membership/syndication-adapters.mjs';
import { isSyndicationEnabled } from '../../membership/syndication-config.mjs';
import { readSyndicationConfig, getItem, putItem, listDue, removeFromPending } from './syndication-store.mjs';

export async function drainSyndication(env, {
  kv = env?.SIGNUP_KV,
  now = Date.now,
  fetchImpl = globalThis.fetch,
  limit = null,
  adapters = null,
  maxAttempts = 5,
} = {}) {
  if (!kv) return { drained: 0, reason: 'no kv' };
  const cfg = await readSyndicationConfig(kv);
  if (!isSyndicationEnabled(cfg)) return { drained: 0, reason: 'disabled' };

  const cap = Number(limit ?? env?.MAX_DRAIN_PER_TICK ?? 10);
  const due = await listDue(kv, { now, limit: cap });
  const { ready, skipped } = resolveAdapterRun({ cfg, env, adapters, fetchImpl });

  let sent = 0;
  let failed = 0;
  for (const stale of due) {
    // Fresh read to honor a cancel that landed since the list snapshot, and to claim against a cron overlap.
    let item = await getItem(kv, stale.id);
    if (!item || item.status !== 'pending') continue;
    item = markClaimed(item, { now });
    item = { ...item, attempts: (item.attempts || 0) + 1 };
    await putItem(kv, item);

    // Record config-enabled-but-unconfigured channels as skipped (not failed).
    for (const name of skipped) {
      if (!channelDone(item, name)) item = recordChannel(item, name, { status: 'skipped', reason: 'not configured', at: Number(now()) });
    }

    let anyFail = false;
    for (const adapter of ready) {
      if (channelDone(item, adapter.name)) continue; // already sent on a prior tick; never re-post
      let result;
      try {
        result = await adapter.post(item);
      } catch (e) {
        result = { ok: false, error: String(e?.message || e) };
      }
      if (result?.ok) {
        item = recordChannel(item, adapter.name, { status: 'sent', id: result.id || null, url: result.url || null, at: Number(now()) });
      } else {
        anyFail = true;
        item = recordChannel(item, adapter.name, { status: 'failed', error: result?.error || 'post failed', at: Number(now()) });
      }
    }

    if (!anyFail) {
      item = markSent(item, { now });
      await putItem(kv, item);
      await removeFromPending(kv, item.id);
      sent++;
    } else if ((item.attempts || 0) >= maxAttempts) {
      item = markFailed(item, { now });
      await putItem(kv, item);
      await removeFromPending(kv, item.id);
      failed++;
    } else {
      // Leave pending for a retry next tick; clear the claim so it can be re-claimed (and re-cancelled).
      item = { ...item, claimedAt: null };
      await putItem(kv, item);
    }
  }

  return { drained: sent, failed, due: due.length, ready: ready.map((a) => a.name), skipped };
}
