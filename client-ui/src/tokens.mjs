// Brand design tokens for the shared web components (SOW-006 v2 / SOW-010 V3). Mirrors the V3 design system
// (src/styles/gbti-v3.css: green #1f9e5f, Hanken Grotesk body + Baloo Da 2 display, light + dark via a
// [data-theme] attribute on an ancestor). The values are baked LITERALLY here, not pulled from the host's
// :root, so the components look like GBTI whether or not the host page loaded gbti-v3.css (the npm CMS page,
// the extension onboarding tab, an inert hook on the public site). Shadow DOM isolates them so host styles cannot bleed.
//
// Theme: a component reads the ancestor's data-theme via :host-context([data-theme="dark"]) (the V3 header sets
// data-theme on <html>; the extension content script + new-tab set it on documentElement). On the V3 site this
// flips the palette with the page toggle; a host without data-theme stays light. The legacy token NAMES kept by
// the components (--bg/--panel/--brand/--brand-dark/--accent/--text/--fg/--muted/--line/--hover/--danger/--radius
// + the two fonts) are mapped onto V3 values so every component re-skins without per-component edits.

export const TOKENS = `
:host {
  --bg: #faf9f8; --panel: #ffffff;
  --brand: #1f9e5f; --brand-dark: #178a51; --accent: #0f6f40;
  --text: #24222a; --fg: #24222a; --muted: #57545e;
  --line: #e7e4e0; --hover: #f1f1f1; --danger: #c0392b;
  --radius: 12px;
  --glass-blur: none; /* SOW-070: flat (default) = no frost; the glass layout layer below sets a real backdrop blur */
  --font-body: "Hanken Grotesk", system-ui, -apple-system, sans-serif;
  --font-display: "Baloo Da 2", "Hanken Grotesk", system-ui, sans-serif;
}
:host-context([data-theme="dark"]) {
  --bg: #1c1a21; --panel: #2d2a34;
  --brand: #1f9e5f; --brand-dark: #46c089; --accent: #5fd49a;
  --text: #f3f2f0; --fg: #f3f2f0; --muted: rgba(243,242,240,.72);
  --line: rgba(255,255,255,.12); --hover: #34313c; --danger: #e06c6c;
}
/* SOW-070: the GLASS layout skin (opt-in: data-layout="glass" on an ancestor). Re-points the surface tokens to
   translucent values + defines --glass-blur, so any surface class that reads backdrop-filter: var(--glass-blur)
   frosts; flat leaves --glass-blur: none (a no-op). Composes with data-theme (light + dark). Green + per-type accents
   are unchanged. Contrast: the panel alphas are kept >= .5 so --fg/--muted stay AA-legible over the ambient backdrop. */
:host-context([data-layout="glass"]) {
  --panel: rgba(255,255,255,.55); --line: rgba(255,255,255,.66); --hover: rgba(255,255,255,.4);
  --glass-blur: blur(20px) saturate(150%);
}
:host-context([data-layout="glass"][data-theme="dark"]) {
  --panel: rgba(18,26,21,.55); --line: rgba(255,255,255,.1); --hover: rgba(255,255,255,.08);
}
`;

export const BASE_CSS = `
:host { display: block; color: var(--text); font: 15px/1.5 var(--font-body); box-sizing: border-box; }
*, *::before, *::after { box-sizing: border-box; }
h1, h2, h3 { font-family: var(--font-display); margin: 0 0 .5em; }
h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
a { color: var(--accent); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
input, select, textarea {
  width: 100%; padding: 9px 11px; background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; color: var(--text); font: inherit;
}
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--brand); }
textarea { min-height: 120px; resize: vertical; font-family: ui-monospace, monospace; }
button {
  background: var(--brand); color: #08231a; border: 0; border-radius: 8px;
  padding: 9px 16px; font: inherit; font-weight: 600; cursor: pointer;
}
button:hover { background: var(--brand-dark); }
button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
button[disabled] { opacity: .5; cursor: default; }
.muted { color: var(--muted); }
.danger { color: var(--danger); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--hover); font-size: 12px; color: var(--muted); }
.tag.ok { background: rgba(31,158,95,.14); color: var(--accent); }
.tag.bad { background: rgba(224,108,108,.16); color: var(--danger); }
ul.list { list-style: none; margin: 0; padding: 0; }
ul.list li { padding: 8px 0; border-bottom: 1px solid var(--line); }
`;
