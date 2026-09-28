// Owner, 2026-09-28: "we need to make sure our collection buttons have proper contrast on light and dark mode across
// all surfaces they are used on, both the public website as well as the extension." A browser audit (light, dark,
// and the extension's glass layout) found every failure in the SHARED components the signed-in website and the
// extension both render; the website's own signed-out pills already passed. What it found, and what this pins:
//   - white text on a brand-green fill measures 3.4:1, under AA for 12.5 to 13px text (the popover's Create button);
//   - the same white on the dark-mode --accent mint measured 1.9:1 (the Saved page's selected chip and Create);
//   - BASE_CSS's `button:hover { background: var(--brand-dark) }` outranks a single class, so any button whose hover
//     rule names no background turns green on hover (the Saved page's chips: 3.6:1 light, 2.1:1 dark);
//   - a grey hover fill took the red Delete link to 4.0:1 in dark mode.
// A filled control now uses --accent with --on-accent, and every button names its own hover background.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TOKENS = read('client-ui/src/tokens.mjs');
const FILES = ['gbti-collection', 'gbti-favorite', 'gbti-saved'].map((n) => [n, read(`client-ui/src/elements/${n}.mjs`)]);

const lum = (hex) => {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// The two theme blocks of TOKENS: `:host {` (light) and `:host-context([data-theme="dark"]) {` (dark).
function block(start) {
  const i = TOKENS.indexOf(start);
  assert.ok(i >= 0, `tokens has ${start}`);
  return TOKENS.slice(i, TOKENS.indexOf('\n}', i));
}
const tok = (b, name) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(b)?.[1];

test('text on an --accent fill reaches AA in both themes', () => {
  for (const [theme, b] of [['light', block(':host {')], ['dark', block(':host-context([data-theme="dark"]) {')]]) {
    const accent = tok(b, 'accent'), on = tok(b, 'on-accent');
    assert.ok(accent && on, `${theme}: --accent and --on-accent are both defined`);
    assert.ok(ratio(accent, on) >= 4.5, `${theme}: ${on} on ${accent} is ${ratio(accent, on).toFixed(2)}:1, under 4.5`);
  }
});

for (const [name, src] of FILES) {
  test(`${name}: every button names its own hover background`, () => {
    const lists = [...src.matchAll(/<button\b[^>]*?class="([^"$]*)/g)].map((m) => m[1].split(/\s+/).filter(Boolean));
    assert.ok(lists.length > 0, 'buttons found');
    const hoverBg = (c) => new RegExp(`\\.${c}(?:[.:][\\w-]+)*:hover[^{]*\\{[^}]*background`).test(src);
    const bare = lists.filter((cls) => !cls.some(hoverBg)).map((cls) => cls.join('.'));
    assert.deepEqual(bare, [], `buttons whose hover inherits the base green: ${bare.join(', ')}`);
  });

  test(`${name}: nothing puts white text on a green fill`, () => {
    for (const [, sel, body] of src.matchAll(/([^{}\n]+)\{([^}]*)\}/g)) {
      if (!/background:\s*var\(--(accent|brand)\)/.test(body) || /:hover/.test(sel)) continue;
      assert.doesNotMatch(body, /color:\s*#fff/i, `${sel.trim()} puts white text on green`);
      if (/color:/.test(body.replace(/border-color|background-color/g, ''))) {
        assert.match(body, /color:\s*var\(--on-accent\)/, `${sel.trim()} fills with green, so its text is --on-accent`);
      }
    }
  });
}

test('the popover Create button keeps its fill on hover', () => {
  const src = FILES[0][1];
  assert.match(src, /\.new button:hover \{[^}]*background:var\(--accent\)/);
});

test('the Saved page text buttons underline on hover instead of a fill that dims red and green text', () => {
  const src = FILES[2][1];
  assert.match(src, /\.lk:hover \{ background:none; text-decoration:underline;/);
});
