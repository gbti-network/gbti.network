// sow-175: pick the LARGEST candidate out of a responsive `srcset`, for the lightbox.
//
// The lightbox used to open `img.currentSrc || img.src`. `currentSrc` is whatever the browser chose for the
// image's rendered box, so on a typical desktop viewport a body image that ships 640w through 1280w opens at
// a mid-range variant and the "enlarge" gesture returns something no larger than what was already on screen.
// Picking the widest candidate is the whole point of the interaction.
//
// EXTRACTED ON PURPOSE. The caller lives inside `Lightbox.astro`'s bundled <script>, which no unit test can
// import, so logic left in there is untestable by construction and its absence from the suite looks like
// coverage elsewhere. This function is the pure half and `test/lightbox-src.test.mjs` exercises it directly.
//
// Known limit, stated rather than hidden: candidates are split on commas, so a URL containing a literal comma
// (a `data:` URI, say) would split wrongly. Astro emits plain `/_astro/...` paths, so this does not arise here.

/**
 * @param {string} srcset the raw `srcset` attribute value
 * @returns {string} the URL of the highest-density/widest candidate, or '' when there is nothing usable
 */
export function widestFromSrcset(srcset) {
  if (typeof srcset !== 'string') return '';
  let best = '';
  let bestScore = -Infinity;
  for (const raw of srcset.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const [url, desc = ''] = part.split(/\s+/);
    if (!url) continue;
    const w = /^(\d+(?:\.\d+)?)w$/.exec(desc);
    const x = /^(\d+(?:\.\d+)?)x$/.exec(desc);
    // A bare candidate is 1x per the HTML spec. `w` and `x` descriptors never mix within one srcset, so
    // comparing their numbers directly is safe: either every candidate is a width or every one is a density.
    const score = w ? parseFloat(w[1]) : x ? parseFloat(x[1]) : 1;
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }
  return best;
}
