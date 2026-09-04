// HOST-RESPONSIBILITY MANIFEST for the two API routers: the extension host
// (extension/src/ext-dispatch.mjs, which routes with `case '/api/x'`) and the website/npm host
// (client/src/api.mjs, which routes with `if (pathname === '/api/x')`).
//
// This file used to assert plain route PARITY, and that invariant was retired by sow-204 rather than weakened.
// The bug class it was built for is real and unchanged: four live defects, each because a route existed in one
// router and not the other and nothing compared them (Unpublish/Republish /api/content/status, comment delete
// /api/comment/delete, image staging /api/image). What changed is that the two hosts are no longer MEANT to
// match. The owner's Option A ruling (2026-08-28) moved authoring to the website, so twelve authoring routes
// left the extension deliberately. Carrying those as twelve allowlist exceptions is what the old header warned
// against: an allowlist that large stops asserting anything, because every real divergence can hide in it.
//
// So the shape is a MANIFEST, not a symmetry check with exceptions. Every route belongs to exactly one bucket:
//   BOTH                 the default, and still the invariant for everything unlisted. A route added to one
//                        host and forgotten in the other fails here, which is the whole point of the guard.
//   WEBSITE_AUTHORING    sow-204: authoring is website-only. ONE reason for the whole set, declared once.
//   WEBSITE_FILESYSTEM   the npm CMS host's filesystem features, which the extension cannot have.
//   EXTENSION_WELCOME    the extension's own first-run flow, which the website does not run.
// A per-route table was considered and rejected: 68 rows with 68 reasons is a list nobody maintains, and it
// goes stale the way every other count in this repo has. A bucket is a DECISION, and it is stated once.
//
// The extraction is the load-bearing part. A naive per-syntax regex (match only `case '...'`, or only
// `pathname === '...'`) reports dozens of false "missing" routes because each file uses ONLY its own syntax,
// which is the trap that produced a 56-false-positive parity run during sow-106. Instead we extract every
// '/api/...' STRING LITERAL from BOTH files: both routers name the route as the same literal, so this catches
// both syntaxes. Quoting matters: a comment naming /api/foo unquoted is prose, not a route.
//
// The SECOND test in this file, the pre-auth positioning invariant, is NOT transitional and was untouched by
// sow-204: it is the removal-safety guardrail that must keep holding as routes are deleted, because
// ext-dispatch encodes authorization by position.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every distinct '/api/...' path literal referenced in a source file. Both routers name their route as a
 *  string literal, so this catches `case '/api/x'` AND `if (pathname === '/api/x')` alike (single or double
 *  quoted). Re-derived from the files at test time, never hardcoded, so it cannot pass stale. */
