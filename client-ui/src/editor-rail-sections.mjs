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
