// sow-440 (owner, 2026-10-03): "We should hide the logo on the left before we cause our topbar to break into two rows."
// The owner's order: the "GBTI" word first, then the logo icon, then (only if it still does not fit) the quick launch,
// as on phones. These tests hold the decision, the reserve that stops a hover from flipping the logo, and the wiring
// and CSS that make it work on every extension page. The browser drive is recorded in the sow-440 document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { decideTopbarFit, reservedQuickLaunchWidth, FIT_STEPS } from '../extension/src/topbar-fit.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Widths close to the real bar: brand 26px logo + 10px gap + 46px word + 10px padding; the controls without the quick
// launch (view toggle, bell, theme, account, pencil plus gaps) 460px; six sites with the settings button open 290px.
const BAR = { rowGap: 18, brandFull: 92, brandMark: 36, controls: 460, quickLaunch: 290, clusterGap: 12 };
const need = (b, ql) => b + (b ? BAR.rowGap : 0) + BAR.controls + (ql ? BAR.quickLaunch + BAR.clusterGap : 0) + 1;

test('the steps run in the owner\'s order: the word, then the logo, then the quick launch', () => {
  assert.deepEqual(FIT_STEPS.map((s) => `${s.brand}/${s.quickLaunch}`), ['full/true', 'mark/true', 'none/true', 'none/false']);
});

test('each narrower width drops exactly the next thing, and each returns when there is room', () => {
  const at = (row) => decideTopbarFit({ ...BAR, row });
  assert.deepEqual(at(1200), { brand: 'full', quickLaunch: true }, 'a wide bar keeps everything');
  assert.deepEqual(at(need(92, true)), { brand: 'full', quickLaunch: true }, 'exactly enough room keeps the word');
  assert.deepEqual(at(need(92, true) - 1), { brand: 'mark', quickLaunch: true }, 'one pixel short drops the word only');
  assert.deepEqual(at(need(36, true)), { brand: 'mark', quickLaunch: true });
  assert.deepEqual(at(need(36, true) - 1), { brand: 'none', quickLaunch: true }, 'then the logo icon');
  assert.deepEqual(at(need(0, true)), { brand: 'none', quickLaunch: true });
  assert.deepEqual(at(need(0, true) - 1), { brand: 'none', quickLaunch: false }, 'then the quick launch');
  assert.deepEqual(at(200), { brand: 'none', quickLaunch: false }, 'nothing fits: the last step, and the wrap is the safety net');
});

test('the quick launch is never hidden while any of the brand still shows', () => {
  for (let row = 300; row <= 1300; row += 1) {
    const r = decideTopbarFit({ ...BAR, row });
    if (!r.quickLaunch) assert.equal(r.brand, 'none', `at ${row}px the quick launch went before the logo`);
  }
});

test('without a quick launch (a phone, or before it mounts) the logo can still go, and the gap is not charged', () => {
  const phone = { ...BAR, quickLaunch: 0 };
  assert.deepEqual(decideTopbarFit({ ...phone, row: 92 + 18 + 460 + 1 }), { brand: 'full', quickLaunch: true });
  assert.deepEqual(decideTopbarFit({ ...phone, row: 460 + 1 }), { brand: 'none', quickLaunch: true }, 'no quick launch width, so no quick launch gap');
});

test('a brand with no word (the phone rule hid it) skips straight from the icon', () => {
  const r = decideTopbarFit({ ...BAR, brandFull: 36, row: need(36, true) });
  assert.equal(r.brand, 'full', 'full and icon-only are the same width here, so nothing is dropped early');
});

test('hovering the quick launch cannot flip the logo: its width counts the settings button as open, at every frame', () => {
  // Folded: the wrapper is 0 wide with a -4px margin; open: 43px with none. The pill grows by 47px as it unfolds.
  const openWidth = 43;
  const folded = reservedQuickLaunchWidth(247, { width: 0, marginRight: -4, openWidth });
  const half = reservedQuickLaunchWidth(270.5, { width: 21.5, marginRight: -2, openWidth });
  const open = reservedQuickLaunchWidth(294, { width: 43, marginRight: 0, openWidth });
  assert.equal(folded, 294);
  assert.equal(half, 294);
  assert.equal(open, 294);
  assert.equal(reservedQuickLaunchWidth(0, { width: 0, marginRight: -4, openWidth }), 0, 'a hidden quick launch reserves nothing');
  assert.equal(reservedQuickLaunchWidth(120, null), 120);
});

test('every extension page runs the check, right after the shell builds its top row', () => {
  const shell = read('extension/src/shell.mjs');
  assert.match(shell, /import \{ watchTopbarFit \} from '\.\/topbar-fit\.mjs';/);
  assert.match(shell, /topbar\.insertAdjacentHTML\('afterbegin', brandHtml\(\)\);\n\s+topbar\.insertAdjacentHTML\('beforeend', controlsHtml\(\{ compose \}\)\);\n(?:\s+\/\/.*\n)+\s+watchTopbarFit\(topbar\);/);
});

test('the hidden states keep their width (visibility, not display:none) and stay inside the top bar', () => {
  const css = read('extension/shell.css');
  const rule = css.match(/\[data-topbar\]\[data-fit-brand="mark"\] \.nt-brand-tx,\n\[data-topbar\]\[data-fit-brand="none"\] \.nt-brand,\n\[data-topbar\]\[data-fit-ql="off"\] \.nt-apps\.show \{([^}]*)\}/);
  assert.ok(rule, 'one rule covers the word, the whole logo and the quick launch');
  assert.match(rule[1], /position: absolute; top: 0; left: 0; visibility: hidden; pointer-events: none;/);
  assert.doesNotMatch(rule[1], /display/, 'display:none would leave nothing to measure, and the bar would flicker');
  assert.match(css, /\[data-topbar\] \{ position: relative; \}/, 'a hidden item is anchored in the bar, so it cannot widen the page');
  // The phone rule is unchanged: the word and the quick launch are gone at 620px whatever the measurement says.
  assert.match(css, /@media \(max-width: 620px\) \{\n  \.nt-norail \[data-topbar\] \.nt-brand-tx \{ display: none; \}\n[^}]*\n  \.nt-norail \.nt-apps, \.nt-norail \.nt-apps\.show \{ display: none; \}\n\}/);
});