function routeSet(relPath) {
  const src = readFileSync(join(ROOT, relPath), 'utf8');
  const set = new Set();
  for (const m of src.matchAll(/['"](\/api\/[a-zA-Z0-9/_-]+)['"]/g)) set.add(m[1]);
  return set;
}

// Routes the WEBSITE/npm host serves and the extension deliberately does not. Each bucket carries one reason
// for its whole set; a route that needs its own reason does not belong in a bucket, it belongs in a new one.
const WEBSITE_ONLY = {
  WEBSITE_AUTHORING: {
    reason: 'sow-204 (owner Option A, 2026-08-28): the extension stops being an AUTHORING host. Articles, prompts and projects are written on gbti.network; the extension keeps reading, curating and the Share composer. The matching UI left in the same change: the four authoring tabs are flagged `authoring` in gbti-workspace, their Overview tiles are filtered by visibleTiles, the shell "+" opens the Share composer directly, and the activity bell no longer fetches a review lane. Removing a route while a caller survives is the failure to watch for here.',
    routes: [
      '/api/publish', '/api/validate', '/api/form-fields', '/api/image',
      '/api/content/status', '/api/content/rename',
      '/api/drafts', '/api/draft/discard', '/api/draft/publish',
      '/api/contributions', '/api/contribution', '/api/contribution-review',
    ],
  },
  WEBSITE_FILESYSTEM: {
    reason: 'npm CMS host only: it manages the node autostart (peg-startup), a filesystem feature the extension does not have (sow-036). The ops live in client/src/settings-ops.mjs, absent from ext-dispatch and operations.mjs.',
    routes: ['/api/settings'],
  },
};

// Routes the EXTENSION serves and the website/npm host deliberately does not.
const EXTENSION_ONLY = {
  EXTENSION_WELCOME: {
    reason: 'extension welcome flow only: gbti-welcome mints the one-time Discord-link URL and polls for the linked state. api.mjs does not import the ops; the only other consumer, gbti-syndicate-now, calls them optional-chained and degrades to no @mention preview.',
    routes: ['/api/discord-link', '/api/discord-link/status'],
  },
};

/** The declared routes of a manifest side, flattened and sorted. Also proves the manifest is well-formed. */
function declared(manifest, side) {
  const all = [];
  for (const [name, bucket] of Object.entries(manifest)) {
    assert.ok(typeof bucket.reason === 'string' && bucket.reason.length > 40, `${side} bucket ${name} needs a real reason, not a label.`);
    assert.ok(Array.isArray(bucket.routes) && bucket.routes.length > 0, `${side} bucket ${name} declares no routes. An empty bucket is a dead decision: delete it.`);
    all.push(...bucket.routes);
  }
  assert.equal(new Set(all).size, all.length, `${side} declares a route in two buckets; every route belongs to exactly one.`);
  return all.sort();
}

/** Which bucket claims a route, for a failure message that says WHY rather than only WHAT. */
function bucketOf(manifest, route) {
  for (const [name, b] of Object.entries(manifest)) if (b.routes.includes(route)) return name;
  return null;
}

test('host manifest: every /api route is served by BOTH hosts unless a declared bucket says otherwise', () => {
  const ext = routeSet('extension/src/ext-dispatch.mjs');
  const api = routeSet('client/src/api.mjs');

  // Sanity: the extraction found real route sets, not zero. A broken regex would satisfy every assertion below
  // by comparing two empty sets, which is the exact "evidence that does not bear on the claim" this repo keeps
  // meeting. Both numbers must be large, and they are re-derived from the files on every run.
  assert.ok(ext.size > 40 && api.size > 40, `route extraction looks broken: ext=${ext.size} api=${api.size}`);

  const websiteOnly = declared(WEBSITE_ONLY, 'WEBSITE_ONLY');
  const extensionOnly = declared(EXTENSION_ONLY, 'EXTENSION_ONLY');

  // The two asymmetries must be EXACTLY what the manifest declares. deepEqual in both directions at once, so a
  // route that quietly stops being asymmetric fails just as loudly as one that quietly starts.
  const actualWebsiteOnly = [...api].filter((r) => !ext.has(r)).sort();
  const actualExtensionOnly = [...ext].filter((r) => !api.has(r)).sort();

  const undeclaredWebsite = actualWebsiteOnly.filter((r) => !websiteOnly.includes(r));
  const undeclaredExtension = actualExtensionOnly.filter((r) => !extensionOnly.includes(r));
  assert.deepEqual(undeclaredWebsite, [], `routes in client/src/api.mjs (website/npm) but NOT extension/src/ext-dispatch.mjs, and not declared: [${undeclaredWebsite.join(', ')}]. Either add the case to ext-dispatch, or put the route in a WEBSITE_ONLY bucket with the reason it is website-only.`);
  assert.deepEqual(undeclaredExtension, [], `routes in extension/src/ext-dispatch.mjs but NOT client/src/api.mjs, and not declared: [${undeclaredExtension.join(', ')}]. Either add it to api.mjs, or put it in an EXTENSION_ONLY bucket with the reason it is extension-only.`);

  // Staleness, the other half. A declared route that BOTH hosts now serve (or neither does) is a dead
  // exception, and a manifest that keeps them is back to being an allowlist that asserts nothing.
  const staleWebsite = websiteOnly.filter((r) => !actualWebsiteOnly.includes(r));
  const staleExtension = extensionOnly.filter((r) => !actualExtensionOnly.includes(r));
  assert.deepEqual(staleWebsite, [], `stale WEBSITE_ONLY entries: ${staleWebsite.map((r) => `${r} (bucket ${bucketOf(WEBSITE_ONLY, r)})`).join(', ')}. Each is no longer website-only: the extension serves it again, or neither host does. Remove it from the manifest.`);
  assert.deepEqual(staleExtension, [], `stale EXTENSION_ONLY entries: ${staleExtension.map((r) => `${r} (bucket ${bucketOf(EXTENSION_ONLY, r)})`).join(', ')}. Each is no longer extension-only. Remove it from the manifest.`);
});

// sow-200 (option 1, owner-elected 2026-08-09): the SOW proposed a full shared route manifest so that pre-auth
// status stops being encoded by LINE ORDER. The owner elected the lighter path instead: keep the two dispatchers
// as-is (their difference is a load-bearing auth boundary, not a style inconsistency, see the SOW caution) and
// convert the line-order invariant into a TESTED one here, closing the full-manifest scope. This is the one
// hazard the route-parity guard above does not touch.
//
// In ext-dispatch.mjs, POSITION ENCODES AUTHORIZATION: a route handled ABOVE the `if (!username)` identity gate
// runs pre-auth (public); a `case` in the switch below the gate runs only for a signed-in caller. A public route
// placed below the gate breaks signed-out users, which actually happened (ext-dispatch :87-91: a signed-out
// member got a 409 and the onboarding wizard dead-ended). This test pins which routes are public.
const PRE_AUTH = new Set([
  '/api/status',              // the identity/membership probe that DRIVES the sign-in state
  '/api/onboarding-status',   // SOW-026: drives the first-run sign-in step; must answer before sign-in
  // SOW-079/087: the admin MANAGER reads are public git-native data (house/*.yml), so they load tokenless.
  '/api/taxonomy', '/api/news-source-pool', '/api/quote-pool',
  '/api/content-channel-pool', '/api/moderation-flag-pool', '/api/syndication-template-pool',
  '/api/coupon-pool', '/api/news-engagement', '/api/syndication-settings',
  '/api/site-settings', // sow-271: the site-wide presentation toggles (public git-native read)
]);

test('pre-auth positioning: the routes above the ext-dispatch identity gate are EXACTLY the declared pre-auth set', () => {
  const src = readFileSync(join(ROOT, 'extension/src/ext-dispatch.mjs'), 'utf8');
  const lines = src.split('\n');
  const gate = lines.findIndex((l) => /if\s*\(\s*!username\s*\)/.test(l));
  assert.ok(gate > 0, 'could not locate the identity gate (if (!username)) in ext-dispatch.mjs');

  // Pre-auth handlers use `if (pathname === '/api/x')`; gated routes use `case '/api/x'` in the switch below the
  // gate. Match the handler form (not a bare literal), so a comment that merely names a route path above the gate
  // is not counted as a handler.
  const handlers = [];
  lines.forEach((line, i) => {
    const m = line.match(/pathname === ['"](\/api\/[a-zA-Z0-9/_-]+)['"]/);
    if (m) handlers.push({ route: m[1], line: i });
  });
  const above = [...new Set(handlers.filter((h) => h.line < gate).map((h) => h.route))].sort();
  const below = handlers.filter((h) => h.line > gate).map((h) => h.route);

  // A pre-auth-style handler below the gate is the exact :87-91 defect: a route meant to be public that a
  // signed-out caller can no longer reach.
  assert.deepEqual(below, [], `pathname=== handlers found BELOW the identity gate: [${below.join(', ')}]. A public route placed below the gate breaks signed-out users (ext-dispatch :87-91). Move it above the gate.`);

  // The set above the gate must be EXACTLY the declared pre-auth set. Adding a route above without declaring it,
  // or dropping a declared pre-auth route below the gate, fails here, so "public vs gated" is a written, tested
  // decision instead of an implicit line number.
  assert.deepEqual(above, [...PRE_AUTH].sort(), 'the routes above the ext-dispatch identity gate no longer match the declared PRE_AUTH set. If you intend to change what is public, update PRE_AUTH deliberately (with a reason); never move a route across the gate as a side effect of a refactor.');
});
