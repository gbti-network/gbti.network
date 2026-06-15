// SOW-026: the extension bundle has no `process.env`, so the client auth-mode vars must be INLINED at build via
// esbuild `define` (extension/build.mjs). This pins that the flip actually works: with the define, app mode +
// the real App client id/slug are inlined and the placeholder is eliminated; without it, the bundle stays
// classic (placeholder present). Guards against a future build change that silently breaks `GBTI_AUTH_MODE=app`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExtensionDefine, readBuildConfig } from '../extension/build-config.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const ENTRY = path.join(ROOT, 'client/src/signup-base.mjs');
const PLACEHOLDER = 'Iv1.gbti-app-placeholder';
const REAL_CLIENT_ID = 'Iv23lis8jbx62zI7cwE8';
const REAL_SLUG = 'gbti-network-publisher';

async function bundleText(define = {}) {
  const r = await build({ entryPoints: [ENTRY], bundle: true, write: false, format: 'esm', target: 'es2022', platform: 'browser', define });
  return r.outputFiles[0].text;
}

// Mirrors the keys extension/build.mjs sets from the build env.
const appDefine = {
  'globalThis.process.env.GBTI_AUTH_MODE': JSON.stringify('app'),
  'globalThis.process.env.GBTI_GITHUB_APP_CLIENT_ID': JSON.stringify(REAL_CLIENT_ID),
  'globalThis.process.env.GBTI_GITHUB_APP_SLUG': JSON.stringify(REAL_SLUG),
};

test('classic build (no define): app-client placeholder stays, real App id absent', async () => {
  const txt = await bundleText({});
  assert.ok(txt.includes(PLACEHOLDER), 'classic bundle keeps the placeholder client id (env unset)');
  assert.ok(!txt.includes(REAL_CLIENT_ID), 'no real App client id leaks into a classic bundle');
});

test('app-mode define inlines the real App client id + slug and ELIMINATES the placeholder', async () => {
  const txt = await bundleText(appDefine);
  assert.ok(txt.includes(REAL_CLIENT_ID), 'the real App client id is inlined');
  assert.ok(txt.includes(REAL_SLUG), 'the real App slug is inlined');
  assert.ok(!txt.includes(PLACEHOLDER), 'the placeholder client id is constant-folded away in app mode');
});

// --- resolveExtensionDefine: the committed-config resolution that makes the bundle CI-reproducible ---

test('resolveExtensionDefine: classic when config + env are both empty (source default applies)', () => {
  const { define, mode } = resolveExtensionDefine({ config: {}, env: {} });
  assert.equal(mode, 'classic');
  assert.deepEqual(define, {}, 'no inlines -> the source classic defaults apply');
});

test('resolveExtensionDefine: committed config drives app mode WITHOUT any env (CI reproducibility)', () => {
  const { define, mode } = resolveExtensionDefine({ config: { authMode: 'app', appClientId: REAL_CLIENT_ID, appSlug: REAL_SLUG }, env: {} });
  assert.equal(mode, 'app');
  assert.equal(define['globalThis.process.env.GBTI_AUTH_MODE'], JSON.stringify('app'));
  assert.equal(define['globalThis.process.env.GBTI_GITHUB_APP_CLIENT_ID'], JSON.stringify(REAL_CLIENT_ID));
  assert.equal(define['globalThis.process.env.GBTI_GITHUB_APP_SLUG'], JSON.stringify(REAL_SLUG));
});

test('resolveExtensionDefine: a build-time env var overrides the committed config', () => {
  const { mode } = resolveExtensionDefine({ config: { authMode: 'app', appClientId: REAL_CLIENT_ID, appSlug: REAL_SLUG }, env: { GBTI_AUTH_MODE: 'classic' } });
  assert.equal(mode, 'classic', 'env GBTI_AUTH_MODE=classic overrides the app config');
});

test('resolveExtensionDefine: app mode without the client id/slug throws (no broken placeholder bundle)', () => {
  assert.throws(() => resolveExtensionDefine({ config: { authMode: 'app' }, env: {} }), /app mode requires/);
});

test('the COMMITTED extension/build-config.json selects app mode with the real App identifiers', () => {
  const cfg = readBuildConfig();
  assert.equal(cfg.authMode, 'app', 'the repo is flipped to app mode (build-config.json)');
  assert.equal(cfg.appClientId, REAL_CLIENT_ID);
  assert.equal(cfg.appSlug, REAL_SLUG);
});
