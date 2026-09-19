// sow-366: every CSS custom property the site reads is DEFINED somewhere in src/.
//
// WHY THIS EXISTS, and why a fallback is not a defence. The Add to calendar chooser wrote
// `background: var(--bg-1, #fff)` beside `color: var(--fg)`. `--bg-1` was never a token, so the card took the
// white fallback in BOTH themes, while `--fg` is real and flips to near-white on dark: white on white, and the
// dialog was unreadable in dark mode. It read perfectly in light, which is exactly how it shipped.
//
// So the rule is: a var() naming a token nothing defines is a defect whether or not it has a fallback. With a
// fallback it is frozen at one theme's value; without one the whole declaration is dropped at computed-value
// time (four such declarations were live when this was written: card backgrounds on /account, /admin, the
// membership tiers and the submit-content FAQ, all silently transparent).
//
// A token set inline (style="--ca: ...") counts as defined, since that is how the card components pass colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const EXT = new Set(['.astro', '.css', '.ts', '.mjs', '.js']);

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (EXT.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

test('sow-366: no stylesheet reads a custom property that nothing defines', () => {
  const files = sourceFiles(path.join(ROOT, 'src'));
  assert.ok(files.length > 100, `expected the real source tree (found ${files.length} files)`);
  const defined = new Set();
  const used = new Map();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
  }
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(path.relative(ROOT, f));
    }
  }
  assert.ok(used.size > 50, `expected the sweep to find real usages (found ${used.size})`);
  const unknown = [...used.entries()].filter(([token]) => !defined.has(token));
  assert.deepEqual(
    unknown.map(([token, where]) => `${token} (${[...where].sort().join(', ')})`),
    [],
    'every var(--token) must name a property defined in src/ (see src/styles/gbti-v3.css)',
  );
});

test('sow-366: a surface token that flips with the theme is defined in BOTH themes', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/gbti-v3.css'), 'utf8');
  const dark = css.slice(css.indexOf('[data-theme="dark"]'));
  assert.ok(dark.length > 500, 'found the dark block');
  // The tokens a card is built from. A card that keeps a light surface under dark text is the sow-366 defect.
  for (const token of ['--paper', '--paper-2', '--tint', '--fg', '--fg-mute', '--line', '--blue-700']) {
    assert.match(dark, new RegExp(`\\${token}\\s*:`), `${token} needs a dark value`);
  }
});
