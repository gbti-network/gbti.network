// Reconcile enactment (SOW-005): carries out the planner's actions through the GitHub, Discord and Resend
// clients (the ban content flip, role swaps, reminders), plus the SOW-053 conflict sweep. Split out of
// scripts/reconcile.mjs at the 900-line limit; reconcile.mjs re-exports flipStatus, surfaceConflicts and
// enactPlan, so existing importers keep working. No top-level side effects.

import crypto from 'node:crypto';
import { mergeState, alreadyLabeled, conflictComment, CONFLICT_LABEL, isStuckAutomergeBot } from './pr-conflict.mjs';

/** Base64 a string for the GitHub Contents API putContent({ content }). */
function toBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

/**
 * Flip the `status:` frontmatter line of a content file between published and draft, returning the new
 * text. Reuses the same line shape as scripts/validate-content.mjs. If the line is missing we leave the
 * file untouched (the planner should not have selected it, but we stay safe).
 */
export function flipStatus(text, to) {
  // [ \t]* (not \s*) so the trailing newline is preserved; \s would eat the line break.
  return text.replace(/^(status:[ \t]*)"?(published|draft)"?[ \t]*$/m, `$1${to}`);
}

/**
 * A branch name for a content flip PR (one per member per run kind). The timestamp has 1-second
 * resolution, so a same-second re-run would collide and createRef would 422. A short random suffix
 * keeps the branch unique across re-runs.
 */
function flipBranch(kind, githubId) {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const suffix = crypto.randomUUID().slice(0, 8);
  return `reconcile/${kind}-${githubId}-${stamp}-${suffix}`;
}

/**
 * Enact a single content action as ONE auto-merged PR that flips every selected file's `status`. The bot
 * is listed as admin in roles.yml, so the PR-gate passes it (it never runs PR code; this is a base-branch
 * metadata-only gate). We open the PR off a fresh branch, commit each file flip, then squash-merge.
 *
 * sow-197: `draft` is the ONLY content action, and this shell refuses anything else rather than defaulting
 * to publish. The planner no longer emits a publish action; this makes the enactment side incapable of
 * resurrecting one, so a future planner bug cannot quietly push a member's unfinished draft live again.
 */
