// sow-174: the category drilldown for the cross-type feed (`/feeds/?cat=<key>`), which is where product and
// article breadcrumbs now point.
//
// EXTRACTED ON PURPOSE, for two reasons. The consumer lives inside `FeedView.astro`'s bundled <script>, which
// no unit test can import, so logic left in there is untestable by construction and its absence from the suite
// reads as coverage elsewhere. And this is the exact logic that failed silently once before: the prompts
// directory only honoured a `?cat=` that had a matching sidebar BUTTON, so a leaf crumb like `?cat=skill`
// filtered nothing and rendered a full unfiltered page that looked broken (sow-174, fixed for prompts in
// `e9fb99f`). The feed has no category sidebar at all, so matching is against the DATA and a leaf can never be
// dropped for lacking a control.

/** Normalize one category key: trimmed, lower case, spaces collapsed out. Empty stays empty. */
export function catKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * The `data-cats` attribute for a feed row: every segment of the item's category PATH, space separated.
 *
 * The whole path rather than the leaf or the top: a crumb may link any depth, and `devops > ide-plugins`
 * must match both `?cat=devops` and `?cat=ide-plugins`. Storing only one end would make the other crumb dead,
 * which is the defect this SOW exists to fix.
 */
export function catsAttr(categories) {
  const seen = new Set();
  for (const c of Array.isArray(categories) ? categories : []) {
    const k = catKey(c);
    if (k) seen.add(k);
  }
  return [...seen].join(' ');
}

/** Does a row carrying `attr` (a `catsAttr` string) belong to category `cat`? An empty cat matches nothing. */
export function rowMatchesCat(attr, cat) {
  const want = catKey(cat);
  if (!want) return false;
  return (' ' + String(attr ?? '') + ' ').includes(' ' + want + ' ');
}
