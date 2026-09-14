#!/usr/bin/env node
// sow-295: what a deploy run may send where, decided before anything is built.
//
// THE HOLE. deploy.yml accepted `workflow_dispatch` from ANY ref and always ran `pages deploy --branch=main`, so any
// branch in the repository was one manual dispatch away from being production. On 2026-08-31 that happened four
// times, at the owner's request, to test a member-gated feature on the live site. Another session saw an unmerged
// build live, correctly read it as an anomaly, restored main, and ended the owner's test. Both sessions followed the
// rules. The failure was that an intended branch deploy and an accident looked identical.
//
// SO THE REQUIREMENT IS NOT "FORBID IT" (owner decision 2026-09-14). A refusal alone pushes the same need onto a
// direct `wrangler pages deploy`, which leaves no trace at all. The rules:
//   - a push to main deploys production (the ordinary path)
//   - a dispatch from main to production deploys production (the recovery path, unchanged)
//   - a dispatch with target=preview deploys to the `preview` branch alias, from any branch, never touching
//     production (preview.gbti.network, which can sign in; see sow-295)
//   - a dispatch from any other branch to production runs ONLY when confirm_branch repeats the branch name, and is
//     then announced (scripts/notify-deploy.mjs); otherwise the run fails red before building anything
// deploy-worker.yml uses the same rules with `--worker`, which has no preview target.
//
// Every input arrives through `env`, never interpolated into the shell (test/workflow-input-injection.test.mjs):
// a branch name may legally contain `$(`.
//
//   node scripts/deploy-target.mjs guard [--worker]   -> writes mode / deploy_branch / branch to $GITHUB_OUTPUT
//   node scripts/deploy-target.mjs stamp              -> writes dist/build.json; adds noindex to a preview build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_BRANCH = 'main';
export const PREVIEW_BRANCH = 'preview';

/**
 * Decide one run. Returns { ok: true, mode, deployBranch, branch } or { ok: false, message }.
 * mode: 'production' (main) | 'branch-production' (a confirmed branch) | 'preview'.
 */
export function decide({ event = '', ref = '', target = '', confirm = '', worker = false } = {}) {
  const branch = String(ref).trim();
  const want = String(target).trim() || 'production';
  if (!branch) return { ok: false, message: 'no ref name was given, so there is nothing safe to deploy' };

  if (event === 'push') {
    if (branch === PRODUCTION_BRANCH) return { ok: true, mode: 'production', deployBranch: PRODUCTION_BRANCH, branch };
    return { ok: false, message: `a push deploys only ${PRODUCTION_BRANCH}; this push was to ${branch}` };
  }
  if (event !== 'workflow_dispatch') return { ok: false, message: `a deploy runs on a push to ${PRODUCTION_BRANCH} or a manual dispatch, not on ${event || 'an unknown event'}` };

  if (want === 'preview') {
    if (worker) return { ok: false, message: 'the Worker has no preview target; it deploys production only' };
    return { ok: true, mode: 'preview', deployBranch: PREVIEW_BRANCH, branch };
  }
  if (want !== 'production') return { ok: false, message: `unknown target "${want}" (production or preview)` };

  if (branch === PRODUCTION_BRANCH) return { ok: true, mode: 'production', deployBranch: PRODUCTION_BRANCH, branch };
  if (String(confirm).trim() === branch) return { ok: true, mode: 'branch-production', deployBranch: PRODUCTION_BRANCH, branch };
  const what = worker ? 'the live signup Worker' : 'production (gbti.network)';
  const alt = worker ? '' : ` To test it without touching the live site, run it with target "${PREVIEW_BRANCH}" instead.`;
  return {
    ok: false,
    message: `this run would send the branch "${branch}" to ${what}. Nothing was deployed. `
      + `To do that on purpose, run it again with confirm_branch set to exactly "${branch}"; the deploy is then announced in #github-events.${alt}`,
  };
}

/** The public record of what a deploy serves: dist/build.json. */
export function buildStamp({ sha = '', branch = '', mode = '', runId = '', runUrl = '', now = new Date() } = {}) {
  return { commit: sha, branch, target: mode === 'preview' ? PREVIEW_BRANCH : 'production', mode, run: runId, runUrl, builtAt: now.toISOString() };
}

/** A preview build must not be indexed: append a site-wide noindex rule to Cloudflare's _headers. */
export const NOINDEX_RULE = '\n# sow-295: a preview build (preview.gbti.network) is never indexed.\n/*\n  X-Robots-Tag: noindex\n';
export function withNoindex(headers) {
  const base = String(headers ?? '');
  return base.includes('X-Robots-Tag: noindex') ? base : base.replace(/\n*$/, '\n') + NOINDEX_RULE;
}

function writeOutputs(outputs, file) {
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  if (file) fs.appendFileSync(file, lines);
  else process.stdout.write(lines);
}

export function runGuard({ env = process.env, worker = false, log = console } = {}) {
  const r = decide({ event: env.EVENT_NAME, ref: env.REF_NAME, target: env.TARGET, confirm: env.CONFIRM_BRANCH, worker });
  if (!r.ok) {
    log.error(`::error title=Deploy refused::${r.message}`);
    return 1;
  }
  writeOutputs({ mode: r.mode, deploy_branch: r.deployBranch, branch: r.branch }, env.GITHUB_OUTPUT);
  log.log(`deploy-target: ${r.mode} (branch ${r.branch} -> Pages branch ${r.deployBranch})`);
  return 0;
}

export function runStamp({ env = process.env, distDir = 'dist', now = new Date(), log = console } = {}) {
  const stamp = buildStamp({ sha: env.SHA, branch: env.REF_NAME, mode: env.MODE, runId: env.RUN_ID, runUrl: env.RUN_URL, now });
  fs.writeFileSync(path.join(distDir, 'build.json'), JSON.stringify(stamp, null, 2) + '\n');
  if (env.MODE === 'preview') {
    const file = path.join(distDir, '_headers');
    fs.writeFileSync(file, withNoindex(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''));
  }
  log.log(`deploy-target: stamped ${stamp.target} build of ${stamp.branch} at ${stamp.commit.slice(0, 8)}`);
  return 0;
}

/** The run's step summary: what it decided and whether the upload happened. Pure, so the wording is testable. */
export function summaryMarkdown({ mode = '', branch = '', sha = '', outcome = '' } = {}) {
  const where = { production: 'production (gbti.network)', 'branch-production': 'production (gbti.network), a CONFIRMED branch deploy', preview: 'preview.gbti.network' }[mode];
  const lines = ['## Site deploy', ''];
  if (!where) lines.push(`Refused before building: the branch \`${branch}\` was not deployed. The error above says why and how to do it on purpose.`);
  else lines.push(`Target: ${where}`, '', `Branch: \`${branch}\``, '', `Commit: \`${sha}\``, '', `Upload: ${outcome || 'not reached'}`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...flags] = process.argv.slice(2);
  if (cmd === 'guard') process.exit(runGuard({ worker: flags.includes('--worker') }));
  else if (cmd === 'stamp') process.exit(runStamp());
  else if (cmd === 'summary') {
    const md = summaryMarkdown({ mode: process.env.MODE, branch: process.env.REF_NAME, sha: process.env.SHA, outcome: process.env.DEPLOY_OUTCOME });
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); else process.stdout.write(md);
    process.exit(0);
  } else { console.error('usage: deploy-target.mjs guard [--worker] | stamp | summary'); process.exit(2); }
}
