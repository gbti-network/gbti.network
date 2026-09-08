// sow-316: what a save control shows BEFORE anyone clicks it.
//
// <gbti-favorite> and <gbti-collection> wrote correctly and read nothing back on load: every heart started
// empty and every pill said "Save", so a favorite survived a refresh on the server and not on the screen. The
// extension reader stamped the heart itself after its own click; the website had nobody to do that. Both
// elements now prime themselves from the member's activity through this module.
//
// One request per page, not one per control. A feed page carries dozens of hearts, so the read is memoized per
// client (the same client object every element sees via base.mjs) and shared as a single in-flight promise.
// A write that returns the full activity records it here (noteActivity), and a write that returns less
// invalidates it, so the next control to prime sees the truth rather than a stale snapshot.
//
// Pure apart from the cache. No DOM, so the whole thing is unit-tested with a fake client.

const CACHE = new WeakMap(); // client -> { promise, activity }

const EMPTY = () => ({ favorites: [], collections: [] });

/** Resolve the member's activity once per client; concurrent callers share the same request. */
export function primeActivity(client) {
  if (!client || typeof client.getActivity !== 'function') return Promise.resolve(EMPTY());
  const hit = CACHE.get(client);
  if (hit) return hit.promise;
  const entry = { promise: null, activity: null };
  entry.promise = Promise.resolve()
    .then(() => client.getActivity())
    .then((a) => { entry.activity = normalize(a); return entry.activity; })
    .catch((err) => { CACHE.delete(client); throw err; }); // a failed read must not be memoized as an answer
  CACHE.set(client, entry);
  return entry.promise;
}

/** A write returned the whole activity: make it the answer for everyone who primes after this. */
export function noteActivity(client, activity) {
  if (!client || !activity) return;
  const a = normalize(activity);
  CACHE.set(client, { promise: Promise.resolve(a), activity: a });
}

/** A write happened whose answer did not carry the activity: forget the snapshot so the next prime re-reads. */
export function invalidateActivity(client) {
  if (client) CACHE.delete(client);
}

function normalize(a) {
  return {
    favorites: Array.isArray(a?.favorites) ? a.favorites : [],
    collections: Array.isArray(a?.collections) ? a.collections : [],
  };
}

const same = (it, t) => it && it.type === t.type && it.slug === t.slug;

/** Whether the member has favorited this item. */
export function isFavorited(activity, target) {
  return !!target?.type && !!target?.slug && (activity?.favorites || []).some((f) => same(f, target));
}

/** How many of the member's collections hold this item. */
export function collectionsHolding(activity, target) {
  if (!target?.type || !target?.slug) return 0;
  return (activity?.collections || []).filter((c) => (c?.items || []).some((it) => same(it, target))).length;
}

/** The pill's visible word and its accessible name, from that count. */
export function collectionPill(n) {
  if (!(n > 0)) return { text: 'Save', label: 'Save to a collection' };
  return { text: `Saved (${n})`, label: `Saved in ${n} collection${n === 1 ? '' : 's'}` };
}
