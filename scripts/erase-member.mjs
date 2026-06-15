// SOW-024: the member right-to-erasure CLI. Prints the runbook and, on --apply, AUTO-DRIVES the safe/reversible
// erasure steps (the per-member KV deletes: activity + follows + lookup-cache; Discord role removal; a single
// auto-merged PR that drafts the member's content and removes their members-index entry) and records ONE
// identity-minimal entry to the deletable erasure audit log. The IRREVERSIBLE Stripe customer delete runs only
// behind the explicit --delete-stripe opt-in. Crypto-shred (the global SOW-016 key rotation), the overrides
// mirror refresh (reconcile), and de-index stay manual and are printed in the plan.
//
// Usage:
//   node scripts/erase-member.mjs --github-id 12345 [--username alice]                          # dry-run: print the plan
//   node scripts/erase-member.mjs --github-id 12345 --username alice --apply                    # enact the auto steps
//   node scripts/erase-member.mjs --github-id 12345 --username alice --apply --delete-stripe     # + delete the Stripe customer
//   node scripts/erase-member.mjs --github-id 12345 --apply --operator hudson                    # tag the audit record
//
// Dry-run is the default. The KV deletes + audit write need CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN;
// the content PR needs GITHUB_BOT_TOKEN + GITHUB_CONTENT_REPO; Discord needs DISCORD_BOT_TOKEN + the role/guild
// ids; Stripe needs STRIPE_SECRET_KEY. Any missing client makes its step a reported no-op, never a silent skip.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStripeClient } from '../clients/stripe.mjs';
import { createGitHubClient } from '../clients/github.mjs';
import { createDiscordClient } from '../clients/discord.mjs';
import { buildRepoIndex } from './lib/repo-content.mjs';
import { planErasure, runErasure } from './lib/erase-member.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

export function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const apply = argv.includes('--apply') && !argv.includes('--dry-run');
  return {
    githubId: get('--github-id'),
    username: get('--username'),
    operator: get('--operator'),
    apply,
    deleteStripe: argv.includes('--delete-stripe'),
  };
}

/** Build only the clients whose credentials are present, so a partial run (e.g. KV-only) still works. */
export function buildEraseClients(env, fetchImpl = globalThis.fetch) {
  return {
    stripe: env.STRIPE_SECRET_KEY ? createStripeClient({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl }) : null,
    github: env.GITHUB_BOT_TOKEN && env.GITHUB_CONTENT_REPO ? createGitHubClient({ token: env.GITHUB_BOT_TOKEN, repo: env.GITHUB_CONTENT_REPO, fetch: fetchImpl }) : null,
    discord: env.DISCORD_BOT_TOKEN ? createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl }) : null,
  };
}

async function main() {
  const { githubId, username, operator, apply, deleteStripe } = parseArgs(process.argv.slice(2));
  if (!githubId) {
    console.error('error: --github-id <id> is required');
    console.error('usage: node scripts/erase-member.mjs --github-id <id> [--username <name>] [--operator <id>] [--apply] [--delete-stripe]');
    process.exitCode = 1;
    return;
  }

  console.log(`\nRight-to-erasure for github_id=${githubId}${username ? ` (members/${username}/)` : ''}  [${apply ? 'APPLY' : 'DRY-RUN'}${deleteStripe ? ' +STRIPE' : ''}]\n`);
  for (const s of planErasure({ githubId, username })) {
    const mark = s.auto ? '[auto]' : '[manual]';
    console.log(`  ${mark.padEnd(10)} ${s.step.padEnd(14)} ${s.action}`);
  }
  console.log('');

  if (!apply) {
    console.log('Dry-run: nothing was changed. Re-run with --apply to enact the [auto] steps, then work the [manual] steps above.\n');
    return;
  }

  const env = process.env;
  const clients = buildEraseClients(env);
  // The member's content files for the draft-flip PR (read from the local checkout; empty when no folder).
  const files = username ? buildRepoIndex(ROOT).byUsername?.[username]?.files ?? [] : [];

  const result = await runErasure({ githubId, username, apply: true, deleteStripe, operator, env, clients, files });

  console.log('Enacted steps:');
  for (const s of result.steps) {
    console.log(`  ${s.outcome.padEnd(9)} ${s.step.padEnd(14)} ${s.detail ?? ''}`);
  }
  console.log('');
  if (result.audit?.recorded) console.log(`Audit: recorded ${result.audit.key} (status: ${result.record.status}).`);
  else console.log(`Audit: NOT recorded (${result.audit?.reason}). Record this erasure manually, outside Git, until CF creds are set.`);

  const errored = result.steps.filter((s) => s.outcome === 'error');
  if (errored.length) {
    console.error(`\n[error] ${errored.length} step(s) failed: ${errored.map((s) => s.step).join(', ')}. Re-run after fixing, or finish them by hand.`);
    process.exitCode = 1;
  }
  console.log('\nManual follow-ups: crypto-shred (scripts/rotate-member-key.mjs), re-run reconcile (overrides mirror), de-index (jsDelivr + search).\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
