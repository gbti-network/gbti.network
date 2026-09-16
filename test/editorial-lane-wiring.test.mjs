// sow-323 Phase 3: THE EDITORIAL REVIEW QUEUE IS WIRED ON EVERY HOST, and the retired application lane is gone
// from all of them.
//
// This replaces test/applications-lane-wiring.test.mjs, which pinned the same chain for the lane this one
// supersedes. The reason for a source-reading test has not changed: a transport hop is a one-line forward on
// each host, every hop is individually plausible, and a missing one produces a dead button rather than a
// failure anything reports. The functional tests cover the Worker; this covers the chain that reaches it.
//
// It also asserts the ABSENCE of the old lane, deliberately in the same file. A retirement that removes the
// Worker route but leaves a host still calling it is not a half-done retirement, it is a dead control on a
// live admin page, and the two halves belong in one check so neither can pass alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const ROUTE = '/membership/admin/editorial';
const HOST_ROUTE = '/api/editorial';

test('the Worker serves both verbs of the queue, superadmin only, and never caches them', () => {
  const idx = read('workers/signup/index.mjs');
  assert.ok(idx.includes(`pathname === '${ROUTE}'`), `index.mjs has no route for ${ROUTE}`);
  const block = idx.slice(idx.indexOf(`pathname === '${ROUTE}'`), idx.indexOf(`pathname === '${ROUTE}'`) + 1400);
  assert.match(block, /editorialList\(request, env/, 'the GET handler is not called');
  assert.match(block, /editorialDecide\(request, env/, 'the POST handler is not called');
  assert.match(block, /allowCookie: true/, 'the website admin page signs in by cookie, not by bearer token');
  assert.match(block, /credentials: true/, 'a cookie call needs credentialed CORS or the browser sends no cookie');
  assert.match(block, /'Cache-Control': 'no-store'/, 'a queue of unpublished member work must never be cached');

  const h = read('workers/signup/membership-editorial.mjs');
  assert.match(h, /authorizeSuperadmin/, 'the handlers must gate at superadmin');
  assert.ok(!/authorizeAdmin|authorizeStaff|authorizeMember/.test(h),
    'approving PUBLISHES an item to the open web, so nothing below superadmin may reach these handlers');
});

test('the shared UI client forwards both verbs to its host', () => {
  const src = read('client-ui/src/client.mjs');
  assert.match(src, /editorialQueue: \(\) => request\('GET', '\/api\/editorial'\)/, 'client.mjs: the read is missing');
  assert.match(src, /decideEditorial: .*request\('POST', '\/api\/editorial'/, 'client.mjs: the decision is missing');
});

test('the npm host routes both verbs to the operations', () => {
  const api = read('client/src/api.mjs');
  assert.ok(api.includes(`pathname === '${HOST_ROUTE}'`), 'api.mjs: the host route is missing');
  assert.match(api, /listEditorialOp\(ctx\)/, 'api.mjs: the GET op is not called');
  assert.match(api, /decideEditorialOp\(ctx/, 'api.mjs: the POST op is not called');

  const ops = read('client/src/operations-admin.mjs');
  assert.match(ops, /export async function listEditorialOp/, 'operations-admin.mjs: the read op is missing');
  assert.match(ops, /export async function decideEditorialOp/, 'operations-admin.mjs: the write op is missing');
  assert.match(read('client/src/operations.mjs'), /listEditorialOp/, 'operations.mjs: the op is not re-exported');
});

test('the bearer transport points at the Worker route', () => {
  const src = read('client/src/member-admin-client.mjs');
  assert.match(src, /export async function editorialAdminRequest/, 'the bearer transport is missing');
  assert.ok(src.includes(`'${ROUTE}'`), `the transport does not name ${ROUTE}`);
});

test('the extension dispatches both verbs', () => {
  const disp = read('extension/src/ext-dispatch.mjs');
  assert.ok(disp.includes(`case '${HOST_ROUTE}'`), 'ext-dispatch.mjs: the extension has no case for the route');
  assert.match(disp, /listEditorialOp/, 'ext-dispatch.mjs: the read op is not imported or called');
  assert.match(disp, /decideEditorialOp/, 'ext-dispatch.mjs: the write op is not imported or called');
});

test('the website client calls the Worker route directly', () => {
  const src = read('src/lib/workbench-client.ts');
  assert.match(src, /editorialQueue\(\)/, 'workbench-client: the read is missing');
  assert.match(src, /decideEditorial\(/, 'workbench-client: the decision is missing');
  assert.ok(src.includes(`workerGet('${ROUTE}')`), 'the website read does not name the Worker route');
  assert.ok(src.includes(`workerPost('${ROUTE}'`), 'the website decision does not name the Worker route');
});

test('the retired application lane is gone from every host', () => {
  // The Worker routes, the review element and both admin tabs were removed together. What STAYS is the stored
  // records (`application:` is still backed up and the member lookup still reads them), so this checks the
  // surfaces a person can reach, not the data.
  for (const gone of [
    'workers/signup/membership-creator-applications.mjs',
    'workers/signup/creator-application-alert.mjs',
    'membership/creator-application-notify.mjs',
    'client-ui/src/elements/gbti-applications-manager.mjs',
  ]) assert.equal(existsSync(new URL(gone, ROOT)), false, `${gone} is retired and must not be back`);

  for (const [file, what] of [
    ['workers/signup/index.mjs', 'the Worker still routes the retired lane'],
    ['client-ui/src/client.mjs', 'the shared client still calls it'],
    ['client/src/api.mjs', 'the npm host still routes it'],
    ['client/src/operations-admin.mjs', 'the operations still carry it'],
    ['client/src/member-admin-client.mjs', 'the bearer transport still carries it'],
    ['extension/src/ext-dispatch.mjs', 'the extension still dispatches it'],
    ['src/lib/workbench-client.ts', 'the website client still calls it'],
    ['src/pages/admin.astro', 'the website admin page still shows the tab'],
    ['extension/admin.html', 'the extension admin still shows the tab'],
  ]) {
    assert.ok(!/creator-applications|applications-manager|creatorApplication/.test(read(file)), `${file}: ${what}`);
  }
});

test('an approval never runs without the queue record being written first', () => {
  // The publish route writes the record BEFORE it opens the pull request, and refuses the publish when the
  // write fails. Read from the source because the ORDER is the property, and the order cannot be seen from
  // either half on its own. sow-274 Part 4 removed the fork route (github-app.mjs), so the hosted route is the only one.
  for (const file of ['workers/signup/membership-author.mjs']) {
    const src = read(file);
    // The CALL site, not the import: the import sits at the top of every file and would make this pass
    // whatever the body did. The pull request is opened through a template literal ending in `/pulls`, so it
    // is matched by shape rather than by a quoted string that no longer appears anywhere.
    const rec = src.indexOf('await recordEditorialItems(');
    const pr = src.search(/\/pulls`/);
    assert.ok(rec > 0, `${file}: the publish route writes no queue record`);
    assert.ok(pr > 0, `${file}: no pull request is opened here, so this check is looking at the wrong file`);
    assert.ok(rec < pr, `${file}: the pull request opens before the record is written`);
    assert.match(src.slice(rec, rec + 600), /recorded\.ok|!recorded/,
      `${file}: a failed record write must refuse the publish, or an item waits with nothing listing it`);
  }
});
