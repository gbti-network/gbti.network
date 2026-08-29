// The WorkBench Preview edits a paragraph in place: it renders the body with renderMarkdownWithBlocks, lets the
// author type into the rendered block, then reads that block back with inlineHtmlToMd and splices the result over
// the block's source line (src/pages/workbench/preview.astro commitBlock). That only works if the SITE renderer and
// inlineHtmlToMd are inverses of each other. They were not, and nothing tested the pair: test/inline-md.test.mjs
// guards inlineMdToHtml <-> inlineHtmlToMd, which is a DIFFERENT pair used by the doc editor.
//
// Two failures fell out of the gap. A markdown link came back as raw <a> HTML, and a double quote came back as the
// literal string &quot;, which re-renders to &amp;quot; and shows the entity to the reader. Because commitBlock
// compares the read-back to the source as a raw string, both also made a click-through look like an edit: the body
// was rewritten and re-rendered under the author's next click, which is why clicking a paragraph appeared to do
// nothing. Pure + node-safe (no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownWithBlocks } from '../client/src/markdown.mjs';
import { inlineHtmlToMd } from '../client-ui/src/markdown-blocks.mjs';

// Mirror of what commitBlock does for ONE block, minus the DOM: take the rendered inner HTML of a block and read it
// back to the markdown that should be spliced over its source line.
const readBack = (inner, before) => {
  const prefix = /^(\s{0,3}(?:#{1,6}\s+|>\s?|[-*]\s+|\d+\.\s+))/.exec(before);
  return (prefix ? prefix[1] : '') + inlineHtmlToMd(inner, { rendererAnchors: true }).trim();
};

// Every wired block, as { line, source, inner }. wireEditing only wires a single-source-line P or H block, because
// commitBlock replaces a block's whole range with one line, so that is exactly the set under test.
function wiredBlocks(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const { html, blocks } = renderMarkdownWithBlocks(body);
  const out = [];
  const re = /<(p|h[1-6])\b([^>]*\bdata-blk="(\d+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const range = blocks[Number(m[3])];
    if (!range || range.start !== range.end) continue;
    out.push({ line: range.start + 1, source: lines[range.start], inner: m[4] });
  }
  return out;
}

const FIXTURE = [
  'A plain sentence with nothing special in it.',
  '',
  'Ceilings rather than reservations, which is not what "load balancing" describes.',
  '',
  "I've had an ASRock H110 Pro BTC+ in the closet since Ethereum was proof of work.",
  '',
  '[Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment/overview) is a Debian-based platform.',
  '',
  'Read **the docs** at [SavePoint](https://savepoint.fm) and run `pct enter 101` to get a shell.',
  '',
  '## What LXC is, and how it differs from a "virtual machine"',
  '',
  'Ampersands & angle brackets like <not-a-tag> must survive the trip too.',
].join('\n');

test('every wired Preview block reads back to its exact source line', () => {
  const wired = wiredBlocks(FIXTURE);
  assert.equal(wired.length, 7, 'fixture should wire 7 single-line blocks; the guard is worthless if it wires none');
  for (const b of wired) {
    assert.equal(readBack(b.inner, b.source), b.source, `line ${b.line} did not survive the round trip`);
  }
});

test('a click-through commits nothing: the read-back equals the source for every block', () => {
  // This is the dropped-click defect stated as data. commitBlock treats read-back !== source as an edit, rewrites
  // the body and re-renders the whole document, destroying the node the author is clicking next.
  const mismatched = wiredBlocks(FIXTURE).filter((b) => readBack(b.inner, b.source) !== b.source);
  assert.deepEqual(mismatched.map((b) => b.line), [], 'these lines would be rewritten by a click-through');
});

test('a double quote survives as a quote, not as an entity the reader can see', () => {
  const [block] = wiredBlocks('He called it "load balancing".');
  assert.equal(readBack(block.inner, block.source), 'He called it "load balancing".');
});

test('a markdown link stays markdown rather than becoming raw anchor HTML', () => {
  const src = '[Proxmox VE](https://www.proxmox.com/) is Debian-based.';
  const [block] = wiredBlocks(src);
  assert.equal(readBack(block.inner, block.source), src);
});

test('a heading keeps its hashes and its inline content', () => {
  const src = '## What LXC is, and how it differs from a "virtual machine"';
  const [block] = wiredBlocks(src);
  assert.equal(readBack(block.inner, block.source), src);
});

// --- 2026-08-28: the duplicated paragraph, reported while applying a Grammarly correction ------------------
//
// Editing in the Preview cloned whole paragraphs: the original stayed on the page and the edited copy appeared
// beside it. Three things had to line up, and each one is pinned below.
//
// 1. A grammar extension decorates the paragraph it is checking with its own markup. The blur handler decided
//    "did the author edit this block" by comparing el.innerHTML against a snapshot, so a decorated-but-untouched
//    block read as edited and was committed.
// 2. Committing a soft-wrapped paragraph collapses its source lines into one, because the renderer joins them
//    into a single <p> and the read-back is a single line. The document therefore gets SHORTER on commit.
// 3. commitIn writes the source synchronously but refreshes doc.ranges only after an awaited re-render. A second
//    commit inside that window splices with ranges describing the pre-commit document, so it writes over the
//    wrong lines and leaves the original text behind.
//
// The fix compares the READ-BACK instead of innerHTML (1) and serializes commits (3). (2) is correct behaviour
// and is pinned here so a future change to the join notices that ranges shift.
import { applyBlockEdit } from '../client-ui/src/block-commit.mjs';

const SOFT_WRAPPED = [
  'With TailScale, I am able to type http://homesurveliance into any browser on any device',
  '(mobile or desktop) connected to my Tailscale workspace.',
].join('\n');

/** The inner HTML of block 0, as the Preview renders it. */
const innerOf = (src) => /<p data-blk="0">([\s\S]*?)<\/p>/.exec(renderMarkdownWithBlocks(src).html)[1];

/** How a grammar extension marks up a word it wants to flag, in place, without changing the text. */
const decorate = (inner, word) => inner.replace(word, `<span class="gr_ gr__abc123" data-gr-id="7">${word}</span>`);

test('a grammar extension decorating a block is NOT an author edit', () => {
  const inner = innerOf(SOFT_WRAPPED);
  const decorated = decorate(inner, 'browser');
  // The positive control. Without it this test would still pass if `decorate` silently stopped decorating, and
  // a test that cannot fail proves nothing about the fix it is guarding.
  assert.notEqual(inner, decorated, 'the fixture must actually differ, or the assertion below is vacuous');
  // The invariant the blur handler now relies on: same text in, same read-back out, decoration or not.
  assert.equal(
    inlineHtmlToMd(decorated, { rendererAnchors: true }).trim(),
    inlineHtmlToMd(inner, { rendererAnchors: true }).trim(),
    'a decorated block must read back identically, or an untouched paragraph gets committed',
  );
});

test('committing a soft-wrapped paragraph collapses its source lines, so later ranges shift', () => {
  const lines = SOFT_WRAPPED.split('\n');
  const read = { kind: 'paragraph', text: inlineHtmlToMd(innerOf(SOFT_WRAPPED), { rendererAnchors: true }).trim() };
  const next = applyBlockEdit(lines.join('\n'), read);
  assert.equal(lines.length, 2);
  assert.equal(next.length, 1, 'two source lines render as one <p> and read back as one line');
  // This is why a stale range is dangerous rather than merely wrong: the document changes LENGTH on commit.
  assert.notEqual(next.join('\n'), lines.join('\n'));
});

test('a commit against a stale range duplicates content instead of replacing it', () => {
  // Two paragraphs. Commit the first (2 lines -> 1), then commit the second using the ranges captured BEFORE
  // that first commit, which is exactly what an overlapping commit did while the re-render was still pending.
  const body = `${SOFT_WRAPPED}\n\nTailscale builds a private mesh network between your own devices. Its MagicDNS\ngives each machine a stable hostname on that network.`;
  const stale = renderMarkdownWithBlocks(body).blocks;

  const commit = (src, range, text) => {
    const lines = src.split('\n');
    const next = applyBlockEdit(lines.slice(range.start, range.end + 1).join('\n'), { kind: 'paragraph', text });
    if (!next) return src;
    lines.splice(range.start, range.end - range.start + 1, ...next);
    return lines.join('\n');
  };

  const afterFirst = commit(body, stale[0], 'With TailScale I am able to type it.');
  const afterSecond = commit(afterFirst, stale[1], 'Tailscale BUILDS a private mesh network.');

  // The signature of the reported defect: the second paragraph's original opening line survives as its own
  // paragraph while the edited copy is written below it.
  assert.ok(
    afterSecond.includes('Tailscale builds a private mesh network') && afterSecond.includes('Tailscale BUILDS a private mesh network'),
    'a stale range leaves the original text behind and writes the edit elsewhere: this is the clone',
  );
  // And the control: with FRESH ranges the same two edits replace cleanly and nothing is duplicated.
  const fresh = renderMarkdownWithBlocks(afterFirst).blocks;
  const clean = commit(afterFirst, fresh[1], 'Tailscale BUILDS a private mesh network.');
  assert.ok(!clean.includes('Tailscale builds a private mesh network'), 'a fresh range replaces rather than clones');
});
