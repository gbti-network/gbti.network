// The npm host's served page (SOW-006 v2). Replaces the old inline ui.mjs: it inlines the bundled
// @gbti/client-ui (built by client-ui/build.mjs) and boots it against the local /api with the per-install
// token. Same security model as before: ONE token-gated page (the token arrives via ?token= on the first
// nav, then every /api fetch carries it as a Bearer header), so the "never an unauthenticated request"
// hardening is unchanged. The page mounts <gbti-app> (the full CMS). The UI code carries no secrets; the
// token (and thus every action) stays gated by the server.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLE_PATH = path.resolve(fileURLToPath(import.meta.url), '../../../client-ui/dist/gbti-ui.js');

/** Read the built UI bundle (null if it has not been built yet). */
export function loadBundle() {
  try {
    return fs.readFileSync(BUNDLE_PATH, 'utf8');
  } catch {
    return null;
  }
}

const MISSING = `<!doctype html><meta charset="utf-8" />
<body style="margin:0;background:#25232b;color:#e8e6ee;font:15px/1.5 system-ui,sans-serif;padding:24px">
  <h1 style="color:#45c08d">GBTI local CMS</h1>
  <p>The UI bundle is not built. Run <code>node client-ui/build.mjs</code>, then reload.</p>
</body>`;

/** The served HTML for the local CMS. Inlines the bundle + a tiny bootstrap (token from ?token=, mount app). */
export function shellHtml() {
  const bundle = loadBundle();
  if (!bundle) return MISSING;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GBTI Network — local CMS</title>
<style>html,body{margin:0;background:#25232b;color:#e8e6ee;font:15px/1.5 "Open Sans",system-ui,sans-serif}main{padding:22px}</style>
</head><body>
<main id="app">Loading…</main>
<script>${bundle}</script>
<script>
(function () {
  try {
    var p = new URLSearchParams(location.search);
    var token = p.get('token') || sessionStorage.getItem('gbti_token') || '';
    if (p.get('token')) { sessionStorage.setItem('gbti_token', token); history.replaceState(null, '', location.pathname); }
    var client = GbtiUI.createHttpClient({ token: token });
    GbtiUI.setClient(client);
    GbtiUI.mountApp(document.getElementById('app'));
  } catch (e) {
    document.getElementById('app').textContent = 'Failed to start the CMS: ' + (e && e.message);
  }
})();
</script>
</body></html>`;
}
