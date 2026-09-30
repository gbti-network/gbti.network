// sow-428: the picture for anyone without one. Owner, 2026-09-30: "We can use blobatar library for anyone who does not
// have a linked avatar." Blobatar (MIT, no dependencies) draws a small creature from a string, the same creature for
// the same string every time, so a member keeps one face on every surface. It replaces the letter discs.
//
// Seeded with the member's GBTI name (their folder) wherever it is known, so the creature matches across the site,
// the extension and the WorkBench. It is drawn UNDER the member's photo, and a photo that is missing or fails to load
// leaves it showing.
//
// memberBlob is a `data:` URL, so it costs no request; the site build also writes each known member's as a file, which
// a page that repeats a member downloads once (src/lib/blob-seeds.mjs). It is SVG, which email clients do not display,
// so the weekly digest never uses it (membership/mail-render.mjs).
//
// Pinned to blobatar major 2 in package.json: the library promises the same drawing for a name only within a major,
// so moving to a new one redraws every member.
import { blobatarUri } from 'blobatar/uri';
import { blobatar } from 'blobatar/blob';

// The square backdrop is a pale tint of the creature's own colour. The avatar's round frame clips it to a disc, and
// it reads on light and dark pages alike (compared side by side on 2026-09-30).
const OPTIONS = Object.freeze({ background: 'square' });
const seedOf = (name) => String(name ?? '').trim() || 'gbti';

/** The blobatar for a name, as a `data:` URL. Blobatar trims and lowercases the name itself. */
export function memberBlob(name) {
  return blobatarUri(seedOf(name), OPTIONS);
}

/** The same blobatar as SVG markup, for the site build to write as a file (src/pages/blobatar/[seed].svg.ts). */
export function memberBlobSvg(name) {
  return blobatar(seedOf(name), OPTIONS);
}
