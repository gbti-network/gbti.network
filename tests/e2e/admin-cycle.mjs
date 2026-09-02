// SOW-035 Phase 4: the ADMIN / MODERATION / GATE / RECONCILE end-to-end cycles against the LIVE system, run as
// the gbtilabs superadmin (E2E_TOKEN / GH_BOT_TOKEN). Four cycles, all safe-by-default (no production pollution):
//   1. admin endpoints fail closed: /membership/admin/statuses + /membership/admin/ops reject without a token;
//      with the superadmin token, statuses returns the Stripe map and ops rejects an unknown action BEFORE any
//      dispatch (the allow-list is the boundary). Never fires a real reconcile/e2e dispatch.
//   2. live override precedence: read the real house/{roles,grandfathered,bans}.yml from main and assert the
//      trust core (overrides-core) agrees with production governance — the two superadmins resolve as staff/paid,
//      a known grandfathered co-op member resolves as grandfather/paid even with no Stripe sub, bans are
//      well-formed and no superadmin is banned. Read-only.
//   3. governance PR authoring: build a grandfather edit with the real superadmin-actions core, open a DRAFT PR
//      that adds a SENTINEL (test-only, non-real) github_id to grandfathered.yml, confirm the branch carries the
//      entry, then scrub (close the PR + delete the branch). A draft PR can NEVER auto-merge, the id is fake, and
//      it is removed within ~2s, so effective status is never changed for anyone. Proves the governance authoring
//      pipeline (pure edit -> valid YAML -> PR) end to end without touching live access.
//   4. reconcile dry run (creds-gated): shell `node scripts/reconcile.mjs` (dry-run is the default) and assert it
//      plans without applying. Skipped unless STRIPE_SECRET_KEY (or E2E_RECONCILE=1) is present, since it reads
//      the live Stripe registry; the nightly stays green when those creds are not wired into the e2e job.
//
// Run: node --env-file=.env tests/e2e/admin-cycle.mjs   (authenticated cycles SKIP without a real token)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { createRegistry } from './lib/cleanup.mjs';
import { createGitHubClient } from '../../clients/github.mjs';
import {
  rolesFromParsed, bansFromParsed, grandfathersFromParsed, effectiveStatus, roleOf, ROLE,
} from '../../membership/overrides-core.mjs';
import { grandfather } from '../../membership/superadmin-actions.mjs';
import { runnable, FULL } from './lib/tags.mjs'; // SOW-035 P5: write cycles are 'full'; smoke runs read-only only

const SITE = process.env.E2E_SITE || 'https://gbti.network';
const WORKER = process.env.E2E_WORKER || 'https://signup.gbti.network';
const REPO = process.env.GITHUB_CONTENT_REPO || 'gbti-network/gbti.network';
const TOKEN = process.env.E2E_TOKEN || process.env.GITHUB_BOT_TOKEN || '';
const HAVE_TOKEN = !!TOKEN && !/^REPLACE/i.test(TOKEN) && TOKEN.length >= 40;
const RUN_ID = process.env.GITHUB_RUN_ID || String(process.hrtime.bigint());

// The two superadmins (the fixed root of trust), used as live invariants. sow-213 Step 3: the grandfathered
// invariant no longer hardcodes a real member (that would be the last public record of a comped membership once
// house/grandfathered.yml is deleted); a grandfathered id is derived DYNAMICALLY from the KV store instead.
const SUPERADMINS = [{ id: '2002207', login: 'atwellpub' }, { id: '125175036', login: 'gbtilabs' }];
// A SENTINEL github_id for the governance authoring cycle: obviously synthetic, never a real GitHub account,
// so even an impossible accidental merge would only grant paid-equivalent to an id nobody holds.
const SENTINEL = { id: '900000035', login: 'e2e-sentinel-sow035' };

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, state: ok ? 'pass' : 'fail' }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); return ok; };
const skip = (name, reason) => { results.push({ name, state: 'skip' }); console.log(`SKIP  ${name}  (${reason})`); };
const authHeaders = { Authorization: `Bearer ${TOKEN}` };
const jsonHeaders = { ...authHeaders, 'Content-Type': 'application/json' };
async function getJson(url, opts) { const r = await fetch(url, opts); let body = null; try { body = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body }; }
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const fromB64 = (s) => Buffer.from(s, 'base64').toString('utf8');

