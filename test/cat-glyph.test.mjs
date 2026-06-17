// The shared category -> fallback glyph map (client-ui/src/cat-glyph.mjs): the extension shows the SAME generic
// category icon the main app's PromptCard does when a content item has no image. Pure, node-testable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catGlyph, GLYPH_SVG } from '../client-ui/src/cat-glyph.mjs';

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
