// SOW-035 Phase 1: a runnable, SELF-CLEANING end-to-end smoke against the LIVE system, driven by the gbtilabs
// superadmin GitHub token (GITHUB_BOT_TOKEN). It confirms the backend systems the in-extension UI depends on
// (the static site, the activity + per-type index JSONs with the fixed thumbnails, and the Worker oracle /
// member endpoints), exercises one full CREATE -> CONFIRM -> SCRUB cycle against the deletable KV activity
// store, and asserts the cleanup restored the baseline (zero leaked artifacts). The heavier Playwright
// extension-UI specs are the next phase; this proves the create/confirm/cleanup loop the SOW is built around.
//
// Run: node --env-file=.env tests/e2e/api-smoke.mjs        (exits non-zero on any failed check)
//
// Safety: it acts only as gbtilabs (a bot superadmin), only touches that account's own KV activity, and removes
// exactly what it added (favorite on -> off). It never writes content, opens a PR, or changes another member.

import { createRegistry } from './lib/cleanup.mjs';

const SITE = process.env.E2E_SITE || 'https://gbti.network';
const WORKER = process.env.E2E_WORKER || 'https://signup.gbti.network';
// E2E_TOKEN (a real member/superadmin GitHub token) takes precedence; GITHUB_BOT_TOKEN is the gbtilabs fallback.
// In CI this is the GH_BOT_TOKEN secret. Locally .env ships a REPLACE_AT_M0 placeholder, so the authenticated
// checks SKIP (not fail) until a real token is supplied.
const TOKEN = process.env.E2E_TOKEN || process.env.GITHUB_BOT_TOKEN || '';
const HAVE_TOKEN = !!TOKEN && !/^REPLACE/i.test(TOKEN) && TOKEN.length >= 40;
const GBTILABS_ID = '125175036';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, state: ok ? 'pass' : 'fail' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return ok;
}
function skip(name, reason) {
  results.push({ name, state: 'skip' });
  console.log(`SKIP  ${name}  (${reason})`);
}
const authHeaders = { Authorization: `Bearer ${TOKEN}` };
const jsonHeaders = { ...authHeaders, 'Content-Type': 'application/json' };
async function getJson(url, opts) {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch { /* non-json */ }
  return { status: r.status, ok: r.ok, body };
}

async function main() {
  if (!TOKEN) { console.error('E2E: GITHUB_BOT_TOKEN (gbtilabs) is required. Run with node --env-file=.env.'); process.exit(2); }
  console.log(`SOW-035 api-smoke against ${SITE} + ${WORKER} as gbtilabs\n`);

  // --- 1. Static site + index JSONs (the in-extension browse/feed data source) ---
  const home = await fetch(SITE + '/');
  check('site home returns 200', home.status === 200, String(home.status));

  const activity = await getJson(SITE + '/activity-index.json');
  const entries = activity.body?.entries || [];
  check('activity-index.json has entries', entries.length > 0, `${entries.length} entries`);

  const prompts = await getJson(SITE + '/prompts-index.json');
  const promptItems = prompts.body?.items || [];
  const promptWithThumb = promptItems.find((i) => i.thumb);
  if (promptWithThumb) {
    const thumb = await fetch(SITE + promptWithThumb.thumb);
    check('prompt index thumbnail resolves (SOW-031 fix)', thumb.status === 200, `${promptWithThumb.thumb} -> ${thumb.status}`);
  } else {
    check('prompt index thumbnail resolves (SOW-031 fix)', false, 'no prompt with a thumb found');
  }

  // --- 2. Fail-closed negatives (no token required; always run) ---
  const noAuthStatus = await fetch(WORKER + '/membership/status');
  check('status fails closed without a token (401)', noAuthStatus.status === 401, String(noAuthStatus.status));

  const noAuthDecrypt = await fetch(WORKER + '/membership/decrypt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('decrypt fails closed without a token (401)', noAuthDecrypt.status === 401, String(noAuthDecrypt.status));

  // --- 3. Authenticated: oracle + a CREATE -> CONFIRM -> SCRUB activity cycle (needs a real token) ---
  const reg = createRegistry();
  if (!HAVE_TOKEN) {
    skip('status oracle authenticates the token', 'no real token (set E2E_TOKEN or run in CI with GH_BOT_TOKEN)');
    skip('activity favorite create + confirm + scrub', 'no real token');
  } else {
    const status = await getJson(WORKER + '/membership/status', { headers: authHeaders });
    check('status oracle authenticates the token', status.status === 200 && status.body?.ok === true, `login=${status.body?.login} status=${status.body?.status}`);

    const target = { type: 'prompt', slug: promptItems[0]?.slug };
    if (!target.slug) {
      skip('activity favorite create + confirm + scrub', 'no prompt slug available');
    } else {
      const baseline = await getJson(WORKER + '/membership/activity', { headers: authHeaders });
      const had = (baseline.body?.activity?.favorites || []).some((f) => f.type === target.type && f.slug === target.slug);
      if (had) {
        skip('activity favorite create + confirm + scrub', `the actor already favorites ${target.type}:${target.slug}; skipped to avoid clobbering real state`);
      } else {
        const add = await getJson(WORKER + '/membership/activity', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'favorite', type: target.type, slug: target.slug, on: true }) });
        // register the scrub BEFORE asserting, so a failed assert still cleans up.
        reg.register(`favorite ${target.type}:${target.slug}`, async () => {
          await fetch(WORKER + '/membership/activity', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'favorite', type: target.type, slug: target.slug, on: false }) });
        });
        const present = (add.body?.activity?.favorites || []).some((f) => f.type === target.type && f.slug === target.slug);
        const recorded = check('activity favorite recorded (create + confirm)', add.status === 200 && present, `favorites now ${(add.body?.activity?.favorites || []).length}`);
        const cr = await reg.cleanup(console.log);
        const finalAct = await getJson(WORKER + '/membership/activity', { headers: authHeaders });
        const stillThere = (finalAct.body?.activity?.favorites || []).some((f) => f.type === target.type && f.slug === target.slug);
        check('cleanup scrubbed the test favorite (zero leaks)', recorded && !stillThere && cr.leaked.length === 0, `leaked=${cr.leaked.length}`);
      }
    }
  }

  // --- summary ---
  const pass = results.filter((r) => r.state === 'pass').length;
  const fail = results.filter((r) => r.state === 'fail').length;
  const skipped = results.filter((r) => r.state === 'skip').length;
  console.log(`\n=== ${pass} passed, ${fail} failed, ${skipped} skipped (of ${results.length}) ===`);
  if (skipped) console.log('Skipped checks need a real token: set E2E_TOKEN=<gbtilabs or atwellpub GitHub token>, or run the e2e-smoke workflow.');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('E2E api-smoke crashed:', e?.message ?? e); process.exit(1); });
