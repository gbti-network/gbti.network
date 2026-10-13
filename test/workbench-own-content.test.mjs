// The WorkBench must not learn about a member's own work from a build artifact alone (sow-454).
//
// WHY THIS EXISTS. listContent in src/lib/workbench-client.ts listed a member's own content from the
// same-origin `/<type>-index.json`, which the site build writes, so nothing they published appeared until the
// site rebuilt two to three minutes later. An item created in the WorkBench has a KV draft record that shows
// at once and so seemed fine; an item published any other way (a claimed invitation, an agent, a direct
// commit) had no draft record and was simply absent. A member published his first project from an invitation
// on 2026-10-13, opened this screen, and was told he had no projects.
//
// These are SOURCE guards because the module is a browser adapter wired to cookies and a live Worker, and
// this repository has no DOM or Worker harness. What they pin is the pair of properties that can regress
// silently: the Worker read happens, and it is wrapped so that a refusal leaves the index view standing
// rather than emptying the screen. The route's own behaviour is tested against injected deps in
// test/worker-membership-network.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const CLIENT = 'src/lib/workbench-client.ts';

test('listContent asks the Worker for the own-content read', () => {
  const src = read(CLIENT);
  const fn = src.slice(src.indexOf('async listContent('));
  const body = fn.slice(0, fn.indexOf('\n    },'));
  assert.match(body, /\/membership\/own-content\?type=/, 'the repository-backed read must be requested');
  assert.match(body, /encodeURIComponent/, 'the type goes into the query encoded');
  // The index read stays: it is the fallback, and it is what makes the failure mode safe.
  assert.match(body, /sameOriginJson/, 'the published index is still read');
});

test('a failed own-content read leaves the index view standing, never an empty screen', () => {
  const src = read(CLIENT);
  const fn = src.slice(src.indexOf('async listContent('));
  const body = fn.slice(0, fn.indexOf('\n    },'));
  const call = body.indexOf('/membership/own-content');
  const tryAt = body.lastIndexOf('try {', call);
  const catchAt = body.indexOf('catch', call);
  assert.ok(tryAt > 0 && tryAt < call, 'the Worker read must sit inside a try');
  assert.ok(catchAt > call, 'and must have a catch after it');
  // After the catch, the index items are still returned. Emptying the list on a failed call would recreate
  // the exact defect this replaced, with a different cause.
  const after = body.slice(catchAt);
  assert.match(after, /return \{ items: indexItems \}/, 'the fallback must return the index items');
  // And the Worker answer is only used when it is actually a list.
  assert.match(body, /Array\.isArray\(own\?\.items\)/, 'a malformed answer must not replace the list');
});

test('the Worker route is wired, uncached, and varies by credential', () => {
  const routes = read('workers/signup/member-routes.mjs');
  const i = routes.indexOf("pathname === '/membership/own-content'");
  assert.ok(i > 0, 'the route must be reachable');
  const block = routes.slice(i, i + 700);
  assert.match(block, /allowCookie: true/, 'the website WorkBench holds no bearer token');
  assert.match(block, /'Cache-Control': 'no-store'/, 'a stale answer is the whole defect');
  assert.match(block, /Vary: 'Authorization, Cookie'/, 'the answer is per-member and must never be shared');
  assert.match(block, /method === 'OPTIONS'/, 'credentialed CORS needs its preflight');
});
