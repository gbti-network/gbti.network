// SOW-058: the cron drain. Every tick: read the config, list items past the one-hour hold, and post each to every
// READY channel (config-enabled + secrets present), recording per-channel results. Idempotent: a channel already
// "sent" is never re-posted (channelDone), a cron overlap is guarded by a fresh re-read + claim, and a late cancel
// is honored because the item is re-read immediately before posting. A failed channel is retried next tick up to
// MAX_DRAIN_ATTEMPTS, then the item is marked failed. Pure over an injected kv/now/fetch/adapters (unit-tested).

import { markClaimed, markSent, markFailed, recordChannel, channelDone, isDue } from '../../membership/syndication-queue.mjs';
import { resolveAdapterRun } from '../../membership/syndication-adapters.mjs';
import { isSyndicationEnabled, requiresApproval, manualAssistChannels } from '../../membership/syndication-config-core.mjs';
import { renderChannelText } from '../../membership/syndication-render.mjs'; // SOW-121
import { buildSocialTask } from '../../membership/social-queue.mjs'; // SOW-121
import { putTask } from './social-queue-store.mjs'; // SOW-121
import { readSyndicationConfig, readContentChannels, getItem, putItem, listDue, removeFromPending } from './syndication-store.mjs';
import { resolveGuildMention } from './membership-syndicate-now.mjs'; // SOW-088: a real author mention for the auto path

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
  // SOW-058: with require_approval (the default), ONLY superadmin-approved items are due; a pending item never posts.
  const requireApproval = requiresApproval(cfg);
  const due = await listDue(kv, { now, limit: cap, requireApproval });
  // SOW-087: the category -> channel map feeds the discord-category adapter (null = category posts no-op).
  const channelMap = await readContentChannels(kv);
  const { ready, skipped } = resolveAdapterRun({ cfg, env, adapters, fetchImpl, channelMap });
  const manualAssist = manualAssistChannels(cfg); // SOW-121: channels that enqueue a manual task instead of posting

  let sent = 0;
  let failed = 0;
  for (const stale of due) {
    // Fresh read to honor a cancel that landed since the list snapshot, and to claim against a cron overlap.
    // isDue re-checks eligibility on the fresh item (SOW-087: an approved FLAGGED item is due even when
    // require_approval is off, so a plain status compare would wrongly skip it).
    let item = await getItem(kv, stale.id);
    if (!item || !isDue(item, Number(now()), { requireApproval })) continue; // never post an unapproved/cancelled item
    item = markClaimed(item, { now });
    item = { ...item, attempts: (item.attempts || 0) + 1 };
    await putItem(kv, item);

    // Record config-enabled-but-unconfigured channels as skipped (not failed).
    for (const name of skipped) {
      if (!channelDone(item, name)) item = recordChannel(item, name, { status: 'skipped', reason: 'not configured', at: Number(now()) });
    }

    // SOW-121: manual-assist channels (e.g. X after its free API tier was deprecated) are NEVER auto-posted.
    // For each such channel not already tasked, render the SAME text an adapter would post and enqueue a
    // Social Queue task (a superadmin posts it by hand). A 'queued-manual' per-channel marker records it and
    // lets the item terminalize normally, with ZERO paid API calls. Fail-soft: a task write miss retries next tick.
    for (const ch of manualAssist) {
      if (item.perChannel?.[ch]) continue; // already tasked/marked on a prior tick
      try {
        const text = renderChannelText(cfg, item, ch);
        await putTask(kv, buildSocialTask({ item, channel: ch, text, trigger: 'auto', now: Number(now()) }));
        item = recordChannel(item, ch, { status: 'queued-manual', at: Number(now()) });
      } catch { /* leave untasked; retried next tick */ }
    }

    // SOW-088: a REAL author mention for the auto path too. The CI enqueue's DISCORD_MENTION_OVERRIDES map
    // wins when present; otherwise the guild member search resolves it (fail-soft to the text fallback).
    if (!item.mention) {
      const mention = await resolveGuildMention(env, item, { fetchImpl });
      if (mention) item = { ...item, mention };
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
      if (result?.ok && result.skipped) {
        // SOW-087: a clean per-item no-op (e.g. no category channel mapped). Terminal, never retried.
        item = recordChannel(item, adapter.name, { status: 'skipped', reason: result.reason || 'skipped', at: Number(now()) });
      } else if (result?.ok) {
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
