// sow-244: the Chrome Web Store is the only public install (owner, 2026-08-16). Two things drifted before this: the
// install page kept offering "Download unpacked" and a Developer mode walkthrough, and latest.json carried an empty
// webStoreUrl because the packager hardcoded '' and no guard read the field. These tests pin both, and pin the one
// legitimate remaining use of the package zip: the MCP guide, which offers it for the MCP server inside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInstallSurfaces, checkExtension, NO_UNPACKED_PAGES, ZIP_ALLOWED_PAGE } from '../scripts/check-extension.mjs';
import { packageExtension } from '../extension/package.mjs';
import { WEB_STORE_URL } from '../src/lib/extension-store.mjs';

const zipLink = '<a class="btn" href="/extension/gbti-network-extension.zip" download>Download the extension package</a>';
const clean = () => ({
  'extension/index.html': '<h1>Install the GBTI extension</h1><a href="https://chromewebstore.google.com/detail/x">Add to Chrome</a><!-- the old unpacked walkthrough --><p>Building from source? See the README.</p>',
  [ZIP_ALLOWED_PAGE]: `<h2>Get the extension package</h2>${zipLink}`,
  'index.html': '<a href="/extension/">Get Extension</a>',
});

test('checkInstallSurfaces: a store-only install page and a zip link on the MCP guide pass', () => {
  assert.deepEqual(checkInstallSurfaces(clean()), []);
  assert.ok(NO_UNPACKED_PAGES.includes('extension/index.html'));
});

test('checkInstallSurfaces: each retired offer fails, by the rendered TEXT, not by the markup around it', () => {
  for (const offer of ['<h2>Load it as an unpacked extension</h2>', '<p>Flip the <b>Developer mode</b> toggle</p>', '<b>Load unpacked</b>', '<span class="kbd">chrome://extensions</span>', '<p>The unpacked ZIP is for developers</p>']) {
    const pages = clean();
    pages['extension/index.html'] += offer;
    const errors = checkInstallSurfaces(pages);
    assert.ok(errors.some((e) => /offers the retired unpacked install/.test(e)), `${offer}: ${JSON.stringify(errors)}`);
  }
  // A comment, a script or a style is not an offer a visitor reads.
  const pages = clean();
  pages['extension/index.html'] += '<script>const legacy = "Load unpacked";</script><style>.dev-mode{}</style>';
  assert.deepEqual(checkInstallSurfaces(pages), []);
});

test('checkInstallSurfaces: the zip may be linked only from the MCP guide, and missing pages are reported', () => {
  const linked = clean();
  linked['extension/index.html'] += zipLink;
  assert.match(checkInstallSurfaces(linked).join('\n'), /extension\/index\.html links the extension package zip/);
  const elsewhere = clean();
  elsewhere['handbook/index.html'] = zipLink;
  assert.match(checkInstallSurfaces(elsewhere).join('\n'), /handbook\/index\.html links the extension package zip/);
  const noInstall = clean();
  delete noInstall['extension/index.html'];
  assert.match(checkInstallSurfaces(noInstall).join('\n'), /extension\/index\.html was not built/);
  const noGuide = clean();
  delete noGuide[ZIP_ALLOWED_PAGE];
  assert.match(checkInstallSurfaces(noGuide).join('\n'), /workbench\/mcp\/index\.html was not built/);
});

test('latest.json carries the store listing: the packager writes the one shared URL, and an empty or stale one fails the check', () => {
  const out = packageExtension({ write: false });
  assert.equal(out.webStoreUrl, WEB_STORE_URL);
  assert.match(WEB_STORE_URL, /^https:\/\/chromewebstore\.google\.com\/detail\//);
  const manifest = { version: out.version, name: out.name };
  const base = { version: out.version, name: out.name, zip: '/extension/gbti-network-extension.zip', bytes: out.buf.length };
  const errorsFor = (webStoreUrl) => checkExtension({ manifest, latest: { ...base, webStoreUrl }, zipBuf: out.buf }).filter((e) => /webStoreUrl/.test(e));
  assert.deepEqual(errorsFor(WEB_STORE_URL), []);
  assert.equal(errorsFor('').length, 1, 'the empty value that sat there for two months');
  assert.equal(errorsFor('https://chromewebstore.google.com/detail/other').length, 1);
});
