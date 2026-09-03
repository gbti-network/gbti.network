// sow-196: the canonical content-type vocabulary, and the RENAME COMPATIBILITY that has to outlive it.
//
// The `product` content type was renamed to `project` on 2026-09-02. Everything the network has ever stored
// about a product is keyed on the STRING "product": every member's saved items and collections in KV
// (`activity:<github_id>`), every comment's `targetType`, every row in house/favorite-counts.yml, and every
// content path under `<owner>/products/<slug>/` in git history.
//
// WHAT BREAKS IF THIS MODULE IS REMOVED OR ITS `product` ENTRY IS DROPPED, stated as consequence rather than
// as rationale, because a rule written as a design preference gets traded away under pressure:
//
//   * Every member's saved list silently EMPTIES of projects. `normalizeActivity` in member-activity.mjs
//     discards any entry whose type is not in CONTENT_TYPES, and it discards it without an error, a log line
//     or a failed request. The member sees an empty shelf and nothing anywhere reports a fault.
//   * Every comment ever left on a product detaches from its item, because the comment reader matches on
//     targetType.
//   * Favorite counts read 0 on every migrated item.
//
// None of those fail loudly. That is the whole reason this module exists as one shared thing rather than as
// a handful of inline `|| 'product'` checks that a future cleanup would tidy away one at a time.
//
// Node-free on purpose: imported by src/lib (Astro build), workers/ (Cloudflare) and scripts/ alike.
// client-ui/ and extension/ cannot import from here, so they carry documented copies; the copies are covered
// by test/content-types.test.mjs, which asserts they agree with this file.

/** Stored type string -> the type it is called now. Entries are permanent; a rename ADDS one, never edits one. */
export const LEGACY_TYPE_ALIASES = Object.freeze({
  product: 'project', // sow-196, 2026-09-02
});

/** The current content types. `share` and `news` are here because activity + comments target them too. */
export const CONTENT_TYPES = Object.freeze(['post', 'project', 'prompt', 'share', 'news']);

/**
 * The current name for a type string that may have been written under an older name. Anything unrecognised
 * passes through untouched, so this is safe to apply to arbitrary caller input before validating it.
 */
export function canonicalType(type) {
  const t = typeof type === 'string' ? type : '';
  return Object.prototype.hasOwnProperty.call(LEGACY_TYPE_ALIASES, t) ? LEGACY_TYPE_ALIASES[t] : t;
}

/** Every older name for a current type, e.g. legacyNamesOf('project') -> ['product']. Empty for the rest. */
export function legacyNamesOf(type) {
  return Object.keys(LEGACY_TYPE_ALIASES).filter((k) => LEGACY_TYPE_ALIASES[k] === type);
}

/**
 * The lookup keys for a `<type>:<slug>` aggregate, current name first, then every older name. Callers take
 * the FIRST hit rather than summing, so an item that somehow carries both keys is not double counted.
 */
export function typeKeysFor(type, slug) {
  return [type, ...legacyNamesOf(type)].map((t) => `${t}:${slug}`);
}
