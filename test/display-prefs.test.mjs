// SOW-070: the display-preference helpers (layout Flat/Glass + theme Light/Dark/System). Pure + injectable DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLayout, normalizeTheme, resolveTheme, applyLayout, applyTheme, currentLayout, currentTheme, LAYOUT_KEY, THEME_KEY, normalizeGlass, glassStrength, applyGlass, currentGlass, GLASS_KEY, normalizeGlow, glowStrength, applyGlow, currentGlow, GLOW_KEY } from '../client-ui/src/display-prefs.mjs';

function fakeDom() {
  const attrs = {};
  const styles = {};
  const store = new Map();
  return {
    doc: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] ?? null, style: { setProperty: (k, v) => { styles[k] = v; } } } },
    storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    attrs, store, styles,
  };
}

test('normalizeLayout / normalizeTheme default to flat / system', () => {
  assert.equal(normalizeLayout('glass'), 'glass');
  assert.equal(normalizeLayout(null), 'flat');
  assert.equal(normalizeLayout('weird'), 'flat');
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme(null), 'system');
});

test('resolveTheme: system follows the OS preference; explicit wins', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('applyLayout persists + sets data-layout', () => {
  const { doc, storage, attrs, store } = fakeDom();
  assert.equal(applyLayout('glass', { doc, storage }), 'glass');
  assert.equal(attrs['data-layout'], 'glass');
  assert.equal(store.get(LAYOUT_KEY), 'glass');
  applyLayout('flat', { doc, storage });
  assert.equal(attrs['data-layout'], 'flat');
});

test('applyTheme: explicit stores + paints; system REMOVES the key + paints the OS pref', () => {
  const { doc, storage, attrs, store } = fakeDom();
  applyTheme('dark', { doc, storage, prefersDark: false });
  assert.equal(store.get(THEME_KEY), 'dark');
  assert.equal(attrs['data-theme'], 'dark');
  applyTheme('system', { doc, storage, prefersDark: true });
  assert.equal(store.has(THEME_KEY), false); // system follows the OS -> no stored key
  assert.equal(attrs['data-theme'], 'dark'); // resolved from prefersDark
});

test('currentLayout / currentTheme read stored values (default flat / system)', () => {
  const { storage, store } = fakeDom();
  assert.equal(currentLayout({ storage }), 'flat');
  assert.equal(currentTheme({ storage }), 'system');
  store.set(LAYOUT_KEY, 'glass'); store.set(THEME_KEY, 'light');
  assert.equal(currentLayout({ storage }), 'glass');
  assert.equal(currentTheme({ storage }), 'light');
});

test('normalizeGlass clamps to 0..100 and defaults to 50', () => {
  assert.equal(normalizeGlass(70), 70);
  assert.equal(normalizeGlass('30'), 30);
  assert.equal(normalizeGlass(null), 50);
  assert.equal(normalizeGlass('weird'), 50);
  assert.equal(normalizeGlass(-20), 0);
  assert.equal(normalizeGlass(180), 100);
});

test('glassStrength: 50% -> 1.0 (the built-in look); scales linearly', () => {
  assert.equal(glassStrength(50), 1);
  assert.equal(glassStrength(100), 2);
  assert.equal(glassStrength(0), 0);
  assert.equal(glassStrength(25), 0.5);
});

test('applyGlass persists the percent + sets --glass-strength; currentGlass reads it back (default 50)', () => {
  const { doc, storage, store, styles } = fakeDom();
  assert.equal(applyGlass(80, { doc, storage }), 80);
  assert.equal(store.get(GLASS_KEY), '80');
  assert.equal(styles['--glass-strength'], '1.6'); // 80 / 50
  assert.equal(currentGlass({ storage }), 80);
  assert.equal(currentGlass({ storage: fakeDom().storage }), 50); // unset -> default
});

test('applyGlow persists + sets --glass-glow; currentGlow reads it back (default 50)', () => {
  const { doc, storage, store, styles } = fakeDom();
  assert.equal(normalizeGlow(null), 50);
  assert.equal(glowStrength(50), 1); // 50% = the built-in look
  assert.equal(glowStrength(100), 2);
  assert.equal(applyGlow(20, { doc, storage }), 20);
  assert.equal(store.get(GLOW_KEY), '20');
  assert.equal(styles['--glass-glow'], '0.4'); // 20 / 50
  assert.equal(currentGlow({ storage }), 20);
  assert.equal(currentGlow({ storage: fakeDom().storage }), 50); // unset -> default
});
