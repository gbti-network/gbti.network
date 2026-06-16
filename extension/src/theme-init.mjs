// No-flash theme init for every extension page. Sets data-theme before first paint from the persisted
// choice or the OS preference. This lives in its own bundled file (loaded with <script src> in <head>)
// because the MV3 extension_pages CSP is `script-src 'self'` — inline <script> blocks are blocked, and
// extension_pages does not allow 'unsafe-inline' or hashes. A synchronous external script in <head> still
// runs before paint, so there is no theme flash.
(function () {
  try {
    var t = localStorage.getItem('gbti-theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
