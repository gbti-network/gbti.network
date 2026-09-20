// sow-270 Phase 5: the one shell every Worker-served mail page renders into.
//
// mail-subscribe.mjs and membership-unsubscribe.mjs each carried their own copy of this helper, feeding fifteen
// call sites. The copies were BYTE IDENTICAL at the moment of extraction, which is exactly why it was worth
// doing: two copies that agree today disagree after the next edit to one of them, and nothing reports it. These
// are the pages a subscriber lands on after clicking a link in an email, so a subscribe confirmation quietly
// diverging from an unsubscribe confirmation is a trust problem, not a tidiness one.
//
// The extraction itself was proven by rendering a corpus through the old helper and the new module and diffing
// the results, headers and status included. These tests hold the properties going forward.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageHtml, pageResponse, PAGE_HEADERS, escapePage } from '../workers/signup/mail-pages.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CONSUMERS = ['../workers/signup/mail-subscribe.mjs', '../workers/signup/membership-unsubscribe.mjs'];

test('the shell carries the two headers the links depend on', () => {
  const r = pageResponse('Unsubscribed', '<h1>Done</h1>');
  // These pages are keyed by a one-time token in the address. Caching one serves another person their page,
  // and a referer would hand the token to whatever the page links to.
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(PAGE_HEADERS['Cache-Control'], 'no-store');
  // And in the document too, for a client that ignores the header.
  assert.match(pageHtml('t', ''), /<meta name="referrer" content="no-referrer">/);
});

test('the title is escaped and the body is not, which is what the call sites rely on', () => {
  const html = pageHtml('<script>alert(1)</script>', '<h1>Real markup</h1><p class="muted">stays</p>');
  assert.doesNotMatch(html.slice(0, html.indexOf('</head>')), /<script>alert/, 'a title must never become markup');
  assert.match(html, /&lt;script&gt;/);
  assert.ok(html.includes('<h1>Real markup</h1><p class="muted">stays</p>'), 'the body is trusted markup built by the caller');
});

test('the status passes through, because these pages report failures as well as successes', () => {
  assert.equal(pageResponse('t', '', 410).status, 410);
  assert.equal(pageResponse('t', '').status, 200, 'and defaults to 200');
});

test('escapePage covers every character that could break out', () => {
  assert.equal(escapePage(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapePage(null), '', 'a missing value renders as nothing, not as "null"');
  assert.equal(escapePage(undefined), '');
  assert.equal(escapePage(42), '42');
});

test('neither consumer has grown its own copy of the shell back', () => {
  for (const rel of CONSUMERS) {
    const src = read(rel);
    assert.doesNotMatch(src, /^function page\(/m, `${rel} defines its own page() again`);
    assert.doesNotMatch(src, /^const PAGE_HEADERS = \{/m, `${rel} defines its own PAGE_HEADERS again`);
    assert.doesNotMatch(src, /^function escapeHtml\(/m, `${rel} defines its own escaper again`);
    assert.match(src, /from '\.\/mail-pages\.mjs'/, `${rel} must render through the shared shell`);
  }
});

test('all fifteen call sites survived the extraction', () => {
  // Counted before the change and pinned here. A drop means a page stopped rendering, which is the one way this
  // refactor could have broken something without a test noticing.
  //
  // The subscribe side reads 7 rather than the original 9 because sow-270 Phases 6 and 7 moved its two ENDINGS
  // (the confirm page and the full stop after it) onto panelResponse, which is counted separately below. The
  // total number of pages is unchanged; two of them simply render into the tinted panel instead of the plain
  // shell. That count is asserted too, so moving a page to the panel cannot quietly delete it.
  const counts = CONSUMERS.map((rel) => (read(rel).match(/(?<![\w.])page\(/g) || []).length);
  assert.deepEqual(counts, [7, 6], `expected 7 and 6 page() calls, found ${counts.join(' and ')}`);
  const panels = (read(CONSUMERS[0]).match(/panelResponse\(/g) || []).length;
  assert.equal(panels, 2, 'the confirm page and the page after it both render into the panel');
});

test('the shell stays node-free, because it runs in a Worker', () => {
  const src = read('../workers/signup/mail-pages.mjs');
  assert.doesNotMatch(src, /^import /m, 'no imports at all: a Worker cannot reach the site assets or a build step');
  assert.doesNotMatch(src, /require\(|node:/, 'and nothing from node');
});
