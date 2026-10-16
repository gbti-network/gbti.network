// The AUDIENCE control in the editor's Details rail.
//
// sow-458 (owner, 2026-10-16): "It is published when the person publishes it." Editorial review is retired, so the
// audience is the author's own choice again: every author gets the Public / Members only switch, and a new item
// starts Public. Members only stays available as a perk for paying members, not a holding pen.
//
// History, so the shape of this module makes sense: sow-293 put a superadmin "make this public" button here, and
// sow-323 (2026-09-12) locked the switch for most authors (every item started members-only and a superadmin approved
// what went public, through the Worker's editorial approval route). Both retired with editorial review; the button,
// the approval route and the locked states are gone.
//
// A pure function so `node --test` covers it. An affordance, never the boundary: the Worker and the merge gate decide
// who may publish at all (paid, own folder).

/** The states the audience control can render in. One now; the name stays because the editor reads `mode`. */
export const AUDIENCE_MODES = Object.freeze(['switch']);

/**
 * How should the audience control render?
 *
 * @param currentVisibility  the item's CURRENT visibility, from the loaded preset. Absent (a new item) is Public.
 * @returns { mode, value, note }  `value` is what the hidden visibility input submits.
 */
export function audienceControl({ currentVisibility = null } = {}) {
  const vis = String(currentVisibility ?? '') === 'members' ? 'members' : 'public';
  return { mode: 'switch', value: vis, note: '' };
}
