// SOW-036: the open-page allowlist + hash validator. The avatar menu (site header relay + new-tab dropdown) asks
// the background to open one of a FIXED set of in-extension pages; the background is the authoritative boundary,
// so this resolver must reject anything not on the allowlist and any unsafe hash. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenPage, OPENABLE_PAGES } from '../extension/src/open-page.mjs';

test('an allowlisted page with no hash resolves to the bare page', () => {
  assert.equal(resolveOpenPage({ page: 'workspace.html' }), 'workspace.html');
  assert.equal(resolveOpenPage({ page: 'admin.html', hash: '' }), 'admin.html');
});

test('an allowlisted page with a safe hash resolves to page#hash (leading # optional)', () => {
  assert.equal(resolveOpenPage({ page: 'workspace.html', hash: 'tab=prompt' }), 'workspace.html#tab=prompt');
  assert.equal(resolveOpenPage({ page: 'workspace.html', hash: '#tab=post' }), 'workspace.html#tab=post');
  assert.equal(
    resolveOpenPage({ page: 'browse.html', hash: 'tab=post&read=members%2Falice%2Fposts%2Fx' }),
    'browse.html#tab=post&read=members%2Falice%2Fposts%2Fx',
  );
});

test('every menu destination is on the allowlist', () => {
  for (const p of ['workspace.html', 'browse.html', 'shares.html', 'admin.html', 'account.html', 'onboarding.html']) {
    assert.ok(OPENABLE_PAGES.has(p), `${p} should be openable`);
    assert.equal(resolveOpenPage({ page: p }), p);
  }
});

test('a page NOT on the allowlist is rejected (no arbitrary navigation)', () => {
  for (const page of ['../background.js', 'manifest.json', 'evil.html', 'https://evil.example/', 'dist/content.js', '', null, undefined, 42, {}]) {
    assert.equal(resolveOpenPage({ page }), null, `${JSON.stringify(page)} must be rejected`);
  }
  assert.equal(resolveOpenPage(), null);
});

test('an unsafe hash is rejected (no smuggling past chrome.runtime.getURL)', () => {
  for (const hash of ['tab=post path', 'a"b', "a'b", 'a/b', 'a\\b', '#javascript:alert(1)', 'a<b', 'x'.repeat(301)]) {
    assert.equal(resolveOpenPage({ page: 'workspace.html', hash }), null, `hash ${JSON.stringify(hash)} must be rejected`);
  }
});
