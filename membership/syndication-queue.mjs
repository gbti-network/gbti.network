// SOW-058: the PURE syndication queue core. No IO, no Date.now() inside (callers inject `now`), so it is fully
// unit-tested with fakes. The Worker store (workers/signup/syndication-store.mjs) does the KV read-modify-write
// around these transforms, and the drain (workers/signup/syndication-drain.mjs) calls planDrain + the channel
// transitions.
//
// A queue item is a KV-only runtime record (one KV value per item, key `synd:item:<id>`), NEVER committed to git.
// It carries ONLY public-safe metadata about the thing being syndicated: title, url, blurb, image. It carries NO
// body and NO encryptedBody, so a members-only item can never leak its body to a public channel (buildQueueItem
// is structurally incapable of copying a body field; the leak-guard test asserts this).
//
// Shape (synd:item:<id>):
//   { id, source, targetType, targetSlug, author, title, blurb, url, image, visibility, membersOnly, mention,
//     trigger, enqueuedAt, availableAt, status, claimedAt, perChannel, sentAt, failedAt, cancelledAt, cancelledBy }

export const QUEUE_TYPES = new Set(['share', 'post', 'product', 'prompt']);
// SOW-058 (approval model): 'pending' = enqueued, AWAITING superadmin approval (never posts on its own);
// 'approved' = a superadmin approved it, so the drain will post it on the next tick; then 'sent' / 'failed';
// 'cancelled' = rejected (from pending) or cancelled before send (from approved). When require_approval is off
// (legacy auto-hold), the drain posts 'pending' items past the hold instead.
export const QUEUE_STATUS = new Set(['pending', 'approved', 'sent', 'failed', 'cancelled']);
export const DEFAULT_HOLD_MS = 60 * 60_000; // one hour

/** Thrown for caller-input problems; the handler maps it to a 400 (never a 500). */
export class SyndicationError extends Error {}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const trimOrNull = (v) => {
  const s = str(v).trim();
  return s === '' ? null : s;
};

/** The idempotency key for an item: one logical thing being syndicated maps to exactly one key. */
export function dedupeKey({ source, targetSlug } = {}) {
  return `${str(source)}:${str(targetSlug)}`;
}

/**
 * Build a canonical, pending queue item from an enqueue input. PURE. Validates source + targetSlug, derives
 * membersOnly from visibility, and computes availableAt = enqueuedAt + holdMs. Only public-safe metadata is
 * copied: there is deliberately NO body/encryptedBody field, so this function cannot carry a member body.
 */
export function buildQueueItem(input = {}, { now = Date.now, holdMs = DEFAULT_HOLD_MS } = {}) {
  const source = str(input.source);
  if (!QUEUE_TYPES.has(source)) throw new SyndicationError(`invalid syndication source: ${source || '(none)'}`);
  const targetSlug = trimOrNull(input.targetSlug);
  if (!targetSlug) throw new SyndicationError('targetSlug is required');

  const visibility = input.visibility === 'public' ? 'public' : 'members';
  const enqueuedAt = Number(now());
  const hold = Number.isFinite(Number(holdMs)) ? Math.max(0, Math.floor(Number(holdMs))) : DEFAULT_HOLD_MS;

  return {
    id: `${dedupeKey({ source, targetSlug })}#${enqueuedAt}`,
    source,
    targetType: str(input.targetType) || source,
    targetSlug,
    author: trimOrNull(input.author),
    title: trimOrNull(input.title),
    blurb: trimOrNull(input.blurb),
    url: trimOrNull(input.url),
    image: trimOrNull(input.image),
    visibility,
    membersOnly: visibility === 'members',
    mention: trimOrNull(input.mention),
    trigger: trimOrNull(input.trigger) || 'publish',
    enqueuedAt,
    availableAt: enqueuedAt + hold,
    status: 'pending',
    claimedAt: null,
    attempts: 0,
    perChannel: {},
    sentAt: null,
    failedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    approvedAt: null, // SOW-058: stamped when a superadmin approves (pending -> approved)
    approvedBy: null,
  };
}