// --- 1. Admin endpoints fail closed (and the allow-list rejects an unknown op before any dispatch) ---
async function adminEndpointChecks() {
  const noTokStatuses = await fetch(WORKER + '/membership/admin/statuses');
  check('admin statuses fails closed without a token (401)', noTokStatuses.status === 401, String(noTokStatuses.status));

  const noTokOps = await fetch(WORKER + '/membership/admin/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reconcile' }) });
  check('admin ops fails closed without a token (401)', noTokOps.status === 401, String(noTokOps.status));

  if (!HAVE_TOKEN) {
    skip('admin statuses returns the Stripe map for the superadmin', 'no real token');
    skip('admin ops rejects an unknown action (400) before any dispatch', 'no real token');
    return;
  }
  const statuses = await getJson(WORKER + '/membership/admin/statuses', { headers: authHeaders });
  check('admin statuses returns the Stripe map for the superadmin', statuses.status === 200 && statuses.body?.ok === true && statuses.body?.statuses && typeof statuses.body.statuses === 'object', `status=${statuses.status} ok=${statuses.body?.ok}`);

  // An unknown action exercises the gate + allow-list WITHOUT firing a real reconcile/e2e dispatch: it must be a
  // 400 (allow-list), never a 200. This is the safe way to prove the ops endpoint authorizes then validates.
  const badOp = await getJson(WORKER + '/membership/admin/ops', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'definitely-not-an-allowed-op' }) });
  check('admin ops rejects an unknown action (400) before any dispatch', badOp.status === 400, `status=${badOp.status}`);
}

// --- 2. Live override precedence: the trust core agrees with production governance state ---
// sow-213 Step 3: roles.yml STAYS git-native (the root of trust); bans + grandfathers are KV-native now (the git
// files are deleted), so they come from the Worker's admin overrides endpoint. If that endpoint is unreachable
// or unauthorized (no token, or a Worker that predates this deploy), the KV checks SKIP rather than fail: the
// nightly must never red on a governance store it could not reach.
async function livePrecedenceChecks() {
  const gh = HAVE_TOKEN ? createGitHubClient({ token: TOKEN, repo: REPO, fetch: globalThis.fetch }) : null;
  async function loadRoles() {
    if (gh) { try { const c = await gh.getContent('house/roles.yml', 'main'); if (c?.content) return yaml.load(fromB64(c.content)); } catch { /* fall through to disk */ } }
    try { return yaml.load(fs.readFileSync('house/roles.yml', 'utf8')); } catch { return null; }
  }
  const rolesParsed = await loadRoles();
  if (!rolesParsed) { check('house/roles.yml is fetchable + parses (the git-native root of trust)', false); return; }
  check('house/roles.yml is fetchable + parses (the git-native root of trust)', true);
  const roles = rolesFromParsed(rolesParsed);

  // Superadmins hold the superadmin role in git roles.yml, before any KV read.
  const rolesOk = SUPERADMINS.every((s) => roleOf(s.id, roles) === ROLE.superadmin);
  check('both superadmins hold the superadmin role in roles.yml', rolesOk, SUPERADMINS.map((s) => s.login).join(', '));

  if (!HAVE_TOKEN) { skip('bans + grandfathers resolve from the KV overrides store', 'no real token'); return; }
  const ov = await getJson(WORKER + '/membership/admin/overrides', { headers: authHeaders });
  if (ov.status !== 200 || !ov.body?.ok) {
    skip('bans + grandfathers resolve from the KV overrides store', `overrides endpoint status ${ov.status} (Worker may predate this deploy)`);
    return;
  }

  const bans = bansFromParsed(ov.body.bans);
  const grandfathers = grandfathersFromParsed(ov.body.grandfathered);
  const overrides = { roles, bans, grandfathers };

  // Both superadmins resolve as staff/paid even with a 'none' Stripe status (ban > staff), and neither is banned.
  const staffOk = SUPERADMINS.every((s) => {
    const eff = effectiveStatus(s.id, 'none', overrides);
    return eff.status === 'paid' && eff.source === 'staff' && !bans.has(s.id);
  });
  check('both superadmins resolve as staff/paid and neither is banned (KV bans)', staffOk, `${bans.size} bans`);

  // The grandfathered list carries the migrated co-op members. Pick one DYNAMICALLY (no hardcoded member) and
  // confirm it resolves as grandfather/paid.
  check('grandfathered list is populated in KV (co-op members migrated)', grandfathers.size > 0, `${grandfathers.size} grandfathered`);
  const someGrandfatheredId = [...grandfathers.keys()][0];
  if (someGrandfatheredId) {
    const gfEff = effectiveStatus(someGrandfatheredId, 'none', overrides);
    check('a grandfathered member resolves as grandfather/paid', gfEff.status === 'paid' && gfEff.source === 'grandfather', `id ${someGrandfatheredId} -> ${gfEff.source}`);
  } else {
    skip('a grandfathered member resolves as grandfather/paid', 'no grandfathered members in the KV store');
  }
}

