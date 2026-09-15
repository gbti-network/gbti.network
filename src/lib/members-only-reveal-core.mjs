// sow-323 Phase 3: the pure half of revealing members-only cards in a public listing after a paying member signs in.
//
// The owner ruled on 2026-09-12 that a members-only item keeps its own page but is not publicly indexed and not in a
// public feed until a superadmin approves it, and on 2026-09-15 that signed-in paying members still find these items
// in the feeds and lists. So a listing renders its public cards as always and its members-only cards inside a
// <template data-members-only>, whose content a browser never renders and a crawler does not read. For a paying
// member, src/lib/members-only-reveal.ts moves those cards into the list at the place the list's own order puts them.
// The decisions (who, and where each card goes) live here so node --test can drive them.

/** Who sees members-only cards in a listing: a PAID member. Fail closed: anything else, including an unresolved or
 *  trialing membership, sees only public cards (a trial reads members-only bodies locked, so a card is a dead end). */
export function canSeeMembersListing(signal) {
  return !!signal && typeof signal === 'object' && signal.membership === 'paid';
}

/** The orders a listing can ask for. `newest`: numeric key descending. `title`: text key ascending. `end`: append. */
export const REVEAL_ORDERS = Object.freeze(['newest', 'title', 'end']);

/**
 * Where each incoming card goes among the cards already in the list. `existing` and `incoming` are the order keys in
 * DOM order (a key is a number for `newest`, a string for `title`, ignored for `end`). Returns one entry per incoming
 * card, in incoming order: `{ index, before }` where `before` is the index in `existing` of the card to insert before,
 * or null to go after the last existing card. Ties go after the existing card with the same key. Pure.
 */
export function planReveal(existing, incoming, order = 'end') {
  const have = Array.isArray(existing) ? existing : [];
  const add = Array.isArray(incoming) ? incoming : [];
  const beforeIndex = (key) => {
    if (order === 'newest') {
      const k = Number(key) || 0;
      const i = have.findIndex((e) => (Number(e) || 0) < k);
      return i === -1 ? null : i;
    }
    if (order === 'title') {
      const k = String(key ?? '');
      const i = have.findIndex((e) => String(e ?? '').localeCompare(k) > 0);
      return i === -1 ? null : i;
    }
    return null;
  };
  return add.map((key, index) => ({ index, before: beforeIndex(key) }));
}
