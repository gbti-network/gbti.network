#!/usr/bin/env node
// sow-298: announce direct pushes to main that touch a governance path.
//
// THIS IS VISIBILITY, NOT AN ACCESS CONTROL, AND NOTHING HERE SHOULD BE READ AS ONE. It runs AFTER the push
// has already landed. It cannot refuse anything, it cannot roll anything back, and a determined or careless
// change is not prevented by it. What it does is make the highest-privilege edits impossible to miss.
//
// WHY THIS SHAPE, RATHER THAN A BRANCH RULE. sow-298 Phase 3 measured `main` and found no required review and
// no required status check, so the SOW-005 gate is not enforced by anything at merge time. The obvious fix,
// requiring the gate's status check, was PROBED on a throwaway ruleset on 2026-09-01 and refuses direct
// pushes outright ("Required status check \"membership-gate\" is expected"). Every session here ships by
// pushing to main, and adding a repository-admin bypass to restore that exempts `gbtilabs`, which is both the
// admin and the identity the automation merges as, so the rule would bind nobody. There is no configuration
// that keeps the workflow and constrains merges. The owner chose to announce instead of block.
//
// It never fails the push. The push already happened; a throwing audit job would turn a healthy push into a
// red main and teach everyone to ignore the job.

import { createDiscordClient } from '../clients/discord.mjs';
import { SUPERADMIN_HOUSE_FILES } from '../membership/path-rank.mjs';
import { GITHUB_EVENTS_CHANNEL_ID } from './notify-workflow-failure.mjs';

export { GITHUB_EVENTS_CHANNEL_ID };

/**
 * Is this a GOVERNANCE path, meaning one CODEOWNERS pins to the two superadmins explicitly?
 *
 * DELIBERATELY NOT `rankForPath(p) === superadmin`, and this is the whole design decision. rankForPath fails
 * CLOSED: everything outside members/ and house/ ranks superadmin, which is correct for a merge gate and
 * catastrophic for an alert. It would fire on every ordinary push to src/, scripts/, workers/ or
 * package.json, which is most pushes, and a channel that alerts on everything is read as noise within a day.
 * That would be worse than no alert at all, because it looks like coverage.
 *
 * So this is the EXPLICIT pinned set only: the files a person deliberately marked as governance.
 */
export function isGovernancePath(p) {
  if (typeof p !== 'string' || p === '') return false;
  if (SUPERADMIN_HOUSE_FILES.has(p)) return true;
  if (p === 'CODEOWNERS') return true;
  if (p === '.github' || p.startsWith('.github/')) return true;
  if (p === 'house/applets' || p.startsWith('house/applets/')) return true;
  return false;
}

/** Parse the CHANGED_FILES convention (space or newline separated), as validate-content.mjs does. */
export function parseChangedFiles(raw) {
  return String(raw || '')
    .split(/[\s\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The governance subset of a push, in input order and de-duplicated. */
export function governancePathsIn(paths) {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(paths) ? paths : []) {
    if (!isGovernancePath(p) || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** The alert text, or null when the push touched no governance path. Pure, so the wording is testable. */
export function buildPrivilegedPushMessage(env = {}, paths = []) {
  const hits = governancePathsIn(paths);
  if (hits.length === 0) return null;

  const repo = String(env.GITHUB_REPOSITORY || '').trim();
  const actor = String(env.GITHUB_ACTOR || 'unknown').trim();
  const sha = String(env.GITHUB_SHA || '').trim();
  const server = String(env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
  const ref = String(env.GITHUB_REF_NAME || 'main').trim();

  const lines = [
    `**Governance paths changed on \`${ref}\` by \`${actor}\`**`,
    // Say what it is, every time. A reader six weeks from now should not have to infer whether this blocked
    // anything, and the answer is that it never does.
    'Audit notice only. This push already landed; nothing was blocked.',
    ...hits.map((p) => `- \`${p}\``),
  ];
  if (repo && sha) lines.push(`${server}/${repo}/commit/${sha}`);
  return lines.join('\n');
}

/** Post the alert. Resolves to a short status string; never rejects. */
export async function notifyPrivilegedPush({
  env = process.env,
  createClient = createDiscordClient,
  channelId = GITHUB_EVENTS_CHANNEL_ID,
  paths = null,
} = {}) {
  try {
    const changed = paths ?? parseChangedFiles(env.CHANGED_FILES);
    const content = buildPrivilegedPushMessage(env, changed);
    // The common case by far: an ordinary push touching no governance path. Silence is correct here.
    if (!content) return 'skipped: no governance paths in this push';

    const botToken = String(env.DISCORD_BOT_TOKEN || '').trim();
    if (!botToken) return 'skipped: DISCORD_BOT_TOKEN is not set';

    const discord = createClient({ botToken });
    await discord.postChannelMessage(channelId, content);
    return `posted: ${governancePathsIn(changed).length} governance path(s)`;
  } catch (err) {
    return `skipped: ${err?.message || err}`;
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  notifyPrivilegedPush().then((status) => {
    console.log(`notify-privileged-push: ${status}`);
    process.exit(0); // ALWAYS zero. See the header: this must never red a push that already succeeded.
  });
}