async function enactContent(github, action, { base = 'main' } = {}) {
  if (action.type !== 'draft') {
    throw new Error(`reconcile: refusing content action '${action.type}': only 'draft' (ban enforcement) is permitted`);
  }
  const to = 'draft';
  const branch = flipBranch(action.type, action.githubId);

  // 1. Branch off the base head.
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`reconcile: cannot resolve base head sha for ${base}`);
  await github.createRef(branch, baseSha);

  // 2. Flip each file on the new branch.
  for (const filePath of action.files) {
    const existing = await github.getContent(filePath, branch);
    const sha = existing?.sha;
    const current = existing?.content ? Buffer.from(existing.content, 'base64').toString('utf8') : '';
    const next = flipStatus(current, to);
    if (next === current) continue; // already in the desired state: skip (idempotent)
    await github.putContent(filePath, {
      message: `reconcile: ${action.type} ${filePath} (membership state)`,
      content: toBase64(next),
      branch,
      sha,
    });
  }

  // 3. Open + squash-merge the PR. The gate passes the admin bot, so this auto-merges.
  const pull = await github.createPull({
    title: `reconcile: Disable ${action.username ?? action.githubId} content (ban)`,
    head: branch,
    base,
    body:
      `Automated ban enforcement. Flips status -> draft for ${action.files.length} file(s) ` +
      `owned by github_id ${action.githubId}. Never deletes content; lifting the ban does not ` +
      `re-publish automatically, the author republishes their own work.`,
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return pull.number;
}

/** Discord role id lookup from env for a planner role name. */
function discordRoleId(role, env) {
  if (role === 'member') return env.DISCORD_MEMBER_ROLE_ID;
  if (role === 'trial') return env.DISCORD_TRIAL_ROLE_ID;
  if (role === 'locked') return env.DISCORD_LOCKED_ROLE_ID;
  if (role === 'creator') return env.DISCORD_CREATOR_ROLE_ID; // sow-185: the stackable Content-Creator badge (unset -> enactDiscord skips)
  return null;
}

/** Enact a single Discord role action. */
async function enactDiscord(discord, action, env) {
  const guildId = env.DISCORD_GUILD_ID;
  const roleId = discordRoleId(action.role, env);
  if (!guildId || !roleId) return; // missing config: skip rather than throw on a partial run
  try {
    if (action.type === 'add-role') await discord.addRole(guildId, action.discordUserId, roleId);
    else await discord.removeRole(guildId, action.discordUserId, roleId);
  } catch (e) {
    // Best-effort: a role op fails when the member is not in the guild (a grandfathered co-op member who
    // was granted access but never joined Discord) or on a transient Discord error. Log and continue so one
    // bad role op does not abort the rest of the run (content flips, the KV mirror, other members' roles).
    console.warn(
      `reconcile: WARNING Discord ${action.type} role=${action.role} for ${action.discordUserId} failed: ${e?.message ?? e}`,
    );
  }
}

/**
 * Enact a day-87 reminder. Email (Resend) is the PRIMARY channel because Discord server-member DMs
 * are widely disabled by default and would silently vanish (see membership-and-access.md section 0).
 * The Discord DM is an optional secondary nudge. Email is attempted first when a Resend client and a
 * recipient address exist.
 */
async function enactReminder(action, { resend, discord, env = {} } = {}) {
  // SOW-119: the coupon-expiry nudge reuses the same delivery (email primary, Discord DM secondary).
  const isCoupon = action.type === 'coupon-expiry';
  const untilDate = isCoupon && action.until ? action.until.slice(0, 10) : null;
  const body = isCoupon
    ? `Your complimentary GBTI Network membership ends on ${untilDate}. Add a membership to keep your ` +
      'profile, posts, projects, and prompts published and to stay in the community. Visit your account ' +
      'to add a membership before it ends.'
    : 'Your GBTI Network trial ends in a few days. Add a membership to keep your profile, posts, ' +
      'projects, and prompts published. Visit your account to add a membership before day 90.';
  const subject = isCoupon
    ? 'Your complimentary GBTI Network membership ends soon'
    : 'Your GBTI Network trial ends soon: add a membership to stay published';

  // PRIMARY: email via Resend when configured and the action carries a recipient address.
  if (resend && env.RESEND_FROM && action.email) {
    await resend.sendEmail({
      from: env.RESEND_FROM,
      to: action.email,
      subject,
      text: body,
    });
  }

  // SECONDARY (optional): a Discord DM nudge when we have a Discord user id.
  if (discord && action.discordUserId) {
    await discord.sendDirectMessage(action.discordUserId, body);
  }
}

/** Human-readable one-liner per action for the printed summary. */
export function describe(action) {
  switch (action.kind) {
    case 'content':
      return `content  ${action.type.padEnd(8)} ${action.username ?? action.githubId}  (${action.files.length} file(s))`;
    case 'discord':
      return `discord  ${action.type.padEnd(8)} ${action.githubId}  role=${action.role}`;
    case 'reminder':
      return `reminder day-87    ${action.githubId}  email=${action.email ?? 'none'}`;
    case 'block':
      return `block    banned     ${action.username ?? action.githubId}`;
    case 'unresolved':
      return `UNRESOLVED ${String(action.status).padEnd(8)} ${action.githubId}  ${action.reason}`;
    default:
      return `unknown  ${JSON.stringify(action)}`;
  }
}

/**
 * SOW-053 Part B: sweep open PRs and surface true merge conflicts. Auto-merge stalls SILENTLY on a conflicting
 * member PR; this adds a `needs-rebase` label + a one-time @-mention comment telling the author to re-publish
 * (which reloads the fresh file + clears the conflict). Idempotent (skips an already-labeled PR) and fail-soft
 * (any GitHub error is swallowed so the conflict sweep never breaks the rest of reconcile). The list endpoint omits
 * mergeable_state, so each open PR is fetched once via getPull. Returns { surfaced, stuck }: `surfaced` = the
 * newly labeled+commented conflicts; `stuck` (SOW-152) = conflicting BOT superadmin-automerge PRs that the
 * auto-merge cannot land and the re-publish comment cannot fix (collected EVEN IF already needs-rebase-labeled,
 * so a persistently-stuck one stays visible in the summary instead of piling up silently).
 */
export async function surfaceConflicts({ github, dryRun = true } = {}) {
  const surfaced = [];
  const stuck = [];
  if (!github?.listOpenPulls) return { surfaced, stuck };
  let open;
  try { open = await github.listOpenPulls(); } catch { return { surfaced, stuck }; }
  for (const p of open || []) {
    let pull;
    try { pull = await github.getPull(p.number); } catch { continue; } // mergeable_state only on the single-PR GET
    if (mergeState(pull) !== 'conflicting') continue;
    const login = pull.user?.login || p.user?.login || '';
    // SOW-152: surface a stuck bot auto-merge PR distinctly, before the already-labeled skip, so it stays visible.
    if (isStuckAutomergeBot(pull)) stuck.push({ number: pull.number, login });
    if (alreadyLabeled(pull)) continue;
    surfaced.push({ number: pull.number, login });
    if (dryRun) continue;
    try {
      await github.addLabels(pull.number, [CONFLICT_LABEL]);
      await github.comment(pull.number, conflictComment(login));
    } catch (e) {
      console.error(`reconcile: WARNING could not surface conflict on PR #${pull.number}: ${e?.message ?? e}`);
    }
  }
  return { surfaced, stuck };
}

/**
 * Enact the full plan via the clients. Returns { counts, failures }.
 *
 * sow-198: every action is ISOLATED. A failure is logged against the action that caused it and the plan
 * continues, exactly as every sync step in main() already behaves. Before this, one throw abandoned every
 * remaining action, so a single failed content flip could silently skip the Discord role swaps and the
 * day-87 reminders queued behind it. That half-apply is precisely what made the 2026-08-08 run
 * unrecoverable: it died on the last step with no record of what it had done.
 *
 * `counts` still counts ATTEMPTS per kind, so the summary line reports the plan that was run. `failures`
 * carries what went wrong so main() can exit non-zero without losing the summary.
 */
export async function enactPlan(actions, { github, discord, resend }, env) {
  const counts = {};
  const failures = [];
  for (const action of actions) {
    counts[action.kind] = (counts[action.kind] ?? 0) + 1;
    try {
      if (action.kind === 'content') await enactContent(github, action);
      else if (action.kind === 'discord' && discord) await enactDiscord(discord, action, env);
      else if (action.kind === 'reminder') await enactReminder(action, { resend, discord, env });
      // 'block' is enacted by re-running the gate / branch protection; the reconcile logs it. The
      // content draft + role removal for a banned member are emitted as their own actions above.
    } catch (e) {
      const message = e?.message ?? String(e);
      console.error(`reconcile: action FAILED (${describe(action)}): ${message}`);
      failures.push({ action, message });
    }
  }
  return { counts, failures };
}
