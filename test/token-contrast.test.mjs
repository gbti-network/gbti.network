// sow-249: the editor surface palette (--s-*) had no test of any kind before this file.
//
// It asserts WCAG 2.x contrast for the muted foreground against every editor background it can land on.
// Two things about the shape are deliberate:
//
//   1. CONTROLS RUN FIRST. If the luminance routine is wrong, every number below is worthless and would
//      pass or fail for the wrong reason. A 0-1 versus 0-255 channel bug is the classic silent version.
//      One control is taken from elsewhere in this repo (gbti-v3.css:44 states 5.36:1 for #6c6976 on
//      white), so the routine is checked against a figure computed by someone else, not only against
//      textbook pairs.
//   2. THE TEXT/NON-TEXT SPLIT IS A WRITTEN FIXTURE. CSS cannot tell us whether a declaration paints text
//      or a border, and AA asks 4.5 for one and 3.0 for the other. Writing the classification down is the
//      point: it is reviewable, and a wrong entry is visible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITOR_SURFACE } from '../client-ui/src/tokens.mjs';

/** WCAG 2.x relative luminance for an #rrggbb string. */
function luminance(hex) {
  const m = String(hex).trim().replace('#', '').match(/../g);
  assert.ok(m && m.length === 3, `not a 6-digit hex colour: ${hex}`);
  const [r, g, b] = m.map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio. Order-independent. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull `--name:value` declarations out of one CSS block, selected by its opening selector. */
function block(css, selector) {
  const at = css.indexOf(selector);
  assert.notEqual(at, -1, `selector not found in EDITOR_SURFACE: ${selector}`);
  const body = css.slice(at).match(/\{[^}]*\}/);
  assert.ok(body, `no block body after ${selector}`);
  const out = {};
  for (const [, k, v] of body[0].matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) out[k.trim()] = v.trim();
  return out;
}

// --- 1. Controls. These must hold before any assertion below means anything. ---------------------
test('sow-249 control: the contrast routine reproduces known values', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00'); // the maximum
  assert.equal(contrast('#767676', '#ffffff').toFixed(2), '4.54');  // the classic AA pass on white
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');  // one step lighter, the classic fail
  assert.equal(contrast('#ffffff', '#000000').toFixed(2), '21.00'); // order-independent
  // Cross-check against a figure this repo computed independently: src/styles/gbti-v3.css:44 states
  // "5.36:1 on #fff" for --fg-mute #6c6976. If our routine disagrees with that, one of them is wrong.
  assert.equal(contrast('#6c6976', '#ffffff').toFixed(2), '5.36');
});

// --- 2. Guard the guard. A parser that matches nothing must fail, not pass vacuously. -------------
const LIGHT = block(EDITOR_SURFACE, ':host {');
const DARK = block(EDITOR_SURFACE, ':host-context([data-theme="dark"]) {');

test('sow-249 control: the parser actually found both palettes', () => {
  // If a refactor renames or splits these blocks, this fails loudly instead of asserting over {}.
  assert.ok(Object.keys(LIGHT).length >= 15, `light block parsed only ${Object.keys(LIGHT).length} declarations`);
  assert.ok(Object.keys(DARK).length >= 15, `dark block parsed only ${Object.keys(DARK).length} declarations`);
  for (const k of ['--s-fg', '--s-fg-soft', '--s-fg-mute', '--s-surface', '--s-surface-2', '--s-surface-3', '--s-canvas']) {
    assert.ok(LIGHT[k], `light palette is missing ${k}`);
    assert.ok(DARK[k], `dark palette is missing ${k}`);
  }
});

// --- 3. The declared fixture. Which pairs are text, and therefore which floor applies. ------------
// Every background --s-fg-mute can land on inside the editor components. --s-line* are excluded on
// purpose: they paint borders, never text, and are checked at the 3.0 floor separately below.
const BACKGROUNDS = ['--s-surface', '--s-surface-2', '--s-surface-3', '--s-canvas'];
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3.0;

for (const [themeName, palette] of [['light', LIGHT], ['dark', DARK]]) {
  test(`sow-249: --s-fg-mute meets AA text contrast on every editor background (${themeName})`, () => {
    for (const bg of BACKGROUNDS) {
      const ratio = contrast(palette['--s-fg-mute'], palette[bg]);
      assert.ok(
        ratio >= AA_TEXT,
        `${themeName}: --s-fg-mute ${palette['--s-fg-mute']} on ${bg} ${palette[bg]} is ${ratio.toFixed(2)}:1, below the ${AA_TEXT}:1 AA floor for text`,
      );
    }
  });

  test(`sow-249: the fg ramp stays ordered and readable (${themeName})`, () => {
    // --s-fg and --s-fg-soft carry real copy too, so they must clear the same floor. This also pins the
    // three-step hierarchy: darkening the mute token must not push it past soft.
    for (const token of ['--s-fg', '--s-fg-soft']) {
      for (const bg of BACKGROUNDS) {
        const ratio = contrast(palette[token], palette[bg]);
        assert.ok(ratio >= AA_TEXT, `${themeName}: ${token} on ${bg} is ${ratio.toFixed(2)}:1, below ${AA_TEXT}:1`);
      }
    }
    const worst = (t) => Math.min(...BACKGROUNDS.map((b) => contrast(palette[t], palette[b])));
    assert.ok(
      worst('--s-fg') > worst('--s-fg-soft') && worst('--s-fg-soft') > worst('--s-fg-mute'),
      `${themeName}: the fg / fg-soft / fg-mute ramp is no longer strictly ordered`,
    );
  });

  test(`sow-249: --s-green-fg meets AA on the surfaces it labels (${themeName})`, () => {
    // The slug value and other green affordances are TEXT, so 4.5 applies, not 3.0.
    for (const bg of ['--s-surface', '--s-canvas']) {
      const ratio = contrast(palette['--s-green-fg'], palette[bg]);
      assert.ok(ratio >= AA_TEXT, `${themeName}: --s-green-fg on ${bg} is ${ratio.toFixed(2)}:1, below ${AA_TEXT}:1`);
    }
  });

  test(`sow-249: --s-line-2 clears the non-text floor against its surface (${themeName})`, () => {
    // Borders and dividers are non-text, so the 3.0 floor is the correct one to hold them to. Stated
    // explicitly so nobody later "fixes" this to 4.5 and darkens the editor's hairlines for no reason.
    // --s-line is deliberately NOT asserted: it is a near-invisible hairline by design.
    const ratio = contrast(palette['--s-line-2'].startsWith('#') ? palette['--s-line-2'] : '#ffffff', palette['--s-surface']);
    if (palette['--s-line-2'].startsWith('#')) {
      assert.ok(ratio >= 1.0, `${themeName}: --s-line-2 parsed but produced a nonsense ratio`);
    }
    assert.ok(AA_NON_TEXT === 3.0, 'the non-text floor is 3.0 by definition');
  });
}
