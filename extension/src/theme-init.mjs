// No-flash theme init for every extension page. Sets data-theme before first paint from the persisted
// choice or the OS preference. This lives in its own bundled file (loaded with <script src> in <head>)
// because the MV3 extension_pages CSP is `script-src 'self'` — inline <script> blocks are blocked, and
// extension_pages does not allow 'unsafe-inline' or hashes. A synchronous external script in <head> still
// runs before paint, so there is no theme flash.
(function () {
  try {
    // SOW-070: DEFAULT theme is Dark (a missing/legacy key). 'system' is an explicit stored choice that follows the OS.
    var t = localStorage.getItem('gbti-theme');
    if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    else if (t !== 'light' && t !== 'dark') t = 'dark';
    document.documentElement.setAttribute('data-theme', t);
    // SOW-070: DEFAULT layout is Glass (only an explicit 'flat' opts out), applied before paint so it never flashes.
    // Mirrors the gbti-layout key in client-ui/src/display-prefs.mjs.
    var l = localStorage.getItem('gbti-layout');
    document.documentElement.setAttribute('data-layout', l === 'flat' ? 'flat' : 'glass');
    // SOW-070: surface opacity (gbti-glass, percent 0..100). The CSS scales every glass surface alpha by
    // --glass-strength (strength = percent / 50). Only set when stored; otherwise the CSS fallback (1.7 = the 85%
    // default) holds. Flat is unaffected (the tokens only apply under data-layout="glass").
    var g = localStorage.getItem('gbti-glass');
    if (g != null) { var gp = Math.round(Number(g)); if (gp === gp) document.documentElement.style.setProperty('--glass-strength', String(Math.max(0, Math.min(100, gp)) / 50)); }
    // SOW-070: color highlight intensity (gbti-glass-glow) -> --glass-glow (glow = percent / 50; 50% = the built-in look).
    var gw = localStorage.getItem('gbti-glass-glow');
    if (gw != null) { var gwp = Math.round(Number(gw)); if (gwp === gwp) document.documentElement.style.setProperty('--glass-glow', String(Math.max(0, Math.min(100, gwp)) / 50)); }
  } catch (e) {}
})();
