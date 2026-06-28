#!/usr/bin/env node
// SOW-076 Phase 3: post-publish content validation + auto-flip-to-draft remediation. Runs on push to main (the
// .github/workflows/post-publish-remediate.yml job). content-check already validates + alarms on push; an item that
// auto-merged BEFORE its PR content-check finished could be invalid + public. This validates the pushed content and
// flips any offending PUBLISHED item to draft via an auto-merged bot PR (reversible -- the author fixes + re-publishes),
// so invalid content does not stay public; other (global / un-auto-remediable) failures fail the job so the owner is
// notified. Fail closed: no bot token -> a reported no-op (the validation still ran).
//   node scripts/remediate-published.mjs            # dry-run: print the plan
//   node scripts/remediate-published.mjs --apply    # flip the offending published items to draft
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createGitHubClient } from '../clients/github.mjs';
import { planRemediation, flipFilesToDraft } from './lib/post-publish-remediation.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const CONTENT_FILE = /^(members\/[^/]+|house)\/(posts|products|prompts)\/[^/]+\/index\.md$/;

export function changedContentFiles(env) {
  return String(env.CHANGED_FILES || '').trim().split(/\s+/).filter((f) => CONTENT_FILE.test(f));
}

/** The subset of `files` whose frontmatter is `status: published` (only those are flippable + worth remediating). */
export function publishedAmong(files, { root = ROOT, readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  const out = new Set();
  for (const f of files) {
    let fm = '';
    try { fm = (readFile(path.join(root, f)).match(/^---\n([\s\S]*?)\n---/) || [])[1] || ''; } catch { continue; }
    if (/^status:\s*['"]?published['"]?\s*$/m.test(fm)) out.add(f);
  }
  return out;
}

function runValidation(env, changed) {
  const r = spawnSync('node', [path.join(ROOT, 'scripts/validate-content.mjs'), '--json'], {
    env: { ...env, CHANGED_FILES: changed.join(' ') }, encoding: 'utf8',
  });
  try { return JSON.parse(r.stdout); } catch { return { ok: r.status === 0, errors: [] }; }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const env = process.env;
  const changed = changedContentFiles(env);
  if (!changed.length) { console.log('remediate: no changed content files to validate.'); return; }

  const { ok, errors } = runValidation(env, changed);
  if (ok) { console.log(`remediate: ${changed.length} changed content file(s) valid. Nothing to remediate.`); return; }

  const publishedFiles = publishedAmong(changed);
  const { flip, alertOnly } = planRemediation({ errors, publishedFiles });

  for (const e of alertOnly) console.log(`  alert ${e.file || '(global)'}: ${e.message}`);
  for (const f of flip) console.log(`  flip-to-draft ${f}`);
  console.log(`remediate: ${flip.length} published item(s) to flip, ${alertOnly.length} alert(s).`);

  let flipOk = true;
  if (flip.length && apply) {
    const github = env.GITHUB_BOT_TOKEN && env.GITHUB_CONTENT_REPO
      ? createGitHubClient({ token: env.GITHUB_BOT_TOKEN, repo: env.GITHUB_CONTENT_REPO, fetch: globalThis.fetch })
      : null;
    const r = await flipFilesToDraft({ github, files: flip });
    console.log(`remediate: ${r.skipped ? `SKIPPED (${r.reason})` : r.error ? `ERROR (${r.error})` : `flipped ${r.flipped} item(s)${r.pr ? ` (PR #${r.pr})` : ''}`}.`);
    flipOk = !r.error && !r.skipped;
  } else if (flip.length) {
    console.log('remediate: DRY RUN (no flip). Re-run with --apply to enact.');
  }
  // Fail the job (notifying the owner) ONLY for un-auto-remediable errors (global / draft / non-content) or a failed
  // flip. A clean auto-remediation succeeds: content-check.yml already alarmed on the validation failure itself, so
  // the owner is not double-pinged when the published items were flipped away cleanly.
  if (alertOnly.length || !flipOk) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('remediate: failed:', err?.message ?? err); process.exit(1); });
}
