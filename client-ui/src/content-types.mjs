// sow-196: the client-ui MIRROR of membership/content-types.mjs.
//
// client-ui is a browser bundle and deliberately imports nothing from membership/ or src/lib, so the rename
// compatibility has to be duplicated here rather than shared. test/content-types.test.mjs asserts this file
// and the canonical one agree, so the copy cannot drift silently.
//
// What breaks without it: a deep link someone already holds (#tab=product, #type=product, a saved browse
// hash) resolves to nothing and the view opens empty, with no error to explain why.

/** Stored type string -> the type it is called now. Keep in lockstep with membership/content-types.mjs. */
export const LEGACY_TYPE_ALIASES = Object.freeze({
  product: 'project', // sow-196, 2026-09-02
});

/** The current name for a possibly-legacy type string. Anything unrecognised passes through untouched. */
export function canonicalType(type) {
  const t = typeof type === 'string' ? type : '';
  return Object.prototype.hasOwnProperty.call(LEGACY_TYPE_ALIASES, t) ? LEGACY_TYPE_ALIASES[t] : t;
}
