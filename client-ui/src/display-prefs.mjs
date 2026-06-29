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
