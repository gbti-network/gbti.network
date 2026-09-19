// sow-367: which of a news story's two summaries a reader sees.
//
// The owner's decision on 2026-09-19, after being shown that the case first put to them was weaker than
// claimed: keep the publisher's own blurb, and use ours ONLY where theirs is missing or stops mid-sentence.
// Measured that day over the 60 live stories: 52 carried both, at a median of 141 characters against our 160,
// and ours read as a rewrite rather than an improvement. SIXTEEN stopped mid-sentence, not the four first
// reported: that count looked for a visible trailing ellipsis, while most cut blurbs simply stop mid-word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { newsSummary, isCompleteSentence } from '../src/lib/news-summary.mjs';

test('sow-367: a finished blurb is left exactly as the publisher wrote it', () => {
  // The common case, and the one the owner chose to protect: 44 of 60 live stories. Their words, untouched,
  // not even re-punctuated.
  const item = { summary: 'Kalshi wants to bring perpetual futures to US traders.', digest: 'Our own rewrite of it.' };
  assert.equal(newsSummary(item), 'Kalshi wants to bring perpetual futures to US traders.');
  for (const ending of ['Done.', 'Really?', 'Stop!', 'He said "go."', 'See the note (below.)', "It's over.'"]) {
    assert.equal(newsSummary({ summary: ending, digest: 'ours' }), ending, ending);
  }
});

test('sow-367: a blurb cut off mid-sentence is replaced by ours', () => {
  // A real one, from the live feed on 2026-09-19. What a reader met was the first, ending on the word "over".
  const cut = "Building off yesterday's Wine 11.18 release is now Wine-Staging 11.18, presently carrying 273 extra patches over";
  const ours = 'Wine-Staging 11.18 adds 273 extra patches, including new WoW64 support patches, to the upstream release.';
  assert.equal(newsSummary({ summary: cut, digest: ours }), ours);
  // And one that trails off with the publisher's own ellipsis, which is still not a finished sentence.
  assert.equal(newsSummary({ summary: 'Several other exciting developments...', digest: ours }), ours);
});

test('sow-367: with no summary of our own, a cut blurb still says it was cut, ONCE', () => {
  // Today's behaviour, preserved exactly. Marking the cut is worse than finishing the sentence and better
  // than pretending the fragment is whole.
  assert.equal(newsSummary({ summary: 'It trails off here' }), 'It trails off here...');
  assert.equal(newsSummary({ summary: 'It trails off here', digest: '   ' }), 'It trails off here...');
  // A publisher who already trailed off has marked it. The old inline check got this right by accident, by
  // reading the trailing dot as a full stop, and treating an ellipsis as incomplete would have given it a
  // second one.
  assert.equal(newsSummary({ summary: 'Several other developments...' }), 'Several other developments...');
  assert.equal(newsSummary({ summary: 'Several other developments\u2026' }), 'Several other developments\u2026');
});

test('sow-367: no blurb at all falls to ours, and then to nothing', () => {
  assert.equal(newsSummary({ digest: 'Ours alone.' }), 'Ours alone.');
  assert.equal(newsSummary({ summary: '   ', digest: 'Ours alone.' }), 'Ours alone.');
  assert.equal(newsSummary({}), '');
  assert.equal(newsSummary(null), '');
  assert.equal(newsSummary({ summary: null, digest: undefined }), '');
});

test('sow-367: anything that is not text is not rendered as text', () => {
  // A feed is somebody else's data. `[object Object]` on a story page is the failure this prevents.
  for (const junk of [{ summary: {} }, { summary: [] }, { summary: 42 }, { digest: {} }]) {
    const out = newsSummary(junk);
    assert.ok(!out.includes('[object'), JSON.stringify(junk));
    assert.ok(!/^\d+$/.test(out), 'a number is not a summary');
  }
});

test('sow-367: the sentence test is what both surfaces already used, unchanged', () => {
  // This regex was written twice, byte identical, in the story page and the feed. Moving it here is the point:
  // they drifted from the extension in the same way twice because each held its own copy.
  assert.equal(isCompleteSentence('A whole sentence.'), true);
  assert.equal(isCompleteSentence('Cut off here'), false);
  assert.equal(isCompleteSentence('  padded.  '), true);
  assert.equal(isCompleteSentence(''), false);
  assert.equal(isCompleteSentence(null), false);
});

test('sow-367: both surfaces call the shared helper, and neither keeps its own copy of the rule', () => {
  // The drift guard. A page that reintroduces the inline regex is back to where this started, and nothing
  // else would notice.
  for (const rel of ['../src/pages/news/item.astro', '../src/components/feeds/FeedView.astro']) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(src, /newsSummary\(it\)/, `${rel} must render through the shared helper`);
    assert.match(src, /import \{ newsSummary \} from/, `${rel} must import it`);
    assert.doesNotMatch(src, /\[\.!\?\]\["'\)\\\]\]\?\$/, `${rel} still holds its own copy of the sentence rule`);
  }
});
