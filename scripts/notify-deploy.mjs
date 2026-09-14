#!/usr/bin/env node
// sow-295: say in #github-events when a deploy changes what a shared surface serves in a way nobody could infer.
//
// On 2026-08-31 an owner-requested branch deploy was indistinguishable from an accident, so another session
// "fixed" it and ended the owner's test. This makes the intended ones visible: whoever looks at production can read
// who put which branch there, and how to put main back. It posts when:
//   - a branch reaches production (site or Worker), always
//   - production goes back to main after a branch was live (read from the live /build.json before deploying)
//   - a branch lands on the preview address, so two sessions do not overwrite each other's preview unawares
// An ordinary main deploy after a main deploy posts nothing: a channel that speaks on every push is noise.
//
// VISIBILITY, NOT CONTROL, like notify-privileged-push.mjs. The deploy already happened when this runs. It never
// fails the run: a red announcement step on a good deploy teaches everyone to ignore the step.
//
//   node scripts/notify-deploy.mjs read-live          -> writes ref=<branch production serves now> to $GITHUB_OUTPUT
//   node scripts/notify-deploy.mjs announce [--worker]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiscordClient } from '../clients/discord.mjs';
import { GITHUB_EVENTS_CHANNEL_ID } from './notify-workflow-failure.mjs';

const LIVE_BUILD_URL = 'https://gbti.network/build.json';
const PREVIEW_HOST = 'preview.gbti.network';

/** The notice for one finished deploy, or null when there is nothing a reader could not already assume. Pure. */
export function buildDeployMessage({ mode = '', branch = '', sha = '', actor = 'unknown', runUrl = '', prevRef = '', worker = false } = {}) {
  const short = String(sha).slice(0, 8);
  const run = runUrl ? `\n${runUrl}` : '';
  if (mode === 'branch-production') {
    const what = worker ? 'The live signup Worker' : 'Production (gbti.network)';
    const restore = worker ? 'run "Deploy signup Worker" from main' : 'run "Deploy to Cloudflare Pages" from main';
    return `**${what} now runs the branch \`${branch}\`** (\`${short}\`), deployed on purpose by \`${actor}\`.\n`
      + `This is not main. To put main back, ${restore}.${run}`;
  }
  if (mode === 'preview') {
    return `**${PREVIEW_HOST} now serves the branch \`${branch}\`** (\`${short}\`), deployed by \`${actor}\`. `
      + `Production is unchanged.${run}`;
  }
  if (mode === 'production' && !worker && prevRef && prevRef !== 'main') {
    return `**Production (gbti.network) is back on main** (\`${short}\`), replacing the branch \`${prevRef}\`, deployed by \`${actor}\`.${run}`;
  }
  return null;
}

/** Which branch the live site says it serves, or '' when it cannot tell (no stamp yet, or the fetch failed). */
export async function readLiveRef({ fetchImpl = globalThis.fetch, url = LIVE_BUILD_URL } = {}) {
  try {
    const res = await fetchImpl(`${url}?t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return '';
    const body = await res.json();
    return typeof body?.branch === 'string' && body.target === 'production' ? body.branch : '';
  } catch {
    return '';
  }
}

/** Post the notice. Resolves to a short status string; never rejects. */
export async function notifyDeploy({ env = process.env, worker = false, createClient = createDiscordClient, channelId = GITHUB_EVENTS_CHANNEL_ID } = {}) {
  try {
    const server = String(env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
    const runUrl = env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';
    const content = buildDeployMessage({
      mode: env.MODE, branch: env.REF_NAME, sha: env.GITHUB_SHA, actor: env.GITHUB_ACTOR, runUrl, prevRef: env.PREV_REF, worker,
    });
    if (!content) return 'skipped: nothing to announce';
    const botToken = String(env.DISCORD_BOT_TOKEN || '').trim();
    if (!botToken) return 'skipped: DISCORD_BOT_TOKEN is not set';
    await createClient({ botToken }).postChannelMessage(channelId, content);
    return `posted: ${env.MODE}`;
  } catch (err) {
    return `skipped: ${err?.message || err}`;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...flags] = process.argv.slice(2);
  if (cmd === 'read-live') {
    readLiveRef().then((ref) => {
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ref=${ref}\n`);
      console.log(`notify-deploy: production currently serves ${ref || '(unknown)'}`);
      process.exit(0);
    });
  } else if (cmd === 'announce') {
    notifyDeploy({ worker: flags.includes('--worker') }).then((status) => {
      console.log(`notify-deploy: ${status}`);
      process.exit(0); // ALWAYS zero, see the header.
    });
  } else {
    console.error('usage: notify-deploy.mjs read-live | announce [--worker]');
    process.exit(0);
  }
}
