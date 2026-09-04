// sow-293: the creator-application review lane is wired end to end, on BOTH hosts.
//
// This is a WIRING guard, and it exists because the failure it catches is silent. The extension host reaches
// the Worker through a five-link chain (element -> client.mjs -> api.mjs -> operations -> member-admin-client
// -> Worker route), and a missing link does not throw at build time: the element calls an undefined method,
// optional-chains to undefined, and renders an empty lane. A superadmin then sees "no applications yet" while
// applications are sitting in KV.
//
// The website is a shorter chain but the same failure: a method that does not exist reads as an empty list.
//
// These are source assertions. The element's own logic lives in DOM code that node --test cannot reach, so
// what is pinned here is the CONNECTIONS, plus the one guard whose absence would be dangerous rather than
// merely broken (a corrupt record must not be approvable).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const ROUTE = '/membership/admin/creator-applications';

test('the WORKER serves both verbs on one route, superadmin-gated', () => {
  const idx = read('workers/signup/index.mjs');
  assert.ok(idx.includes(`pathname === '${ROUTE}'`), 'the Worker route is missing');
  assert.match(idx, /creatorApplicationList\(request, env/, 'the GET handler is not wired');
  assert.match(idx, /creatorApplicationDecide\(request, env/, 'the POST handler is not wired');

  // Both handlers must default to the SUPERADMIN authorizer. Approving grants a real tier, so an admin-level
  // default here would be a silent widening that no test elsewhere would catch.
  const h = read('workers/signup/membership-creator-applications.mjs');
  const supers = [...h.matchAll(/authorize = authorizeSuperadmin/g)].length;
  assert.equal(supers, 2, `expected both admin handlers to default to authorizeSuperadmin, found ${supers}`);
});

test('the WEBSITE host reaches that route', () => {
  const wc = read('src/lib/workbench-client.ts');
  assert.ok(wc.includes(`workerGet('${ROUTE}')`), 'the website read method is missing or points elsewhere');
  assert.ok(wc.includes(`workerPost('${ROUTE}'`), 'the website write method is missing or points elsewhere');
});

test('the EXTENSION host reaches it through every link of the chain', () => {
  // Five links. Each assertion names the file, because "the lane is empty" gives no clue which one broke.
  assert.match(read('client-ui/src/client.mjs'), /creatorApplications: \(\) => request\('GET', '\/api\/creator-applications'\)/,
    'client.mjs: the read method is missing');
  assert.match(read('client-ui/src/client.mjs'), /decideCreatorApplication: .*request\('POST', '\/api\/creator-applications'/,
    'client.mjs: the write method is missing');

  const api = read('client/src/api.mjs');
  assert.ok(api.includes("pathname === '/api/creator-applications'"), 'api.mjs: the host route is missing');
  assert.match(api, /listCreatorApplicationsOp\(ctx\)/, 'api.mjs: the GET op is not called');
  assert.match(api, /decideCreatorApplicationOp\(ctx/, 'api.mjs: the POST op is not called');

  const ops = read('client/src/operations-admin.mjs');
  assert.match(ops, /export async function listCreatorApplicationsOp/, 'operations-admin.mjs: the read op is missing');
  assert.match(ops, /export async function decideCreatorApplicationOp/, 'operations-admin.mjs: the write op is missing');

  assert.match(read('client/src/operations.mjs'), /listCreatorApplicationsOp/, 'operations.mjs: the op is not re-exported');

  assert.match(read('client/src/member-admin-client.mjs'), new RegExp(`'${ROUTE}'`.replace(/\//g, '\\/')),
    'member-admin-client.mjs: the transport does not target the Worker route');

  // THE SIXTH LINK, and this test originally MISSED it. The extension does not use client/src/api.mjs at
  // runtime: it dispatches through extension/src/ext-dispatch.mjs, so a route present in api.mjs and absent
  // there is served on the npm host and silently 404s in the extension. The existing
  // test/ext-dispatch-route-parity.test.mjs caught it when this one did not, which is the reason it is
  // asserted here too rather than left to the neighbour: a wiring guard that stops one link short is the
  // shape of guard that gives false confidence.
  const disp = read('extension/src/ext-dispatch.mjs');
  assert.ok(disp.includes("case '/api/creator-applications'"), 'ext-dispatch.mjs: the extension has no case for the route');
  assert.match(disp, /listCreatorApplicationsOp/, 'ext-dispatch.mjs: the read op is not imported or called');
  assert.match(disp, /decideCreatorApplicationOp/, 'ext-dispatch.mjs: the write op is not imported or called');
});

test('BOTH admin surfaces mount the element, and the element is registered', () => {
  // A mounted tag that nothing defines stays an inert unknown element forever, which renders as nothing at
  // all. That is the sow-271 dead-element failure, and it is why the registration is asserted with the mounts.
  assert.match(read('src/pages/admin.astro'), /<gbti-applications-manager>/, 'the website admin page does not mount it');
  assert.match(read('src/pages/admin.astro'), /gbti-applications-manager\.mjs/, 'the website admin page does not import it');
  assert.match(read('extension/admin.html'), /<gbti-applications-manager>/, 'the extension admin page does not mount it');
  assert.match(read('client-ui/src/index.mjs'), /gbti-applications-manager\.mjs/, 'the element is not registered in the client-ui index');

  // And each surface must offer a way to REACH the panel, or it is mounted where nobody can open it.
  assert.match(read('src/pages/admin.astro'), /data-tab="applications"/, 'the website has no tab for the panel');
  assert.match(read('extension/admin.html'), /data-tab="applications"/, 'the extension has no tab for the panel');
});

test('the website tab is SUPERADMIN-gated, matching the Worker', () => {
  // The website admin page gates tabs by rank via data-min. An admin-level tab here would show a panel whose
  // every request the Worker then refuses, which reads to the user as a broken screen rather than a denial.
  const page = read('src/pages/admin.astro');
  const tab = /<button[^>]*data-tab="applications"[^>]*>/.exec(page);
  assert.ok(tab, 'the applications tab was not found: this check is broken, not the subject');
  assert.match(tab[0], /data-min="superadmin"/, 'the applications tab must be superadmin-gated to match the Worker');
});

test('a CORRUPT application cannot be decided from the UI either', () => {
  // The Worker already refuses it (applicationState fails to `unknown`, never `pending`, and the route
  // returns 409). This is the second of two, and it matters because the first thing a superadmin would do
  // with a visible corrupt row is click approve on it.
  const el = read('client-ui/src/elements/gbti-applications-manager.mjs');
  assert.match(el, /corrupt/, 'the element does not distinguish a corrupt record');
  assert.match(el, /state === 'pending' && !corrupt/,
    'decision buttons must require a genuinely pending, non-corrupt record');
  assert.match(el, /disabled/, 'a corrupt row must render a disabled control rather than an active one');
});
