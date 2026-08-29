// sow-282: the pure transformation behind the Social Queue's optimistic actions.
//
// WHY THIS IS SAFE TO DO OPTIMISTICALLY, since that is the whole question with an optimistic UI: for
// `done` and `delete` the client can compute the SAME result the server will produce. Mark done moves a
// row from `pending` to `done`; delete removes it. So the row shown after the click is not a guess about
// what the server will say, it is the server's own transformation applied locally first.
//
// `post` is deliberately NOT handled here. It performs a real, irreversible publish to an external network
// (Reddit, Bluesky, LinkedIn) and the client cannot know whether that network accepted it. Emulating
// success there would report a post that may never have gone out. Callers must keep `post` synchronous.
//
// Every function is pure: inputs are never mutated, new arrays are returned.

const LISTS = ['pending', 'done'];

/** Locate a row by id across both lists. Returns { list, index, row } or null. */
function locate(data, id) {
  for (const list of LISTS) {
    const arr = Array.isArray(data?.[list]) ? data[list] : [];
    const index = arr.findIndex((r) => r && r.id === id);
    if (index !== -1) return { list, index, row: arr[index] };
  }
  return null;
}

/**
 * Apply `done` or `delete` locally.
 *
 * Returns `{ next, undo }`, or **null** when the action is not locally computable (`post`), the id is not
 * present, or the row is already in the target state. A null return means "do not take the optimistic
 * path", which is the signal the element uses to fall back rather than render a lie.
 *
 * The undo record carries the row's ORIGINAL INDEX, not just its identity. Restoring presence without
 * position would drop a failed row at the bottom of a long list, which reads to the operator as a second
 * bug rather than as a recovery.
 */
export function applyQueueAction(data, action, id, { now = null } = {}) {
  if (!data || !id) return null;
  if (action !== 'done' && action !== 'delete') return null; // `post` and anything unknown stay synchronous

  const found = locate(data, id);
  if (!found) return null;

  const next = { ...data };
  for (const list of LISTS) next[list] = Array.isArray(data[list]) ? [...data[list]] : [];

  // Remove it from wherever it currently lives.
  next[found.list].splice(found.index, 1);
  const undo = { removed: { list: found.list, index: found.index, row: found.row }, added: null };

  if (action === 'done') {
    if (found.list === 'done') return null; // already done: nothing to emulate
    const stamped = { ...found.row, doneAt: found.row.doneAt ?? (now ?? Date.now()) };
    next.done = [stamped, ...next.done]; // newest first, matching how the Manual done tab reads
    undo.added = { list: 'done', id };
  }

  return { next, undo };
}

/**
 * Reverse an `applyQueueAction` result after the background call failed. Restores the row to its exact
 * original list AND index, and drops the copy the action added, so a failed action leaves the queue
 * byte-identical to how the operator last saw it.
 */
export function revertQueueAction(data, undo) {
  if (!data || !undo?.removed) return data;

  const next = { ...data };
  for (const list of LISTS) next[list] = Array.isArray(data[list]) ? [...data[list]] : [];

  if (undo.added) {
    const arr = next[undo.added.list];
    const at = arr.findIndex((r) => r && r.id === undo.added.id);
    if (at !== -1) arr.splice(at, 1);
  }

  const { list, index, row } = undo.removed;
  const target = next[list];
  target.splice(Math.min(index, target.length), 0, row); // clamp: the list may have shrunk underneath us
  return next;
}
