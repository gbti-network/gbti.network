// The shared category -> fallback glyph map (client-ui/src/cat-glyph.mjs): the extension shows the SAME generic
// category icon the main app's PromptCard does when a content item has no image. Pure, node-testable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catGlyph, glyphFor, GLYPH_SVG, typeAccent } from '../client-ui/src/cat-glyph.mjs';

test('catGlyph maps known top-level categories to their glyph + accent', () => {
  const ai = catGlyph('ai');
  assert.equal(ai.svg, GLYPH_SVG.spark);
  assert.equal(ai.accent, '#6b4fb0');
  assert.equal(catGlyph('devops').svg, GLYPH_SVG.terminal);
  assert.equal(catGlyph('writing').svg, GLYPH_SVG.pencil);
});

test('the new Skill category resolves to its bolt glyph + rose accent', () => {
  const s = catGlyph('skill');
  assert.equal(s.svg, GLYPH_SVG.skill);
  assert.equal(s.accent, '#b0316f');
});

test('an unknown or missing category falls back to the neutral puzzle glyph (never empty)', () => {
  assert.equal(catGlyph('nope').svg, GLYPH_SVG.puzzle);
  assert.equal(catGlyph(null).svg, GLYPH_SVG.puzzle);
  assert.equal(catGlyph(undefined).svg, GLYPH_SVG.puzzle);
  assert.ok(catGlyph(null).accent); // an accent is always returned
});

test('category match is case-insensitive', () => {
  assert.equal(catGlyph('AI').svg, GLYPH_SVG.spark);
  assert.equal(catGlyph('Skill').svg, GLYPH_SVG.skill);
});

// SOW-041: glyphFor(category, type) — category first, then a TYPE fallback (so a Share, which has no category,
// gets the coin glyph), then the neutral puzzle.
test('glyphFor prefers a known category over the type', () => {
  assert.equal(glyphFor('ai', 'share').svg, GLYPH_SVG.spark);
  assert.equal(glyphFor('ai', 'share').accent, '#6b4fb0');
  assert.equal(glyphFor('blockchain', 'post').svg, GLYPH_SVG.coin);
});

test('glyphFor falls back to TYPE when the category is missing/unknown (Shares -> coin)', () => {
  assert.equal(glyphFor(null, 'share').svg, GLYPH_SVG.coin);
  assert.equal(glyphFor('', 'share').svg, GLYPH_SVG.coin);
  assert.equal(glyphFor('not-a-category', 'product').svg, GLYPH_SVG.box);
  assert.equal(glyphFor(undefined, 'prompt').svg, GLYPH_SVG.spark);
  assert.equal(glyphFor('zzz', 'post').svg, GLYPH_SVG.pencil);
});

test('glyphFor with neither a known category nor type -> the neutral puzzle glyph', () => {
  assert.equal(glyphFor(null, null).svg, GLYPH_SVG.puzzle);
  assert.equal(glyphFor('', 'weird-type').svg, GLYPH_SVG.puzzle);
  assert.equal(glyphFor(null, null).accent, '#5b6472');
});

// The activity-feed separation treatment (accent bar + tint + colored chip) keys on the per-TYPE accent.
test('typeAccent returns a distinct color per member type; unknown -> neutral', () => {
  assert.equal(typeAccent('post'), '#3f74c9');     // Article = blue
  assert.equal(typeAccent('product'), '#c9683b');  // Product = orange
  assert.equal(typeAccent('prompt'), '#1f9e5f');   // Prompt = green
  assert.equal(typeAccent('share'), '#b3791f');    // Share = gold
  assert.equal(typeAccent('news'), '#3a6ea5');     // News (the renderer omits the bar/tint for it)
  assert.equal(typeAccent('PROMPT'), '#1f9e5f');   // case-insensitive
  assert.equal(typeAccent('mystery'), '#5b6472');  // unknown -> OTHER_ACCENT
  assert.equal(typeAccent(null), '#5b6472');
});
