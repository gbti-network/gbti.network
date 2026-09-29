// What a member has already read in the notification bells, kept on their account so a read on the website clears
// the extension and the reverse, on every browser and device (owner, 2026-09-29: "I am always marking our
// Notifications content as read and it keeps popping up").
//
// WHY NOT A "LAST READ" TIME. Both bells used to call an item unread when its publish time was later than a time
// stored in the browser. That has two failures besides living in one browser:
//   - anything dated ahead of the reader's clock can never be cleared until that time passes;
//   - anything that arrives LATE is silently read: an approval that turns "needs approval" half an hour after it
//     was queued, a news story picked up an hour after it ran, an article in the minutes before the deploy lands.
// So a read is recorded as WHICH items were shown when the member marked them read, plus when that was. An item is
// unread when it is recent (within LATE_WINDOW_MS of the last read) and was not among the ones marked. Older than
// the window counts as read, which is also what keeps a newly followed member's back catalogue from flooding the
// bell.
//
// Shape: { groups: { following?: { at, ids }, replies?: { at, ids }, approvals?: { at, ids } } }. The website bell
// shows only `following`; the extension shows all three. Pure and node-free: the Worker stores it
// (workers/signup/membership-notifications.mjs, on the member's own notifications:<github_id> record, which the
// erasure runbook already deletes) and both bells read it.

export const BELL_SEEN_GROUPS = Object.freeze(['following', 'replies', 'approvals']);
export const LATE_WINDOW_MS = 48 * 60 * 60 * 1000;
export const MAX_IDS_PER_GROUP = 400;
export const MAX_ID_LENGTH = 300;
// How far ahead of the server's clock a stored read time may sit. A device whose clock runs fast must not be able
// to push the window forward by days.
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

function normGroup(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const at = Number(raw.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const ids = [];
  const have = new Set();
  for (const id of Array.isArray(raw.ids) ? raw.ids : []) {
    if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH || have.has(id)) continue;
    have.add(id);
    ids.push(id);
    if (ids.length >= MAX_IDS_PER_GROUP) break;
  }
  return { at, ids };
}

/** A read record from storage or a request body, cleaned: only known groups, finite times, bounded string ids. */
export function normalizeSeen(raw) {
  const out = { groups: {} };
  const groups = raw && typeof raw === 'object' ? raw.groups : null;
  if (!groups || typeof groups !== 'object') return out;
  for (const key of BELL_SEEN_GROUPS) {
    const g = normGroup(groups[key]);
    if (g) out.groups[key] = g;
  }
  return out;
}

function mergeGroup(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const [newer, older] = a.at >= b.at ? [a, b] : [b, a];
  // The newer read's ids first, so the cap drops the stalest ones.
  return normGroup({ at: newer.at, ids: [...newer.ids, ...older.ids] });
}

/**
 * Two read records as one: per group, the later read time and every id either marked. Monotonic, so a stale tab or
 * device posting an older record can never bring back what a newer read cleared. `now` (the server's clock) caps a
 * read time that sits implausibly far in the future.
 */
export function mergeSeen(a, b, { now = null } = {}) {
  const x = normalizeSeen(a);
  const y = normalizeSeen(b);
  const out = { groups: {} };
  for (const key of BELL_SEEN_GROUPS) {
    const g = mergeGroup(x.groups[key] || null, y.groups[key] || null);
    if (!g) continue;
    if (Number.isFinite(now) && g.at > now + MAX_FUTURE_MS) g.at = now + MAX_FUTURE_MS;
    out.groups[key] = g;
  }
  return out;
}

/**
 * Mark everything a bell is showing in one group as read. `items` are the group's rows ({ id, ts }); every one that
 * could still count as unread (recent, or dated ahead of this clock) is recorded by id, so a later arrival with an
 * earlier date is still new.
 */
export function markGroup(seen, group, items, now = Date.now()) {
  const s = normalizeSeen(seen);
  if (!BELL_SEEN_GROUPS.includes(group)) return s;
  const floor = now - LATE_WINDOW_MS;
  const ids = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it.id === 'string' && it.id && (Number(it.ts) || 0) > floor)
    .map((it) => it.id);
  const g = mergeGroup({ at: now, ids }, s.groups[group] || null);
  if (g) s.groups[group] = g;
  return s;
}

/**
 * A predicate for one group: is this row unread? With no read on record every row is new (a first visit), which is
 * what the bells did before a read existed.
 */
export function unreadPredicate(groupSeen) {
  const g = normGroup(groupSeen);
  if (!g) return () => true;
  const floor = g.at - LATE_WINDOW_MS;
  const ids = new Set(g.ids);
  return (item) => (Number(item?.ts) || 0) > floor && !ids.has(String(item?.id ?? ''));
}

/**
 * A browser's old "last read" time, turned into a record for one group the first time the account-wide record has
 * nothing for it. Every row the bell shows that the old time already counted as read is recorded as read, so the
 * change of model does not bring back what the member cleared before it.
 */
export function seedFromWatermark(seen, group, items, watermark) {
  const s = normalizeSeen(seen);
  const mark = Number(watermark) || 0;
  if (!BELL_SEEN_GROUPS.includes(group) || s.groups[group] || mark <= 0) return s;
  const ids = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it.id === 'string' && it.id && (Number(it.ts) || 0) <= mark && (Number(it.ts) || 0) > mark - LATE_WINDOW_MS)
    .map((it) => it.id);
  const g = normGroup({ at: mark, ids });
  if (g) s.groups[group] = g;
  return s;
}

/** Whether two records say the same thing (so a bell can skip a write that changes nothing). */
export function sameSeen(a, b) {
  return JSON.stringify(normalizeSeen(a)) === JSON.stringify(normalizeSeen(b));
}
