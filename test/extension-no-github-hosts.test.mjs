// sow-410 (owner, 2026-09-25): "do we need github anymore? not sure we need a fallback". The extension stopped asking
// for github.com and api.github.com. github.com served only the "Use a code instead" device sign-in, which is gone;
// GitHub's API answers any site, so the extension reads it without a permission. These tests keep both from coming
// back quietly, in the source AND in the bundle the store receives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const srcFiles = readdirSync(new URL('../extension/src/', import.meta.url)).filter((f) => f.endsWith('.mjs'));
const distFiles = readdirSync(new URL('../extension/dist/', import.meta.url)).filter((f) => f.endsWith('.js'));

test('the manifest asks for no GitHub site', () => {
  const m = JSON.parse(read('extension/manifest.json'));
  assert.deepEqual(m.host_permissions, ['https://gbti.network/*', 'https://signup.gbti.network/*']);
  for (const host of [...m.host_permissions, ...(m.content_scripts || []).flatMap((c) => c.matches)]) {
    assert.doesNotMatch(host, /github/i, `${host} is a GitHub site`);
  }
});

test('no extension source can start a code sign-in', () => {
  assert.ok(srcFiles.length > 10, 'read the extension sources');
  for (const f of srcFiles) {
    const s = read(`extension/src/${f}`);
    assert.doesNotMatch(s, /auth-device\.mjs|deviceFlowLogin|login-prompt/, `${f} still wires the device sign-in`);
    // Every login message the extension sends is the website sign-in.
    for (const m of s.matchAll(/sendMessage\(\{ type: 'login'[^}]*\}/g)) {
      assert.match(m[0], /method: 'web'/, `${f} sends a login message that is not the website sign-in: ${m[0]}`);
    }
  }
});

test('the background refuses any sign-in but the website one, before it runs anything', () => {
  const BG = read('extension/src/background.mjs');
  const branch = BG.slice(BG.indexOf("} else if (msg?.type === 'login') {"), BG.indexOf("} else if (msg?.type === 'signout') {"));
  assert.ok(branch.length > 0, 'found the login branch');
  const refuse = branch.indexOf("if (msg.method !== 'web') { sendResponse({ ok: false, error: 'unsupported' }); return; }");
  assert.ok(refuse > 0 && refuse < branch.indexOf('handleWebLogin('), 'the refusal comes first');
});

test('the bundle the store receives carries no device sign-in and no code option', () => {
  assert.ok(distFiles.length >= 5, 'read the built extension');
  for (const f of distFiles) {
    const s = read(`extension/dist/${f}`);
    assert.ok(!s.includes('login/device/code'), `${f} bundles the device sign-in`);
    assert.ok(!s.includes('Use a code instead'), `${f} still offers the code`);
  }
});

test('the public extension page no longer says GBTI never sees the token', () => {
  const page = read('src/pages/extension/index.astro');
  assert.doesNotMatch(page, /never see or store your token|stays on your machine/);
  assert.match(page, /sends it only to GBTI's own service, which uses it to confirm who you are/);
});

test('the agent server and the command line keep their code sign-in: they have no browser', () => {
  assert.match(read('client/src/cli.mjs'), /import \{ deviceFlowLogin \} from '\.\/auth-device\.mjs';/);
  assert.match(read('client/src/mcp-auth.mjs'), /import \{ requestDeviceCode, pollForToken \} from '\.\/auth-device\.mjs';/);
});