/** Defensive: coerce a stored value into the canonical shape, or null when it is not a usable item. */
export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = str(raw.source);
  const id = str(raw.id);
  const targetSlug = trimOrNull(raw.targetSlug);
  if (!id || !QUEUE_TYPES.has(source) || !targetSlug) return null;
  const status = QUEUE_STATUS.has(raw.status) ? raw.status : 'pending';
  const perChannel = raw.perChannel && typeof raw.perChannel === 'object' && !Array.isArray(raw.perChannel) ? raw.perChannel : {};
  const num = (v) => {
    if (v == null) return null; // preserve null (Number(null) === 0 would wrongly stamp a timestamp)
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const visibility = raw.visibility === 'public' ? 'public' : 'members';
  return {
    id,
    source,
    targetType: str(raw.targetType) || source,
    targetSlug,
    author: trimOrNull(raw.author),
    title: trimOrNull(raw.title),
    blurb: trimOrNull(raw.blurb),
    url: trimOrNull(raw.url),
    image: trimOrNull(raw.image),
    visibility,
    membersOnly: visibility === 'members',
    mention: trimOrNull(raw.mention),
    trigger: trimOrNull(raw.trigger) || 'publish',
    enqueuedAt: num(raw.enqueuedAt) ?? 0,
    availableAt: num(raw.availableAt) ?? 0,
    status,
    claimedAt: num(raw.claimedAt),
    attempts: num(raw.attempts) ?? 0,
    perChannel,
    sentAt: num(raw.sentAt),
    failedAt: num(raw.failedAt),
    cancelledAt: num(raw.cancelledAt),
    cancelledBy: trimOrNull(raw.cancelledBy),
    approvedAt: num(raw.approvedAt),
    approvedBy: trimOrNull(raw.approvedBy),
  };
}

/**
 * Is this item due to be posted now? With require_approval (the default model), the SUPERADMIN APPROVAL is the gate:
 * only an 'approved' item posts (a 'pending' item NEVER posts, regardless of the clock). With require_approval off
 * (legacy auto-hold), a 'pending' item posts once the one-hour hold has elapsed.
 */
export function isDue(item, now = Date.now(), { requireApproval = false } = {}) {
  if (!item) return false;
  if (requireApproval) return item.status === 'approved';
  return item.status === 'pending' && Number(now) >= Number(item.availableAt);
}

/** Partition the not-terminal items into { due, holding } at time `now`. Terminal items are excluded entirely. */
export function planDrain(items, now = Date.now(), { requireApproval = false } = {}) {
  const due = [];
  const holding = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || (it.status !== 'pending' && it.status !== 'approved')) continue;
    (isDue(it, now, { requireApproval }) ? due : holding).push(it);
  }
  return { due, holding };
}

/** Reject/cancel is meaningful while the item is pending or approved and the drain has not yet claimed it. */
export function canCancel(item) {
  return Boolean(item) && (item.status === 'pending' || item.status === 'approved') && item.claimedAt == null;
}

/** A superadmin may approve only a still-pending, unclaimed item. */
export function canApprove(item) {
  return Boolean(item) && item.status === 'pending' && item.claimedAt == null;
}

/** Transition pending -> approved, stamping the actor. Returns the item unchanged if it cannot be approved. */
export function markApproved(item, { now = Date.now, actor = null } = {}) {
  if (!canApprove(item)) return item;
  return { ...item, status: 'approved', approvedAt: Number(now()), approvedBy: trimOrNull(actor) };
}

/** Mark an item claimed by a drain tick (the compare-and-set guard against a cron overlap / a late cancel). */
export function markClaimed(item, { now = Date.now } = {}) {
  return { ...item, claimedAt: Number(now()) };
}

/** Record a single channel's result on the item. PURE (returns a new item). */
export function recordChannel(item, channel, result) {
  return { ...item, perChannel: { ...item.perChannel, [String(channel)]: result } };
}

/** Has this channel already reached a terminal, non-retryable result (sent or skipped)? */
export function channelDone(item, channel) {
  const r = item?.perChannel?.[channel];
  return Boolean(r) && (r.status === 'sent' || r.status === 'skipped');
}

/** The subset of the candidate channels that still need an attempt (not already sent/skipped). */
export function pendingChannels(item, candidates = []) {
  return (Array.isArray(candidates) ? candidates : []).filter((ch) => !channelDone(item, ch));
}

export function markSent(item, { now = Date.now } = {}) {
  return { ...item, status: 'sent', sentAt: Number(now()) };
}

export function markFailed(item, { now = Date.now } = {}) {
  return { ...item, status: 'failed', failedAt: Number(now()) };
}

/** Transition pending -> cancelled, stamping the actor. Returns the item unchanged if it cannot be cancelled. */
export function markCancelled(item, { now = Date.now, actor = null } = {}) {
  if (!canCancel(item)) return item;
  return { ...item, status: 'cancelled', cancelledAt: Number(now()), cancelledBy: trimOrNull(actor) };
}
