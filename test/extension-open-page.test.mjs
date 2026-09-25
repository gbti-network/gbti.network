// SOW-036: the open-page allowlist + hash validator. The avatar menu (site header relay + new-tab dropdown) asks
// the background to open one of a FIXED set of in-extension pages; the background is the authoritative boundary,
// so this resolver must reject anything not on the allowlist and any unsafe hash. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenPage, OPENABLE_PAGES } from '../extension/src/open-page.mjs';

test('an allowlisted page with no hash resolves to the bare page', () => {
  assert.equal(resolveOpenPage({ page: 'saved.html' }), 'saved.html');
  assert.equal(resolveOpenPage({ page: 'admin.html', hash: '' }), 'admin.html');
});

// sow-406: the WorkBench page left the extension; these used workspace.html and now use the pages that remain.
test('an allowlisted page with a safe hash resolves to page#hash (leading # optional)', () => {
  assert.equal(resolveOpenPage({ page: 'saved.html', hash: 'collections' }), 'saved.html#collections');
  assert.equal(resolveOpenPage({ page: 'saved.html', hash: '#favorites' }), 'saved.html#favorites');
  assert.equal(
    resolveOpenPage({ page: 'newtab.html', hash: 'type=post&read=members%2Falice%2Fposts%2Fx' }),
    'newtab.html#type=post&read=members%2Falice%2Fposts%2Fx',
  );
});

test('sow-406: the WorkBench page is not openable', () => {
  assert.equal(OPENABLE_PAGES.has('workspace.html'), false);
  assert.equal(resolveOpenPage({ page: 'workspace.html', hash: 'tab=prs' }), null);
});

test('every menu destination is on the allowlist', () => {
  for (const p of ['saved.html', 'shares.html', 'admin.html', 'account.html']) {
    assert.ok(OPENABLE_PAGES.has(p), `${p} should be openable`);
    assert.equal(resolveOpenPage({ page: p }), p);
  }
});

test('sow-387: the retired toolbar sign-in page is no longer openable', () => {
  assert.equal(OPENABLE_PAGES.has('onboarding.html'), false);
  assert.equal(resolveOpenPage({ page: 'onboarding.html' }), null);
});

test('a page NOT on the allowlist is rejected (no arbitrary navigation)', () => {
  for (const page of ['../background.js', 'manifest.json', 'evil.html', 'https://evil.example/', 'dist/content.js', '', null, undefined, 42, {}]) {
    assert.equal(resolveOpenPage({ page }), null, `${JSON.stringify(page)} must be rejected`);
  }
  assert.equal(resolveOpenPage(), null);
});

test('an unsafe hash is rejected (no smuggling past chrome.runtime.getURL)', () => {
  for (const hash of ['tab=post path', 'a"b', "a'b", 'a/b', 'a\\b', '#javascript:alert(1)', 'a<b', 'x'.repeat(301)]) {
    assert.equal(resolveOpenPage({ page: 'saved.html', hash }), null, `hash ${JSON.stringify(hash)} must be rejected`);
  }
  // Control (sow-406): the page itself is openable, so the rejections above are the HASH's. With workspace.html gone
  // from the allowlist this loop would have passed on the page alone.
  assert.equal(resolveOpenPage({ page: 'saved.html', hash: 'favorites' }), 'saved.html#favorites');
});

// SOW-112 QA: the site's locked-content notices deep-link a paid member into the reader.
test('browse.html (retired) aliases to newtab.html via the relay (reader deep link keeps working)', () => {
  const r = resolveOpenPage({ page: 'browse.html', hash: 'tab=prompt&read=members%2Falice%2Fprompts%2Fx%2Findex.md' });
  assert.equal(r, 'newtab.html#tab=prompt&read=members%2Falice%2Fprompts%2Fx%2Findex.md');
});

// SOW-143: the member-detail deep link must survive the relay (guards a future HASH_RE tightening from silently
// killing the follow relay). A kebab username uses only chars already in HASH_RE.
test('newtab.html member-detail deep link resolves through the relay', () => {
  assert.equal(
    resolveOpenPage({ page: 'newtab.html', hash: 'tab=member&member=alice' }),
    'newtab.html#tab=member&member=alice',
  );
  assert.equal(
    resolveOpenPage({ page: 'newtab.html', hash: 'tab=member&member=atwell-pub' }),
    'newtab.html#tab=member&member=atwell-pub',
  );
});
