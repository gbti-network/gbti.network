// The podcast card's controls (client/src/audio-card.mjs; owner, 2026-10-26, option B, "Jump by click or drag"). The
// DOM wiring is checked by rendering the page; these pin the arithmetic it shows and that every surface calls it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatTime, skipTo, positionText, SKIP_SECONDS } from '../client/src/audio-card.mjs';

test('the time text: minutes and seconds, hours when there are any, 0:00 for anything unknown', () => {
  assert.equal(formatTime(372), '6:12');
  assert.equal(formatTime(1316.2), '21:56');
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(3723), '1:02:03');
  for (const x of [NaN, Infinity, -4, undefined, null]) assert.equal(formatTime(x), '0:00');
  assert.equal(positionText(372, 1316.2), '6:12 of 21:56');
});

test('the arrow keys skip 10 seconds, never before the start or past the end', () => {
  assert.equal(SKIP_SECONDS, 10);
  assert.equal(skipTo(100, 'ArrowRight', 1316), 110);
  assert.equal(skipTo(100, 'ArrowUp', 1316), 110);
  assert.equal(skipTo(100, 'ArrowLeft', 1316), 90);
  assert.equal(skipTo(100, 'ArrowDown', 1316), 90);
  assert.equal(skipTo(4, 'ArrowLeft', 1316), 0);
  assert.equal(skipTo(1310, 'ArrowRight', 1316), 1316);
  assert.equal(skipTo(50, 'ArrowRight', NaN), 60, 'an unknown length does not stop the skip');
  assert.equal(skipTo(50, 'Home', 1316), 50);
});

test('the article page, the WorkBench preview and the extension reader each run the upgrade', () => {
  const calls = {
    'src/components/blog/Prose.astro': /\.forEach\(\(el\) => enhanceAudioCards\(el\)\)/,
    'src/lib/preview-page.ts': /enhanceAudioCards\(bodyEl\)/,
    'client-ui/src/elements/gbti-reader.mjs': /enhanceAudioCards\(this\.root\)/,
  };
  for (const [file, re] of Object.entries(calls)) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(src, /import \{ enhanceAudioCards \} from '[./]+\/client\/src\/audio-card\.mjs'/, file);
    assert.match(src, re, file);
  }
});

test('the WorkBench Visual view offers the Player style buttons on an audio block', () => {
  // sow-483 Phase 2: the buttons moved into the podcast block's form (client-ui/src/audio-block-ui.mjs), where they
  // write the style line through setAudioStyle as before.
  const src = fs.readFileSync(new URL('../client-ui/src/audio-block-ui.mjs', import.meta.url), 'utf8');
  assert.match(src, /Player style<\/span>\$\{seg\('Player style', AUDIO_STYLES\.map/);
  assert.match(src, /b\.code = setAudioStyle\(b\.code, btn\.dataset\.abStyle\)/);
  // A focused code block once lost its dark surface (light text on white, 2026-10-26). It keeps it now.
  const css = fs.readFileSync(new URL('../client-ui/src/doc-editor-css.mjs', import.meta.url), 'utf8');
  assert.match(css, /\.ce\.ce-code:focus \{ background:var\(--ink\); \}/);
});
