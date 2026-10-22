// sow-164: the editor's Media section leaves the generic rail stack for a slot of its own (top of the rail on a
// wide screen, above the document when the layout stacks), for every content type. The split is pure so each
// type's outcome is a unit test: Media comes out with its keys intact, the other sections keep their order,
// and a schema with no Media yields nothing to place.

/** Split a RAIL_SCHEMA entry into the Media section (or null) and the rest, order preserved. */
export function splitRailSections(schema) {
  const list = Array.isArray(schema) ? schema : [];
  const media = list.find((s) => s && s.title === 'Media') || null;
  const rest = list.filter((s) => s !== media);
  return { media, rest };
}

// Where the permalink editor attaches inside the Details rail, per content type.
//
// Why this is a function and not a field name in the renderer: the editor used to inject the permalink at
// `key === 'shortDescription'`, which project and prompt have and `post` does NOT (an article's description
// field is `excerpt`). So an article rendered no permalink editor at all, and because the inline header slug
// is display-only, an article could never be given a permalink. Save draft and Publish then both refused with
// "Add a permalink first", with no field anywhere on the page to satisfy them. Reported 2026-10-21 by the
// first member to write an article on this CMS, which is why it had gone unnoticed.
//
// `before: null` means "put it at the top of the section". That fallback is the load-bearing part: a Details
// section whose `permalinkBefore` is missing or names a key it does not have still gets a permalink editor,
// so a new content type can never silently lose the only control that sets its URL.
export function permalinkPlacement(schema) {
  const details = (Array.isArray(schema) ? schema : []).find((s) => s && s.title === 'Details');
  if (!details) return null; // no Details section: nothing to attach to, and the caller has no rail to use
  const keys = Array.isArray(details.keys) ? details.keys : [];
  const anchor = typeof details.permalinkBefore === 'string' ? details.permalinkBefore : '';
  return { before: anchor && keys.includes(anchor) ? anchor : null };
}
