// The signup Worker's entry as ONE text: index.mjs and the modules split out of it, in the order the single file held
// their code. workers/signup/index.mjs was split at the 900-line limit (owner, 2026-09-30) into route-helpers.mjs,
// oauth-state.mjs, signup-routes.mjs, billing-routes.mjs, cron.mjs, member-routes.mjs and admin-routes.mjs, and a
// test that read only index.mjs would quietly stop seeing every line that moved: a check that a retired route is
// ABSENT would pass on nothing. Read the Worker's routing and wiring through this instead of by path.
//
// Not a test file (no .test. in the name), so the test runner never runs it on its own.
import fs from 'node:fs';

const ROOT = new URL('../../', import.meta.url);

/**
 * The files, in the order their code stood in the single-file index.mjs: the shared helpers, the OAuth state, the
 * signup and billing handlers, the cron jobs, then the router itself and the two route groups it calls last.
 */
export const WORKER_FILES = [
  'workers/signup/route-helpers.mjs',
  'workers/signup/oauth-state.mjs',
  'workers/signup/signup-routes.mjs',
  'workers/signup/billing-routes.mjs',
  'workers/signup/cron.mjs',
  'workers/signup/index.mjs',
  'workers/signup/member-routes.mjs',
  'workers/signup/admin-routes.mjs',
];

/**
 * Every Worker entry file, joined in order. Throws if index.mjs no longer wires one of them in, so no guard reads a
 * stale file.
 */
export function workerSource() {
  const texts = WORKER_FILES.map((f) => fs.readFileSync(new URL(f, ROOT), 'utf8'));
  const index = texts[WORKER_FILES.indexOf('workers/signup/index.mjs')];
  for (const f of WORKER_FILES) {
    if (f === 'workers/signup/index.mjs') continue;
    const base = f.slice('workers/signup/'.length);
    if (!index.includes(`from './${base}';`)) {
      throw new Error(`worker-source: index.mjs no longer imports ${base}, so the code read here may not be what the Worker runs`);
    }
  }
  if (!/^const ROUTE_GROUPS = \[handleSignupRoutes, handleBillingRoutes, handleMemberRoutes, handleAdminRoutes\];$/m.test(index)) {
    throw new Error('worker-source: index.mjs no longer routes through all four route groups, so a route read here may not be served');
  }
  return texts.join('\n');
}
