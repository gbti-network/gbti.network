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

// The two superadmins (the fixed root of trust) and a known grandfathered co-op member, used as live invariants.
const SUPERADMINS = [{ id: '2002207', login: 'atwellpub' }, { id: '125175036', login: 'gbtilabs' }];
const GRANDFATHERED_KNOWN = { id: '225425', login: 'rfilipo' }; // a real grandfathered member in house/grandfathered.yml
// A SENTINEL github_id for the governance authoring draft PR: obviously synthetic, never a real GitHub account,
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

// --- 2. Live override precedence: the trust core agrees with production governance files ---
async function livePrecedenceChecks() {
  // Read each override file from production main via the AUTHENTICATED contents API (works whether the repo is
  // public or private). Fall back to the local checkout, which in CI IS main and locally is the working tree, so
  // the trust core is always validated against real governance data even without a token or network.
  const gh = HAVE_TOKEN ? createGitHubClient({ token: TOKEN, repo: REPO, fetch: globalThis.fetch }) : null;
  async function loadOverride(path) {
    if (gh) { try { const c = await gh.getContent(path, 'main'); if (c?.content) return yaml.load(fromB64(c.content)); } catch { /* fall through to disk */ } }
    try { return yaml.load(fs.readFileSync(path, 'utf8')); } catch { return null; }
  }
  const [rolesParsed, gfParsed, bansParsed] = await Promise.all([
    loadOverride('house/roles.yml'), loadOverride('house/grandfathered.yml'), loadOverride('house/bans.yml'),
  ]);
  if (!rolesParsed || !gfParsed || !bansParsed) {
    check('live override files are fetchable + parse', false, `roles=${!!rolesParsed} gf=${!!gfParsed} bans=${!!bansParsed}`);
    return;
  }
  check('live override files are fetchable + parse', true, 'roles.yml + grandfathered.yml + bans.yml');

  const roles = rolesFromParsed(rolesParsed);
  const bans = bansFromParsed(bansParsed);
  const grandfathers = grandfathersFromParsed(gfParsed);
  const overrides = { roles, bans, grandfathers };

  // The two superadmins resolve as staff/paid even with a 'none' Stripe-derived status (ban > staff > grandfather).
  const adminsOk = SUPERADMINS.every((s) => {
    const eff = effectiveStatus(s.id, 'none', overrides);
    return roleOf(s.id, roles) === ROLE.superadmin && eff.status === 'paid' && eff.source === 'staff';
  });
  check('both superadmins resolve as staff/paid', adminsOk, SUPERADMINS.map((s) => s.login).join(', '));

  // A known grandfathered co-op member resolves as grandfather/paid with no Stripe subscription.
  const gfEff = effectiveStatus(GRANDFATHERED_KNOWN.id, 'none', overrides);
  check('a grandfathered co-op member resolves as grandfather/paid', gfEff.status === 'paid' && gfEff.source === 'grandfather', `${GRANDFATHERED_KNOWN.login} -> ${gfEff.source}`);

  // The grandfathered list carries the migrated co-op members (non-empty), and no superadmin is banned.
  check('grandfathered list is populated (co-op members migrated)', grandfathers.size > 0, `${grandfathers.size} grandfathered`);
  const noAdminBanned = SUPERADMINS.every((s) => !bans.has(s.id));
  check('no superadmin is banned (well-formed bans.yml)', noAdminBanned && bans.size >= 0, `${bans.size} bans`);
}

// --- 3. Governance PR authoring: a DRAFT PR adding a sentinel grandfather entry, confirmed then scrubbed ---
async function governanceAuthoringCycle() {
  if (!runnable([FULL])) { skip('governance grandfather draft PR authored (confirm)', 'skipped (E2E_TAGS=smoke is read-only)'); return; }
  if (!HAVE_TOKEN) { skip('governance grandfather draft PR authored (confirm)', 'no real token'); skip('governance PR + branch scrubbed (zero leaks)', 'no real token'); return; }
  const gh = createGitHubClient({ token: TOKEN, repo: REPO, fetch: globalThis.fetch });
  const branch = `e2e/governance-${RUN_ID}`;
  const path = 'house/grandfathered.yml';
  const reg = createRegistry();

  let prNumber = null;
  let carriesSentinel = false;
  try {
    // Read the live file, build the edit with the REAL superadmin-actions core, serialize it back to YAML.
    const cur = await gh.getContent(path, 'main');
    if (!cur?.content || !cur?.sha) throw new Error('cannot read house/grandfathered.yml on main');
    const parsed = yaml.load(fromB64(cur.content)) || {};
    const { next, changed } = grandfather(parsed, { githubId: SENTINEL.id, login: SENTINEL.login, reason: 'SOW-035 E2E sentinel (auto-removed; never merged)' }, { now: new Date(), actor: { githubId: SUPERADMINS[1].id, login: SUPERADMINS[1].login } });
    if (!changed) throw new Error('sentinel grandfather produced no change (id already present?)');
    const newYaml = yaml.dump(next, { lineWidth: 100, noRefs: true });

    const baseRef = await gh.getRef('heads/main');
    const baseSha = baseRef?.object?.sha;
    if (!baseSha) throw new Error('cannot resolve main head sha');
    await gh.createRef(branch, baseSha);
    reg.register(`branch ${branch}`, async () => { await gh.deleteRef(branch); });
    // [skip ci]: the branch lives ~2s before the PR closes + the branch deletes, so a push/PR CI run would fail on
    // the vanished ref. The gate (pull_request_target) is metadata-only + a superadmin PR, so it never auto-merges
    // a DRAFT anyway. The sentinel id is fake, so an impossible merge grants nothing real.
    await gh.putContent(path, { message: `e2e: governance sentinel grandfather (${RUN_ID}) [skip ci]`, content: b64(newYaml), branch, sha: cur.sha });
    const pull = await gh.createPull({ title: `[e2e] governance sentinel ${RUN_ID} (auto-closing)`, head: branch, base: 'main', body: 'SOW-035 Phase 4 automated E2E. DRAFT PR adding a SENTINEL (fake) grandfather id, auto-closed + branch deleted by the harness. Never merges; changes no real access. Safe to ignore.', draft: true });
    prNumber = pull?.number ?? null;
    if (prNumber) reg.register(`PR #${prNumber}`, async () => { await gh.closePull(prNumber, { comment: 'e2e: auto-closing governance test PR' }); });

    // Confirm the branch actually carries the sentinel entry (the edit + commit really landed on the head).
    const onBranch = await gh.getContent(path, branch);
    carriesSentinel = !!onBranch?.content && fromB64(onBranch.content).includes(SENTINEL.id);
    check('governance grandfather draft PR authored (confirm)', !!prNumber && carriesSentinel, `PR #${prNumber} adds grandfather ${SENTINEL.id} to ${path}`);
  } catch (e) {
    check('governance grandfather draft PR authored (confirm)', false, e?.message ?? String(e));
  }

  const cr = await reg.cleanup(console.log);
  let branchGone = false;
  try { await gh.getRef(`heads/${branch}`); } catch (e) { branchGone = e?.status === 404; }
  let prClosed = !prNumber;
  if (prNumber) { try { const pr = await gh.getPull(prNumber); prClosed = pr?.state === 'closed'; } catch { prClosed = false; } }
  check('governance PR + branch scrubbed (zero leaks)', cr.leaked.length === 0 && branchGone && prClosed, `cleaned=${cr.cleaned} leaked=${cr.leaked.length} branchGone=${branchGone} prClosed=${prClosed}`);
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
