#!/usr/bin/env node
// sow-298: tell somebody when a SCHEDULED workflow fails.
//
// WHY THIS EXISTS. On 2026-08-29 "Reconcile membership" started failing and nobody noticed for three days.
// Discord role sync, held-PR releases and trial reminders were all off that whole time. Two things hid it:
//
//   1. GitHub emails a scheduled workflow's failure to the account that LAST TOUCHED THE WORKFLOW FILE, not
//      to the repository owner. That was gbtilabs, an automation account whose inbox nobody reads.
//   2. The per-commit checks board stays fully GREEN through it, because a scheduled run is not attached to a
//      commit. Looking at the board is the natural way to ask "is main healthy", and it cannot see this class
//      of failure at all.
//
// So the alarm goes to a channel a person actually watches. Posting to #github-events needs no new credential:
// the bot token is already wired into these workflows and clients/discord.mjs already knows how to post.
//
// THIS SCRIPT NEVER FAILS THE JOB. It runs in an `if: failure()` step, so the job is already red and the
// operator already has one problem. A notifier that threw would turn that into two red steps and bury the
// original failure underneath its own stack trace, which is the opposite of what it is for.

import { createDiscordClient } from '../clients/discord.mjs';

// Non-secret production constant, inlined like the guild and role ids in reconcile.yml: acting on a channel
// id still requires the bot token, so the id alone grants nothing.
export const GITHUB_EVENTS_CHANNEL_ID = '1544443628678815846';

/**
 * The alert text, or null when there is not enough context to say anything useful.
 * Pure, so the wording is testable without a network or a token.
 */
export function buildFailureMessage(env = {}) {
  const workflow = String(env.GITHUB_WORKFLOW || '').trim();
  if (!workflow) return null;

  const repo = String(env.GITHUB_REPOSITORY || '').trim();
  const runId = String(env.GITHUB_RUN_ID || '').trim();
  const server = String(env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
  const sha = String(env.GITHUB_SHA || '').trim().slice(0, 8);
  const job = String(env.GITHUB_JOB || '').trim();
  const event = String(env.GITHUB_EVENT_NAME || '').trim();

  const lines = [`**Workflow failed: ${workflow}**`];
  if (job) lines.push(`Job: \`${job}\``);
  // The trigger is the part that says whether a human is already looking at this. A push failure has an
  // author watching; a schedule failure has nobody, which is the whole reason this notifier exists.
  if (event) lines.push(`Trigger: \`${event}\`${event === 'schedule' ? ' (nobody is watching this one)' : ''}`);
  if (sha) lines.push(`Commit: \`${sha}\``);
  if (repo && runId) lines.push(`${server}/${repo}/actions/runs/${runId}`);
  return lines.join('\n');
}

/** Post the alert. Resolves to a short status string; never rejects. */
export async function notifyWorkflowFailure({
  env = process.env,
  createClient = createDiscordClient,
  channelId = GITHUB_EVENTS_CHANNEL_ID,
} = {}) {
  try {
    const botToken = String(env.DISCORD_BOT_TOKEN || '').trim();
    // Unset token is a SKIP, not an error: a fork, or a workflow that has not been wired up yet, must not
    // gain a spurious second failure.
    if (!botToken) return 'skipped: DISCORD_BOT_TOKEN is not set';

    const content = buildFailureMessage(env);
    if (!content) return 'skipped: no GITHUB_WORKFLOW in the environment';

    const discord = createClient({ botToken });
    await discord.postChannelMessage(channelId, content);
    return 'posted';
  } catch (err) {
    // Swallowed deliberately. See the header: the job is already failing and this must not add noise.
    return `skipped: ${err?.message || err}`;
  }
}

// Only run when invoked directly, so the test can import the pure parts.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  notifyWorkflowFailure().then((status) => {
    console.log(`notify-workflow-failure: ${status}`);
    process.exit(0); // ALWAYS zero. The job's own failure is the signal, not this step's.
  });
}
