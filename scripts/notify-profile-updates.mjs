#!/usr/bin/env node
// sow-329: email the owner when a member's profile changes on main. Run by .github/workflows/profile-update-alert.yml
// on every push to main that touches members/*/profile.md; the rendering and the diff live in
// scripts/lib/profile-update-notice.mjs.
//
//   node scripts/notify-profile-updates.mjs --before <sha> --after <sha>          # dry run: print the email
//   node scripts/notify-profile-updates.mjs --apply                               # send (reads PROFILE_BEFORE/AFTER)
//
// Env: PROFILE_BEFORE, PROFILE_AFTER (the push range), RESEND_API_KEY, ALERT_EMAIL (the recipient), RESEND_FROM
// (the sender, defaulting to noreply@gbti.network), GITHUB_REPOSITORY (for the GitHub links).
//
// FAIL SOFT, AND IT ALWAYS EXITS ZERO. The profile is already public by the time this runs, so there is nothing to
// protect by failing the run, and a red run over a mail problem would be noise on the checks board. This differs
// on purpose from scripts/check-credentials.mjs, whose red run IS its backup signal.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResendClient } from '../clients/resend.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';
import { selectProfileChanges, profileUpdateNotice } from './lib/profile-update-notice.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parse `--apply`, `--before <sha>` and `--after <sha>` (also `--before=<sha>`). */
export function parseArgs(argv = []) {
  const out = { apply: false, before: null, after: null };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--apply') out.apply = true;
    else if (a === '--before' || a === '--after') { out[a.slice(2)] = argv[i + 1] ?? null; i++; }
    else if (a.startsWith('--before=')) out.before = a.slice('--before='.length);
    else if (a.startsWith('--after=')) out.after = a.slice('--after='.length);
  }
  return out;
}

/**
 * Select the push's profile changes and send (or print) one email. Every collaborator is injectable so the whole
 * run is unit-tested without git, a network or a real inbox. Returns a result object; never throws.
 */
export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  runGit,
  parseFile = parseContentFile,
  sendEmail,
  log = console.log,
  warn = console.error,
} = {}) {
  const args = parseArgs(argv);
  const before = args.before ?? env.PROFILE_BEFORE ?? null;
  const after = args.after ?? env.PROFILE_AFTER ?? null;
  const repo = env.GITHUB_REPOSITORY || 'gbti-network/gbti.network';

  let changes;
  try { changes = selectProfileChanges({ before, after, root: ROOT, runGit, parseFile }); }
  catch (err) { warn(`profile update alert: could not read the push (${err?.message || err})`); return { sent: false, reason: 'select-failed', changes: 0 }; }

  if (!changes.length) {
    log(before && after ? 'No member profile changed in this push; nothing to send.' : 'No push range given; nothing to send.');
    return { sent: false, reason: 'no-changes', changes: 0 };
  }

  const notice = profileUpdateNotice(changes, { repo, before, after });
  if (!args.apply) {
    log(`DRY RUN (nothing sent). ${changes.length} profile change(s).\n\nSubject: ${notice.subject}\n\n${notice.text}`);
    return { sent: false, reason: 'dry-run', changes: changes.length, notice };
  }

  const to = env.ALERT_EMAIL;
  const from = env.RESEND_FROM || 'noreply@gbti.network';
  if (!to || (!env.RESEND_API_KEY && typeof sendEmail !== 'function')) {
    warn('profile update alert: no email sent (set RESEND_API_KEY and ALERT_EMAIL to enable).');
    return { sent: false, reason: 'unconfigured', changes: changes.length };
  }

  let send = sendEmail;
  if (typeof send !== 'function') {
    const client = createResendClient({ apiKey: env.RESEND_API_KEY });
    send = (message) => client.sendEmail(message);
  }
  try {
    await send({ from, to, subject: notice.subject, text: notice.text, html: notice.html });
    log(`profile update alert: sent "${notice.subject}" (${changes.length} profile change(s)).`);
    return { sent: true, changes: changes.length };
  } catch (err) {
    warn(`profile update alert: Resend email FAILED (${err?.message || err}).`);
    return { sent: false, reason: 'send-failed', changes: changes.length };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(() => process.exit(0), (err) => {
    console.error(`profile update alert: unexpected error (${err?.message || err}).`);
    process.exit(0);
  });
}
