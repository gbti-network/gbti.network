// SOW-058: the KV persistence layer for the syndication queue. Wraps the pure core (membership/syndication-queue.mjs)
// with the read-modify-write against SIGNUP_KV. The queue is KV-only runtime state, NEVER git. Keys (all in
// SIGNUP_KV, prefix-namespaced like activity: / overrides:mirror):
//   synd:item:<id>         one queue item (JSON). A ~30-day TTL is applied once the item goes terminal.
//   synd:pending           { ids: [...] }  a small index of not-yet-terminal item ids, so the drain lists O(1).
//   synd:dedupe:<key>      points a dedupeKey -> the active item id, for idempotent enqueue (no double-post).
//   synd:config            the secret-free config mirror (enabled, hold_minutes, upvote_threshold, channels).
//
// Pure over an injected kv + now, so it is unit-tested with a fake KV (no network, no secrets).

import {
  buildQueueItem, dedupeKey, normalizeItem, isDue,
} from '../../membership/syndication-queue.mjs';
import {
  syndicationConfigFromParsed, isSyndicationEnabled, holdMs, DEFAULT_SYNDICATION_CONFIG,
} from '../../membership/syndication-config-core.mjs';

export const SYND_ITEM_KEY = (id) => `synd:item:${id}`;
export const SYND_PENDING_KEY = 'synd:pending';
export const SYND_DEDUPE_KEY = (key) => `synd:dedupe:${key}`;
export const SYND_CONFIG_KEY = 'synd:config';
export const SYND_CHANNELS_KEY = 'synd:channels'; // SOW-087: the mirrored house/content-channels.yml

const TERMINAL_TTL_SECONDS = 30 * 24 * 60 * 60; // self-prune a sent/cancelled/failed item after ~30 days

/** Read + normalize the config mirror from KV (fail-closed: a missing/unreadable mirror is the safe default). */
export async function readSyndicationConfig(kv) {
  if (!kv) return syndicationConfigFromParsed({});
  let raw = null;
  try { raw = await kv.get(SYND_CONFIG_KEY, 'json'); } catch { raw = null; }
  return syndicationConfigFromParsed(raw ?? DEFAULT_SYNDICATION_CONFIG);
}

/** SOW-087: the category -> Discord-channel map mirror ({ channels: [{ category, channelId }] }). A missing or
 *  unreadable mirror is null: the category post is then a recorded no-op (fail-closed, featured post unaffected). */
export async function readContentChannels(kv) {
  if (!kv) return null;
  try {
    const raw = await kv.get(SYND_CHANNELS_KEY, 'json');
    return raw && typeof raw === 'object' && Array.isArray(raw.channels) ? raw : null;
  } catch {
    return null;
  }
}

export async function getItem(kv, id) {
  if (!kv || !id) return null;
  let raw = null;
  try { raw = await kv.get(SYND_ITEM_KEY(id), 'json'); } catch { raw = null; }
  return normalizeItem(raw);
}

/** Write an item; a TERMINAL item gets a TTL so the store self-prunes. 'pending' and 'approved' are NOT terminal
 *  (an approved item is still awaiting the drain), so they must persist with no TTL or they could expire un-posted. */
export async function putItem(kv, item) {
  const terminal = item.status !== 'pending' && item.status !== 'approved';
  const opts = terminal ? { expirationTtl: TERMINAL_TTL_SECONDS } : undefined;
  await kv.put(SYND_ITEM_KEY(item.id), JSON.stringify(item), opts);
  return item;
}

async function readPendingIndex(kv) {
  let raw = null;
  try { raw = await kv.get(SYND_PENDING_KEY, 'json'); } catch { raw = null; }
  const ids = raw && Array.isArray(raw.ids) ? raw.ids.filter((x) => typeof x === 'string') : [];
  return [...new Set(ids)];
}

export async function addToPending(kv, id) {
  const ids = await readPendingIndex(kv);
  if (!ids.includes(id)) {
    ids.push(id);
    await kv.put(SYND_PENDING_KEY, JSON.stringify({ ids }));
  }
}

export async function removeFromPending(kv, id) {
  const ids = await readPendingIndex(kv);
  const next = ids.filter((x) => x !== id);
  if (next.length !== ids.length) await kv.put(SYND_PENDING_KEY, JSON.stringify({ ids: next }));
}

/**
 * Idempotently enqueue an item. A pending, APPROVED, or sent item with the same dedupeKey is a no-op (republish,
 * double cron, retried Action never double-posts). A previously cancelled/failed dedupeKey may be re-enqueued. The
 * hold window comes from the config mirror (default one hour). Returns { enqueued, id, item, reason }.
 */
export async function enqueue(env, input, { kv = env?.SIGNUP_KV, now = Date.now, cfg = null } = {}) {
  if (!kv) return { enqueued: false, reason: 'the syndication store is not configured' };
  const config = cfg ?? (await readSyndicationConfig(kv));
  const key = dedupeKey({ source: input?.source, targetSlug: input?.targetSlug });

  // Idempotency: a still-active item with this dedupeKey blocks a duplicate. 'approved' counts as active (it is
  // about to post), so a re-enqueue while it is awaiting the drain cannot create a second item that double-posts.
  let pointer = null;
  try { pointer = await kv.get(SYND_DEDUPE_KEY(key), 'text'); } catch { pointer = null; }
  if (pointer) {
    const existing = await getItem(kv, pointer);
    if (existing && (existing.status === 'pending' || existing.status === 'approved' || existing.status === 'sent')) {
      return { enqueued: false, reason: 'duplicate', id: existing.id };
    }
  }

  const item = buildQueueItem(input, { now, holdMs: holdMs(config) });
  await putItem(kv, item);
  await kv.put(SYND_DEDUPE_KEY(key), item.id);
  await addToPending(kv, item.id);
  return { enqueued: true, id: item.id, item };
}

/** All not-yet-terminal items (pending AWAITING approval + approved-not-yet-sent) from the pending index. */
export async function listPending(kv) {
  const ids = await readPendingIndex(kv);
  const out = [];
  for (const id of ids) {
    const item = await getItem(kv, id);
    if (item && (item.status === 'pending' || item.status === 'approved')) out.push(item);
  }
  return out;
}

/** Items due to post now, capped to `limit` oldest-first. With requireApproval, "due" = approved (SOW-058). */
export async function listDue(kv, { now = Date.now, limit = 10, requireApproval = false } = {}) {
  const t = now();
  const due = (await listPending(kv)).filter((it) => isDue(it, t, { requireApproval }));
  due.sort((a, b) => a.availableAt - b.availableAt);
  return due.slice(0, Math.max(0, limit));
}

/** All items (any status) for the superadmin tracker, via a KV prefix list. Capped. */
export async function listAll(kv, { limit = 500 } = {}) {
  if (!kv?.list) return [];
  const out = [];
  let cursor;
  for (let page = 0; page < 1000 && out.length < limit; page++) {
    const res = await kv.list({ prefix: 'synd:item:', cursor });
    for (const k of res?.keys ?? []) {
      const item = await getItem(kv, k.name.slice('synd:item:'.length));
      if (item) out.push(item);
      if (out.length >= limit) break;
    }
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

export { isSyndicationEnabled };
