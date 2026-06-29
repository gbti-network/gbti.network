// SOW-070: the two device-display preferences -- LAYOUT (Flat | Glass) and THEME (Light | Dark | System) -- persisted
// in localStorage and applied as data-layout / data-theme on the document root, where tokens.mjs reads them via
// :host-context. Flat + System are the defaults (opt-in, reversible). The pure normalizers/resolver are node-tested;
// the apply/current wrappers take injectable doc/storage/prefersDark so they test without a real DOM. The no-flash
// boot (extension/src/theme-init.mjs) mirrors the SAME keys + the same System->OS-pref resolution.

export const LAYOUT_KEY = 'gbti-layout';
export const THEME_KEY = 'gbti-theme';

/** A stored layout value -> 'flat' | 'glass' (default flat). */
export function normalizeLayout(v) { return v === 'glass' ? 'glass' : 'flat'; }

/** A stored theme value -> 'light' | 'dark' | 'system' (default system; a missing key = System). */
export function normalizeTheme(v) { return (v === 'light' || v === 'dark') ? v : 'system'; }

/** The CONCRETE theme to paint: 'system' resolves to the OS preference. */
export function resolveTheme(theme, prefersDark) {
  const t = normalizeTheme(theme);
  return t === 'system' ? (prefersDark ? 'dark' : 'light') : t;
}

const osPrefersDark = () => { try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } };

/** Persist + apply the layout to the document root. Returns the normalized value. */
export function applyLayout(layout, { doc = (typeof document !== 'undefined' ? document : null), storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  const l = normalizeLayout(layout);
  try { storage?.setItem(LAYOUT_KEY, l); } catch { /* private mode */ }
  doc?.documentElement?.setAttribute('data-layout', l);
  return l;
}

/** Persist + apply the theme. 'system' REMOVES the stored key (so it follows the OS) and paints the resolved value;
 *  this is the SAME key the header quick-toggle writes, so the two never disagree. Returns the normalized value. */
export function applyTheme(theme, { doc = (typeof document !== 'undefined' ? document : null), storage = (typeof localStorage !== 'undefined' ? localStorage : null), prefersDark = osPrefersDark() } = {}) {
  const t = normalizeTheme(theme);
  try { if (t === 'system') storage?.removeItem(THEME_KEY); else storage?.setItem(THEME_KEY, t); } catch { /* private mode */ }
  doc?.documentElement?.setAttribute('data-theme', resolveTheme(t, prefersDark));
  return t;
}

export function currentLayout({ storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  try { return normalizeLayout(storage?.getItem(LAYOUT_KEY)); } catch { return 'flat'; }
}

export function currentTheme({ storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  try { return normalizeTheme(storage?.getItem(THEME_KEY)); } catch { return 'system'; }
}

// SOW-070: GLASS INTENSITY -- only meaningful when layout is Glass. Stored as an integer percent 0..100 (default 50);
// the CSS multiplies every glass surface alpha by var(--glass-strength), where strength = percent / 50, so 50% keeps
// the built-in look (strength 1.0), 100% nears fully opaque, and lower is more see-through. Applied as an inline
// --glass-strength on the document root; the no-flash boot (theme-init.mjs) mirrors the same gbti-glass key.
export const GLASS_KEY = 'gbti-glass';

/** A stored glass value -> an integer percent 0..100 (default 50). */
export function normalizeGlass(v) { if (v == null || v === '') return 50; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50; }

/** The CSS multiplier for a glass percent: 50% -> 1.0 (the built-in look). */
export function glassStrength(pct) { return normalizeGlass(pct) / 50; }

/** Persist + apply the glass intensity (an inline --glass-strength on the root). Returns the normalized percent. */
export function applyGlass(pct, { doc = (typeof document !== 'undefined' ? document : null), storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  const p = normalizeGlass(pct);
  try { storage?.setItem(GLASS_KEY, String(p)); } catch { /* private mode */ }
  doc?.documentElement?.style?.setProperty('--glass-strength', String(glassStrength(p)));
  return p;
}

export function currentGlass({ storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  try { return normalizeGlass(storage?.getItem(GLASS_KEY)); } catch { return 50; }
}

// SOW-070: COLOR HIGHLIGHT INTENSITY -- only meaningful when layout is Glass. Scales the four ambient backdrop
// "spotlight" colors (green/blue/gold/purple). Stored as an integer percent 0..100 (default 50); the CSS multiplies
// each spotlight alpha by var(--glass-glow), where glow = percent / 50, so 50% keeps the built-in look (1.0), 0% turns
// the colors off, and higher is more vivid. Mirrors the gbti-glass-glow key in the no-flash boot (theme-init.mjs).
export const GLOW_KEY = 'gbti-glass-glow';

/** A stored glow value -> an integer percent 0..100 (default 50). */
export function normalizeGlow(v) { if (v == null || v === '') return 50; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50; }

/** The CSS multiplier for a glow percent: 50% -> 1.0 (the built-in look). */
export function glowStrength(pct) { return normalizeGlow(pct) / 50; }

/** Persist + apply the color-highlight intensity (an inline --glass-glow on the root). Returns the normalized percent. */
export function applyGlow(pct, { doc = (typeof document !== 'undefined' ? document : null), storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  const p = normalizeGlow(pct);
  try { storage?.setItem(GLOW_KEY, String(p)); } catch { /* private mode */ }
  doc?.documentElement?.style?.setProperty('--glass-glow', String(glowStrength(p)));
  return p;
}

export function currentGlow({ storage = (typeof localStorage !== 'undefined' ? localStorage : null) } = {}) {
  try { return normalizeGlow(storage?.getItem(GLOW_KEY)); } catch { return 50; }
}
