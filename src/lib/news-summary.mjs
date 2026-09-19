// sow-367: which summary a news story shows, and why it is usually the publisher's own.
//
// A stored news item carries TWO summaries. `summary` is the publisher's own blurb, lifted from their feed.
// `digest` is ours, written by the model during ingest. The extension has always preferred ours; the website
// has always shown theirs, so the same story read two different ways depending on where you read it.
//
// WE KEEP SHOWING THE PUBLISHER'S, and the reason is a measurement rather than a preference. Of 60 live
// stories on 2026-09-19, 52 carried both, at a median of 141 characters against our 160, and reading them
// side by side our version was a rewrite of comparable quality rather than an improvement. Switching every
// story to ours would have changed the text on 52 pages to buy consistency with the extension and nothing
// else, and on a news aggregator the publisher's own words are the more honest thing to print.
//
// THE ONE PLACE OURS IS BETTER is a blurb that stops mid-sentence, which 16 of those 60 did. The first count
// put to the owner was 4, measured by looking for a visible trailing ellipsis, which is not the rule: a blurb
// that simply stops mid-word carries no marker at all and is the commoner case. Both surfaces
// already DETECTED that case and both responded by appending an ellipsis, which tells the reader the sentence
// was cut without giving them the rest of it. We have the rest of it. That is the whole change.
//
// Owner decision, 2026-09-19, after being shown the measurement and a weaker case than the one first put to
// them: use ours only where theirs is missing or cut off.

/**
 * A blurb that ends on sentence punctuation, allowing a closing quote or bracket after it.
 *
 * AN ELLIPSIS IS NOT AN ENDING, and missing that made the whole change a no-op on one of the four stories it
 * exists for. "Several other exciting developments..." ends in a full stop and so read as a finished sentence,
 * which is exactly backwards: a publisher who trails off has told us the blurb is a fragment. Caught by the
 * test, not by reading.
 */
const ELLIPSIS = /(\.\.\.|\u2026)["')\]]?$/;
const COMPLETE = /[.!?]["')\]]?$/;

/**
 * The summary line to render for a news item, or an empty string when there is nothing to show.
 *
 * Pure, and shared by the story page and the feed so the two cannot drift apart again. They held byte
 * identical copies of this logic before, which is how they came to disagree with the extension in the same
 * way twice.
 */
export function newsSummary(item) {
  // A feed is somebody else's data. Stringifying whatever arrives puts "[object Object]" on a story page,
  // which is what the pages did before this. Anything that is not text is not a summary.
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const blurb = text(item?.summary);
  const ours = text(item?.digest);
  if (!blurb) return ours;              // the publisher sent no blurb: ours or nothing
  if (COMPLETE.test(blurb) && !ELLIPSIS.test(blurb)) return blurb; // a whole sentence: their words stand, untouched
  if (ours) return ours;                // cut off mid-sentence, and we have the rest of it
  // No summary of our own, so mark the cut as the pages always did. A blurb the publisher already ended with
  // an ellipsis is already marked: appending a second one gives "developments......", which the old inline
  // check avoided by accident (it read the trailing dot as a full stop) and this would have reintroduced.
  return ELLIPSIS.test(blurb) ? blurb : `${blurb}...`;
}

/** Whether a blurb reads as a finished sentence. Exported for the tests and for anything that needs the test. */
export const isCompleteSentence = (text) => {
  const t = typeof text === 'string' ? text.trim() : '';
  return COMPLETE.test(t) && !ELLIPSIS.test(t);
};