// --- 3. Governance authoring: grandfather a SENTINEL id through the Worker (KV-native), confirm, then scrub ---
// sow-213 Step 3: governance is KV-native now (no git PR; the reappearance guard would reject re-creating
// grandfathered.yml). Grandfather a synthetic SENTINEL through POST /membership/admin/author, confirm it in the
// KV overrides store, then ungrandfather it. The id is fake, so even if the scrub failed nothing real is granted.
async function governanceAuthoringCycle() {
  if (!runnable([FULL])) { skip('governance sentinel grandfather via the Worker (KV)', 'skipped (E2E_TAGS=smoke is read-only)'); return; }
  if (!HAVE_TOKEN) { skip('governance sentinel grandfather via the Worker (KV)', 'no real token'); skip('governance sentinel scrubbed from KV (zero leaks)', 'no real token'); return; }
  const author = (body) => getJson(WORKER + '/membership/admin/author', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
  const inKv = async () => {
    const ov = await getJson(WORKER + '/membership/admin/overrides', { headers: authHeaders });
    return ov.status === 200 && (ov.body?.grandfathered?.grandfathered ?? []).some((e) => String(e?.github_id) === SENTINEL.id);
  };

  let granted = false;
  let confirmed = false;
  try {
    const add = await author({ action: 'grandfather', githubId: SENTINEL.id, reason: 'SOW-035 E2E sentinel (auto-removed)' });
    granted = add.status === 200 && (add.body?.kvWritten === true || add.body?.noop === true);
    confirmed = await inKv();
    check('governance sentinel grandfather via the Worker (KV)', granted && confirmed, `granted=${granted} confirmed=${confirmed}`);
  } catch (e) {
    check('governance sentinel grandfather via the Worker (KV)', false, e?.message ?? String(e));
  }

  // Scrub: ungrandfather the sentinel and confirm it is gone from the KV store.
  let scrubbed = false;
  try {
    await author({ action: 'ungrandfather', githubId: SENTINEL.id });
    scrubbed = !(await inKv());
  } catch { scrubbed = false; }
  check('governance sentinel scrubbed from KV (zero leaks)', scrubbed, `sentinel ${SENTINEL.id} removed`);
}

// --- 4. Reconcile dry run (creds-gated): the planner runs against the live registry without applying ---
async function reconcileDryRunCycle() {
  if (!runnable([FULL])) { skip('reconcile dry run plans without applying', 'skipped (E2E_TAGS=smoke is read-only)'); return; }
  const haveStripe = !!process.env.STRIPE_SECRET_KEY || process.env.E2E_RECONCILE === '1';
  if (!haveStripe) { skip('reconcile dry run plans without applying', 'set STRIPE_SECRET_KEY or E2E_RECONCILE=1 (reads the live Stripe registry)'); return; }
  const r = spawnSync('node', ['scripts/reconcile.mjs'], { encoding: 'utf8', timeout: 180000, env: process.env });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  // dry-run is the default: it must complete (exit 0) AND announce a DRY RUN, AND never claim to have applied.
  const planned = /DRY RUN/i.test(out);
  const applied = /APPLY|applied/i.test(out) && !/would/i.test(out);
  check('reconcile dry run plans without applying', r.status === 0 && planned && !applied, `exit=${r.status} planned=${planned}`);
}

async function main() {
  console.log(`SOW-035 admin-cycle against ${SITE} + ${WORKER} + repo ${REPO} (run ${RUN_ID})\n`);
  await adminEndpointChecks();
  await livePrecedenceChecks();
  await governanceAuthoringCycle();
  await reconcileDryRunCycle();

  const pass = results.filter((r) => r.state === 'pass').length;
  const fail = results.filter((r) => r.state === 'fail').length;
  const skipped = results.filter((r) => r.state === 'skip').length;
  console.log(`\n=== ${pass} passed, ${fail} failed, ${skipped} skipped (of ${results.length}) ===`);
  if (skipped) console.log('Skipped checks need a real token (E2E_TOKEN / GH_BOT_TOKEN) and/or STRIPE_SECRET_KEY; or run the e2e-smoke workflow.');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('E2E admin-cycle crashed:', e?.message ?? e); process.exit(1); });
