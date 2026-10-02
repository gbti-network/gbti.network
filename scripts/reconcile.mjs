#!/usr/bin/env node
// SOW-005 reconciliation script. Brings the published-content state + Discord roles in line with the
// Stripe registry plus git-native overrides (bans, grandfather). Runs locally (owner runs --dry-run
// first, then --apply) and on a daily schedule (.github/workflows/reconcile.yml runs it with --apply).
//
//   node scripts/reconcile.mjs            # DRY RUN by default: prints the plan, changes nothing
//   node scripts/reconcile.mjs --apply    # enacts the plan via the GitHub / Discord clients
//   node scripts/reconcile.mjs --dry-run  # explicit dry run
//
// Design: all decision logic is the PURE planReconcile (scripts/lib/reconcile-plan.mjs). This file is
// the thin I/O shell: build clients, gather inputs (Stripe customers + local content index +
// overrides), call the planner, then (unless dry-run) enact each action. Idempotent: re-running after
// a successful apply yields an empty plan.
//
// Fail closed: deriveStatusFromCustomer + effectiveStatus already treat any missing or error state as
// NOT paid. sow-197 narrowed what that costs: a lapse moves the member to the Locked Discord role and
// leaves their published work alone. Only a BAN drafts content, and only ever toward draft, never back.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { createStripeClient } from '../clients/stripe.mjs';
import { createGitHubClient } from '../clients/github.mjs';
import { createDiscordClient } from '../clients/discord.mjs';
import { createGoogleCalendarClient } from '../clients/google-calendar.mjs';           // sow-314
import { stripeModeNote } from '../membership/stripe-mode.mjs';                       // sow-314 follow-up
import { runShoptalkSweep, describeSweep } from './lib/shoptalk-sweep.mjs';            // sow-314
import { readPlaced, writePlaced, readOptedOut, readSeen, writeSeen } from './lib/shoptalk-state.mjs'; // sow-314
import { createResendClient } from '../clients/resend.mjs';
import { STATUS } from '../membership/derive-status.mjs';
import { loadOverrides, loadOverridesRaw, ROLE } from '../membership/overrides.mjs';
import { buildRepoIndex } from './lib/repo-content.mjs';
import { planReconcile } from './lib/reconcile-plan.mjs';
import { buildOverridesMirror, mirrorOverridesToKv, mirrorSyndicationConfigToKv, mirrorContentChannelsToKv, mirrorTopicsToKv, mirrorMailSettingsToKv, mirrorDigestEntitlementToKv, mirrorCouponsToKv, mirrorDigestConfigToKv, gitOwnedSections, loadCouponsRaw, readOverridesMirrorRest } from './lib/kv-mirror.mjs';
import { applyOverridesSource, overrideFilesPresent } from './lib/overrides-source.mjs'; // sow-213 R4: KV overrides overlay for the plan + the git-present reality check behind reconcile's fail posture
import { syncFavoriteCounts, readCountsFromDisk, readFavoritedByFromDisk, readMembersIndexFromDisk } from './lib/favorite-counts.mjs';
import { syncOutboundClicks, readClicksFromDisk } from './lib/outbound-clicks.mjs'; // sow-289: the daily outbound click rollup
import { outboundRows } from './lib/outbound-links-store.mjs'; // sow-289: the paths the rollup queries, from the store, never a prefix
import { syncCouponGrants, readGrandfatheredFromDisk, readCouponsFromDisk, listCouponRedemptions, planCouponGrants } from './lib/coupon-grants.mjs'; // SOW-119 (+ sow-218: pre-apply, sow-185: explicit tier)
import { syncEnrollments } from './lib/enroll-members.mjs'; // SOW-157: hosted-member index enrollment
import { syncStarterProfiles } from './lib/starter-profiles.mjs'; // sow-439: a starter profile page for every paying member
import { syncFollowerIndex } from './lib/follower-index.mjs'; // SOW-186 phase 3: build/heal followers:<github_id> from the forward graph
// Member gathering and plan enactment live in these two modules (split out at the 900-line limit). Every public
// name that moved is re-exported here, so importers of scripts/reconcile.mjs keep working.
import { gatherMembers, gatherOverrideOnlyMembers, gatherTargetedMember, shouldSyncCreatorRole } from './lib/reconcile-members.mjs';
import { describe, enactPlan, surfaceConflicts } from './lib/reconcile-enact.mjs';
export {
  resolveUsername, memberEntryFor, couponGrantFor, parseDiscordUserMap, resolveDiscordRoles, shouldSyncCreatorRole,
  gatherMembers, gatherOverrideOnlyMembers, gatherTargetedMember,
} from './lib/reconcile-members.mjs';
export { flipStatus, surfaceConflicts, enactPlan } from './lib/reconcile-enact.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

/** Parse argv into { apply } where dry-run is the default unless --apply is given. */
export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run') || !apply; // default to dry-run
  return { apply: apply && !argv.includes('--dry-run'), dryRun };
}

/** Build the clients from env. Returns { stripe, github, discord, resend }. */
export function buildClients(env, fetchImpl = globalThis.fetch) {
  const stripe = createStripeClient({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl });
  const github = createGitHubClient({ token: env.GITHUB_BOT_TOKEN, repo: env.GITHUB_CONTENT_REPO, fetch: fetchImpl });
  const discord = env.DISCORD_BOT_TOKEN ? createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl }) : null;
  const resend = env.RESEND_API_KEY ? createResendClient({ apiKey: env.RESEND_API_KEY, fetch: fetchImpl }) : null;
  return { stripe, github, discord, resend };
}

/**
 * Parse the targeted github_id from a repository_dispatch event payload (FIX 4). The signup Worker
 * fires repository_dispatch type 'regate' with client_payload.github_id after a payment so a single
 * member is reconciled immediately instead of waiting for the daily run. Returns the github_id string
 * or null when the event is not a usable regate dispatch.
 */
export function targetedGithubId(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== 'repository_dispatch') return null;
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  } catch {
    return null;
  }
  const id = payload?.client_payload?.github_id;
  return id != null ? String(id) : null;
}

/**
 * sow-218: merge coupon grants that KV knows about but `house/grandfathered.yml` does not yet carry into the
 * in-memory overrides for THIS run. See the call site for why the durable PR fold cannot do this itself.
 *
 * Mutates `overrides.grandfathers`, which is the same Map `effectiveStatus` consults, so a fresh invitee
 * resolves effective-paid on the first run: they get @Member, they enroll into members-index, and they can
 * publish. It only ever ADDS a grant the fold is about to write anyway, so it cannot grant anything the next
 * run would take back, and it never overwrites an entry that already exists (planCouponGrants skips those,
 * including a hand-set bounded comp).
 *
 * Exported for tests. Returns the number of grants applied.
 */
export async function applyPendingCouponGrants({
  overrides, env = process.env, now = new Date(), listRedemptions = listCouponRedemptions, readGrandfathered = null, root = ROOT,
} = {}) {
  if (!overrides?.grandfathers) return 0;
  let grants = [];
  try {
    const kv = await listRedemptions({ env });
    if (!kv?.available || !Array.isArray(kv.redemptions) || kv.redemptions.length === 0) return 0;
    // THE ALREADY-FOLDED SET IS READ FROM THE KV MIRROR, the same document the durable fold below diffs
    // against, so both paths see one set of grants and one answer per member.
    //
    // 2026-09-10: this read house/grandfathered.yml, which sow-213 Phase 3b DELETED, so from that day this
    // function returned 0 with a warning and the pre-apply was dead. The cost was not "one run late". The
    // signup Worker gives a coupon member @Member the moment they link Discord, and the next daily run then
    // read them as UNPAID (their grant is folded AFTER the plan, further down main) and swapped them to Locked
    // until the run after that restored Member. A real member sat locked out of the guild for two hours on
    // 2026-09-08 (job 102055325536 at 12:09 UTC: add-role locked, remove-role member; job 102090418008 at
    // 13:55: the reverse). Reading the mirror here is what makes the FIRST run after a signup correct.
    const read = readGrandfathered ?? (async () => {
      const m = await readOverridesMirrorRest({ env });
      return m.available ? { parsed: m.mirror?.grandfathered ?? { grandfathered: [] } } : null;
    });
    const source = await read();
    if (!source) {
      console.warn('reconcile: coupon-grant pre-apply SKIPPED: the KV overrides mirror could not be read; unfolded coupon grants apply on the next run.');
      return 0;
    }
    const { parsed } = source;
    // sow-185: the SAME couponsParsed the durable fold uses. Both paths run planCouponGrants, and if only
    // one of them saw the registry they could disagree about a member's tier WITHIN A SINGLE RUN: this run
    // would gate on one tier while the PR it opens records the other. One input, one answer.
    ({ grants } = planCouponGrants({ redemptions: kv.redemptions, grandfatheredParsed: parsed, couponsParsed: readCouponsFromDisk(root), now }));
  } catch (e) {
    console.warn(`reconcile: WARNING could not pre-apply coupon grants (${e?.message ?? e}); falling back to the next run.`);
    return 0;
  }
  for (const g of grants) {
    overrides.grandfathers.set(String(g.githubId), {
      github_id: String(g.githubId),
      reason: `coupon:${g.code}`,
      until: g.until,
      ...(g.tier ? { tier: g.tier } : {}),
    });
  }
  if (grants.length) {
    console.log(`reconcile: pre-applied ${grants.length} unfolded coupon grant(s) to this run (the durable fold still follows).`);
  }
  return grants.length;
}

/**
 * sow-213 R4: reconcile's fail posture for the KV overrides overlay, and it DIVERGES from the gate's on purpose.
 * The gate throws on ANY KV-unavailable ("refusing to gate on an unknown ban list"). Reconcile must not, while
 * the git files are present, and the reason is a CATEGORY ERROR avoided, not a risk trade: reconcile is the
 * mirror's own WRITE SOURCE. The mirror write below (loadOverridesRaw -> buildOverridesMirror) rewrites the
 * mirror FROM git in this same run, so aborting the whole daily reconcile (Discord roles, trial reminders,
 * held-PR releases) because it cannot READ a mirror it is about to REWRITE FROM GIT is backwards. That argument
 * stands regardless of whether the transition is brief. Once the git files are GONE, KV is the only source and
 * there is nothing to rewrite it from, so this fails closed (rethrows). Keyed on reality (overrideFilesPresent),
 * not a flag. `applyOverridesSource` itself is UNCHANGED; this branch is reconcile's posture, not a weakening of
 * the shared primitive. Exported for tests.
 */
export function reconcileOverlayCatch(err, { root = ROOT, filesPresent = overrideFilesPresent, log = console } = {}) {
  if (!filesPresent(root)) throw err; // post-deletion: KV is the only source -> fail closed
  // GREPPABLE, and it is a sow-213 Step-3 GATE INPUT: the reconcile run BEFORE the git files are deleted MUST NOT
  // contain this line (the exit criterion is "the overlay OBSERVED SUCCEEDING in a real run"). If it fires
  // nightly during the transition, the KV overlay has been silently broken, and Step 3 would flip this same code
  // to a hard failure for a reason that has been true for weeks.
  log.warn(`reconcile: OVERRIDES-OVERLAY-FALLBACK: KV overlay unavailable (${err?.message ?? err}); using git overrides (git is present and this run rewrites the mirror from it).`);
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const now = new Date();
  const env = process.env;

  const overrides = loadOverrides(ROOT);
  // sow-213 R4: overlay the KV mirror onto bans/grandfathers so a KV-native ban/grant is reflected in this run's
  // plan (gatherMembers -> effectiveStatus, Discord role sync, day-87 reminders). See reconcileOverlayCatch for
  // the reconcile-specific fail posture (tolerate a KV blip while git is present, fail closed once the files are
  // gone). The mirror-WRITE source below (loadOverridesRaw) stays git; this is the CONSUMER read only.
  try {
    await applyOverridesSource({ overrides, repoRoot: ROOT, env });
    console.log('reconcile: OVERRIDES-OVERLAY-OK: bans/grandfathers reconciled with the KV mirror.');
  } catch (e) {
    reconcileOverlayCatch(e, { root: ROOT });
  }
  const repoIndex = buildRepoIndex(ROOT);

  // sow-218: APPLY unfolded coupon grants to this run's overrides, in memory, BEFORE anything reads them.
  //
  // The durable fold (syncCouponGrants, far below) opens a PR and merges it via the API. It does NOT touch
  // this checkout, so `loadOverrides(ROOT)` above keeps reading the commit the workflow started from. That is
  // why a coupon invitee needed TWO daily runs: run one folded the grant into a PR it could not itself see,
  // and only run two, from a fresh checkout, resolved them as effective-paid. Until then they were not paid to
  // the gate and not eligible for members-index enrollment (which requires effective.status === 'paid'), so
  // the site told them they held Content Creator through 2027 while every publish was rejected.
  //
  // Reordering the fold would not have helped, for the same reason: the run cannot see its own merge. Applying
  // the grants to the in-memory map is what makes run ONE correct. The PR still lands and remains the durable
  // record; this only stops the run from being blind to a grant it is about to write down.
  //
  // Costs nothing extra: listCouponRedemptions + planCouponGrants already run in this process for the fold.
  // Best-effort by design, exactly like the fold itself: a KV hiccup leaves the previous two-run behaviour
  // rather than aborting a run that has content flips and role syncs to do.
  await applyPendingCouponGrants({ overrides, env, now });

  const { stripe, github, discord, resend } = buildClients(env);

  const targetId = targetedGithubId(env);
  let members;
  if (targetId) {
    console.log(`reconcile: TARGETED mode (repository_dispatch) for github_id ${targetId}.`);
    members = await gatherTargetedMember(stripe, overrides, now, targetId, { repoIndex, discord, env });
    // SOW-157: a targeted member with NO Stripe customer (a grandfathered comp member, exactly who the
    // 'enroll' dispatch fires for) still needs an entry, so union the override-only gather scoped to the id.
    if (!members.length) {
      const overrideOnly = await gatherOverrideOnlyMembers(overrides, now, { seen: new Set(), repoIndex, discord, env });
      members = overrideOnly.filter((m) => String(m.githubId) === targetId);
      if (members.length) console.log('reconcile: targeted member resolved from the overrides (no Stripe customer).');
    }
  } else {
    members = await gatherMembers(stripe, overrides, now, { repoIndex, discord, env });
    // Grandfathered / banned members with NO Stripe customer are not enumerated above (gatherMembers
    // iterates Stripe customers only). Union them so their managed Discord role is still synced (e.g. a
    // complimentary co-op member granted access who never ran the paid signup). The KV overrides mirror
    // below already covers their following/decrypt/publish access independent of this enumeration.
    const seen = new Set(members.map((m) => String(m.githubId)));
    const overrideOnly = await gatherOverrideOnlyMembers(overrides, now, { seen, repoIndex, discord, env });
    if (overrideOnly.length) {
      console.log(`reconcile: + ${overrideOnly.length} override-only member(s) (grandfathered/banned, no Stripe customer).`);
      members = members.concat(overrideOnly);
    }
  }

  // sow-185: only sync the Content-Creator badge when BOTH the role id is provisioned AND reconcile's Stripe
  // price map is populated (shouldSyncCreatorRole). The price-map condition is load-bearing: with an empty map,
  // tierForPrice runs in legacy mode and resolves EVERY paid member to creator, so enabling the badge on the
  // role id alone would stamp @Creator on every paid + grandfathered member in the live guild. So the role id
  // is committed but stays inert until the prices are wired into reconcile's env.
  const actions = planReconcile({ members, repoIndex: repoIndex.byUsername, now, creatorRoleEnabled: shouldSyncCreatorRole(env) });

  // sow-312: publish WHO may receive the members edition of the weekly digest. `members` already carries every
  // effective status this run resolved, so this is a projection of a list we are holding, not a second sweep.
  //
  // It sits here, right after the plan is built, rather than in the mirror block above, because that block
  // runs before gatherMembers and this needs its result. The blob carries github_ids ONLY.
  //
  // A FAILURE HERE MUST NOT FAIL THE RUN. The compile treats a missing or old list as "nobody is entitled" and
  // sends everybody the public issue, which is the safe direction, so a mirror blip costs one week of member
  // share titles rather than breaking membership reconciliation. Logged, and the exit code is left alone.
  //
  // AND NEVER FROM A TARGETED RUN (2026-09-10). This PUT replaces the whole list with a projection of
  // `members`, and a repository_dispatch run gathers ONE member. The same one-member roster that emptied the
  // Shop Talk guest list on 2026-09-09 was, on the same night, published here as "the entitled members": one
  // github_id, until the next full run. A compile in that window sends every other member the public issue.
  const digestSkip = digestEntitlementTargetedSkip(targetId);
  if (digestSkip) {
    console.log('reconcile: ' + digestSkip);
  } else if (dryRun) {
    console.log('reconcile: DRY RUN would publish the digest entitlement list to KV (key digest:entitled).');
  } else {
    try {
      const r = await mirrorDigestEntitlementToKv({ members, env, now });
      console.log(r.written ? `reconcile: published the digest entitlement list (${r.bytes} bytes).` : `reconcile: digest entitlement SKIPPED (${r.reason}).`);
    } catch (e) {
      console.error('reconcile: digest entitlement publish FAILED (non-fatal; the digest falls back to public-only):', e?.message ?? e);
    }
  }

  console.log(`reconcile: ${members.length} membership customer(s), ${actions.length} action(s) planned.${stripeModeNote(env.STRIPE_SECRET_KEY)}`);
  for (const action of actions) console.log('  ' + describe(action));

  // FAIL CLOSED: a banned member whose folder could not be resolved cannot be deplatformed by this run.
  // Surface it loudly and set a non-zero exit so CI/the operator must fix the members-index, even though
  // the rest of the plan still applies.
  const unresolved = actions.filter((a) => a.kind === 'unresolved');
  const bannedUnresolved = unresolved.filter((a) => a.status === 'banned');
  for (const a of unresolved) {
    console.error(`reconcile: ${a.status === 'banned' ? 'CRITICAL' : 'WARNING'} unresolvable github_id ${a.githubId} — ${a.reason}. Add a house/members-index.yml entry.`);
  }
  if (bannedUnresolved.length) process.exitCode = 1;

  // SOW-015: mirror the override files (bans/roles/grandfathered) into SIGNUP_KV so the Worker's
  // GET /membership/key can apply ban > staff > grandfather server-side. This is a sync of the override
  // files, not a member action, so a dry run only reports what it would write.
  const rawOverrides = loadOverridesRaw(ROOT);
  if (dryRun) {
    // sow-213 Step 3: THE DRY RUN IS HONEST NOW. It uses the REALITY-DERIVED ownership, not a byte count that
    // misleads once the git files are gone. When git still owns both sections, the byte count is meaningful and
    // printed. When a section is KV-native (its git file deleted), buildOverridesMirror with no `existing` would
    // ABORT rather than write an empty section, and a byte count would report 0 entries, which is byte-for-byte
    // the shape of a catastrophic erase. So no count is printed for a KV-native section: the real --apply write
    // reads the current KV mirror and PRESERVES those entries, which a dry run cannot read. The direct KV re-read
    // is the post-deletion safety signal (sow-213 exit criteria), never this.
    const owned = gitOwnedSections(ROOT); // { bans, grandfathered }; roles is always git-native
    const kvNative = Object.entries(owned).filter(([, v]) => !v).map(([k]) => k);
    if (kvNative.length === 0) {
      const blob = buildOverridesMirror(rawOverrides, now, null, owned);
      console.log(`reconcile: DRY RUN would mirror overrides to KV (${JSON.stringify(blob).length} bytes, key overrides:mirror; roles + bans + grandfathered all git-owned).`);
    } else {
      console.log(
        `reconcile: DRY RUN would mirror overrides to KV. roles.yml is git-owned and rebuilt; ${kvNative.join(' + ')} ${kvNative.length === 1 ? 'is' : 'are'} KV-native now (git file deleted), so the real --apply write PRESERVES the existing KV entries, which a dry run cannot read. No entry count is reported for them: a 0 here would be byte-for-byte the shape of a total erase.`,
      );
    }
  } else {
    try {
      // sow-213 Phase 3: preserve, never rebuild, a section git no longer owns (see kv-mirror.sectionFor).
      const r = await mirrorOverridesToKv({ raw: rawOverrides, env, now, ownedByGit: gitOwnedSections(ROOT) });
      console.log(r.written ? `reconcile: mirrored overrides to KV (${r.bytes} bytes).` : `reconcile: overrides KV mirror SKIPPED (${r.reason}).`);
    } catch (e) {
      console.error('reconcile: overrides KV mirror FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-058: mirror house/syndication-config.yml -> KV key synd:config so the Worker drain reads the live channel
  // switches, require_approval and the hold WITHOUT a redeploy (the overrides-mirror pattern).
  // Without this sync the drain falls back to the safe default (disabled), so syndication can never be enabled.
  let rawSyndication = {};
  try { rawSyndication = yaml.load(fs.readFileSync(path.join(ROOT, 'house', 'syndication-config.yml'), 'utf8')) || {}; }
  catch { rawSyndication = {}; }
  if (dryRun) {
    console.log('reconcile: DRY RUN would mirror syndication config to KV (key synd:config).');
  } else {
    try {
      const r = await mirrorSyndicationConfigToKv({ raw: rawSyndication, env });
      console.log(r.written ? `reconcile: mirrored syndication config to KV (${r.bytes} bytes).` : `reconcile: syndication config KV mirror SKIPPED (${r.reason}).`);
    } catch (e) {
      console.error('reconcile: syndication config KV mirror FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-087: mirror house/content-channels.yml -> KV synd:channels (the drain's category -> channel routing)
  // and house/topics.yml -> KV topics:vocab (the Worker's share category suggester). Same pattern as above.
  for (const { file, run, key } of [
    { file: 'content-channels.yml', run: mirrorContentChannelsToKv, key: 'synd:channels' },
    { file: 'topics.yml', run: mirrorTopicsToKv, key: 'topics:vocab' },
    // sow-291 Phase 2: coupons.yml is NOT in this loop any more. The loop's `catch { {} }` treats an
    // unreadable file as an empty one, which for the coupon registry means mirroring an EMPTY registry over
    // the live one and disabling every coupon on a green run. It gets its own block below.
  ]) {
    let rawDoc = {};
    try { rawDoc = yaml.load(fs.readFileSync(path.join(ROOT, 'house', file), 'utf8')) || {}; } catch { rawDoc = {}; }
    if (dryRun) {
      console.log(`reconcile: DRY RUN would mirror house/${file} to KV (key ${key}).`);
      continue;
    }
    try {
      const r = await run({ raw: rawDoc, env });
      console.log(r.written ? `reconcile: mirrored house/${file} to KV (${r.bytes} bytes).` : `reconcile: house/${file} KV mirror SKIPPED (${r.reason}).`);
    } catch (e) {
      console.error(`reconcile: house/${file} KV mirror FAILED:`, e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // sow-312: house/mail-settings.yml -> KV mail:config, the send-rate caps the mail drain reads LIVE. This is
  // what lets the owner change how fast the newsletter goes out by editing one line and pushing, with no
  // Worker redeploy.
  //
  // ITS OWN BLOCK, NOT THE LOOP ABOVE, for the same reason coupons has one. That loop treats an unreadable
  // file as an EMPTY one, and an empty mirror here drops every cap, which sends the Worker back to its env
  // var. If the owner had set daily_cap to 0 to PAUSE sending, a transient read failure would silently resume
  // it. So: mirror only what actually parsed, and on a failure leave whatever is already in KV, which is the
  // last setting a person deliberately chose.
  {
    let rawMail = null;
    let mailReadError = null;
    try { rawMail = yaml.load(fs.readFileSync(path.join(ROOT, 'house', 'mail-settings.yml'), 'utf8')); }
    catch (e) { mailReadError = e; }
    if (mailReadError) {
      console.error('reconcile: house/mail-settings.yml UNREADABLE, leaving the live caps as they are:', mailReadError?.message ?? mailReadError);
      process.exitCode = 1;
    } else if (!rawMail || typeof rawMail !== 'object') {
      console.error('reconcile: house/mail-settings.yml parsed to nothing, leaving the live caps as they are.');
      process.exitCode = 1;
    } else if (dryRun) {
      console.log('reconcile: DRY RUN would mirror house/mail-settings.yml to KV (key mail:config).');
    } else {
      try {
        const r = await mirrorMailSettingsToKv({ raw: rawMail, env });
        console.log(r.written ? `reconcile: mirrored house/mail-settings.yml to KV (${r.bytes} bytes).` : `reconcile: mail-settings KV mirror SKIPPED (${r.reason}).`);
      } catch (e) {
        console.error('reconcile: mail-settings KV mirror FAILED:', e?.message ?? e);
        process.exitCode = 1;
      }
    }
  }

  // sow-266: house/digest-config.yml -> KV digest:config, the digest's membership pitch and its sponsor slot,
  // read live by the mail compile. This is what lets the owner reword the pitch or swap a sponsor by editing
  // one file, with no Worker redeploy.
  //
  // ITS OWN BLOCK, for the reason mail-settings has one: a loop that treats an unreadable file as an empty one
  // would mirror an empty blob over the live settings. Here that means reverting the owner's copy to the
  // compiled default AND, worse in the other direction, it would be the only way a sponsor could silently
  // vanish mid-campaign. On a read failure, leave whatever is in KV: it is the last thing a person chose.
  {
    let rawDigest = null;
    let digestReadError = null;
    try { rawDigest = yaml.load(fs.readFileSync(path.join(ROOT, 'house', 'digest-config.yml'), 'utf8')); }
    catch (e) { digestReadError = e; }
    if (digestReadError) {
      console.error('reconcile: house/digest-config.yml UNREADABLE, leaving the live digest settings as they are:', digestReadError?.message ?? digestReadError);
      process.exitCode = 1;
    } else if (!rawDigest || typeof rawDigest !== 'object') {
      console.error('reconcile: house/digest-config.yml parsed to nothing, leaving the live digest settings as they are.');
      process.exitCode = 1;
    } else if (dryRun) {
      console.log('reconcile: DRY RUN would mirror house/digest-config.yml to KV (key digest:config).');
    } else {
      try {
        const r = await mirrorDigestConfigToKv({ raw: rawDigest, env });
        console.log(r.written ? `reconcile: mirrored house/digest-config.yml to KV (${r.bytes} bytes).` : `reconcile: digest-config KV mirror SKIPPED (${r.reason}).`);
      } catch (e) {
        console.error('reconcile: digest-config KV mirror FAILED:', e?.message ?? e);
        process.exitCode = 1;
      }
    }
  }

  // SOW-119 + sow-291 Phase 2: house/coupons.yml -> KV coupons:config, with ABSENT and UNPARSEABLE kept
  // distinct. Absent is the Phase 2 flip (KV is the source, preserve rather than rebuild); unparseable is a bad
  // edit and must abort loudly rather than mirror an empty registry. The failure direction matters more here
  // than for the other mirrors: an empty coupons:config disables every invite link in circulation.
  {
    try {
      const { raw: rawCoupons, ownedByGit } = loadCouponsRaw(ROOT);
      if (dryRun) {
        console.log(`reconcile: DRY RUN would mirror house/coupons.yml to KV (key coupons:config, git-owned=${ownedByGit}).`);
      } else {
        const r = await mirrorCouponsToKv({ raw: rawCoupons, env, ownedByGit });
        console.log(r.written ? `reconcile: mirrored coupons to KV (${r.bytes} bytes, git-owned=${ownedByGit}).` : `reconcile: coupons KV mirror SKIPPED (${r.reason}).`);
      }
    } catch (e) {
      console.error('reconcile: coupons KV mirror FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-119: fold coupon redemptions (KV) into house/grandfathered.yml as until-bounded grants, BEFORE the
  // member gathering has to see them next run (the Worker fast-path covers the gap in the meantime). Dry
  // run reports intent; apply lists KV + opens one auto-merged PR for any missing grant.
  if (dryRun) {
    console.log('reconcile: DRY RUN would fold coupon redemptions from KV -> the overrides:mirror grants (KV-native, no PR; requires CF creds).');
  } else {
    try {
      // sow-213 Step 3: the grants source AND target are the KV mirror now (house/grandfathered.yml is deleted).
      const r = await syncCouponGrants({
        env, now,
        readGrandfathered: async () => {
          const m = await readOverridesMirrorRest({ env });
          return (m.available && m.mirror) ? { parsed: m.mirror.grandfathered ?? { grandfathered: [] } } : null;
        },
        // sow-291 Phase 2: house/coupons.yml is deleted, so readCouponsFromDisk returns null and the fold loses
        // the registry-tier FALLBACK only. This is deliberately NOT re-pointed to KV: every current coupon is
        // tier: member (the DEFAULT_COUPON_TIER), so a null registry folds to exactly the same tier the registry
        // would have named. It degrades toward the OLD, correct behaviour. A FUTURE creator-tier coupon (none
        // exist; Phase 4 rotation is cancelled) would need this re-pointed to readCouponsConfigRest, which is
        // built and used by invite-links + build-campaign-manifest. See the sow-291 LIVE STATUS block.
        readCoupons: () => readCouponsFromDisk(ROOT),
      });
      console.log(
        r.synced
          ? `reconcile: folded ${r.additions} coupon redemption(s) into grandfather grants in KV${r.conversions ? `, ${r.conversions} converted from permanent comp (SOW-142)` : ''}.`
          : `reconcile: coupon-grants sync SKIPPED (${r.reason}).`,
      );
      if (r.skippedBounded?.length) {
        for (const s of r.skippedBounded) {
          console.log(`reconcile: coupon fold SKIPPED bounded non-coupon grant for ${s.githubId} (reason: ${s.reason}; until: ${s.until}): owner call, never rewritten silently.`);
        }
      }
    } catch (e) {
      console.error('reconcile: coupon-grants sync FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-157: enroll unindexed effective-paid members into house/members-index.yml so the hosted authoring
  // endpoint can resolve their folder (it reads ONLY the index; an absent entry is a 409). Candidates come
  // from the gathered members (Stripe paid + grandfathered), so a targeted 'enroll' dispatch and the daily
  // sweep both flow through here. A dry run prints the plan; rejects are per-candidate fail-closed.
  try {
    const r = await syncEnrollments({ members, overrides, root: ROOT, env, github, now, dryRun });
    if (r.additions?.length) {
      console.log(
        r.synced
          ? `reconcile: enrolled ${r.additions.length} hosted member(s) into members-index (PR #${r.prNumber}).`
          : `reconcile: ${dryRun ? 'DRY RUN would enroll' : 'enrollment planned'} ${r.additions.length} member(s): ${r.additions.map((a) => `${a.githubId}->${a.folder}`).join(', ')}${r.reason && !dryRun ? ` (SKIPPED: ${r.reason})` : ''}.`,
      );
    } else if (r.reason !== 'no unenrolled effective-paid members') {
      console.log(`reconcile: enrollment SKIPPED (${r.reason}).`);
    }
    for (const rej of r.rejects ?? []) {
      console.warn(`reconcile: enrollment REJECTED github_id ${rej.githubId}: ${rej.reason}. Provision by hand if intended.`);
    }
  } catch (e) {
    console.error('reconcile: enrollment sync FAILED:', e?.message ?? e);
    process.exitCode = 1;
  }

  // sow-439 (owner, 2026-10-02): every paying member gets a starter profile page, so their profile link never leads to
  // "We could not find that page". Runs right after enrollment so a member enrolled in this run gets their page in the
  // same run. It only ADDS files a member does not have, so a targeted one-member run can never remove anyone's page.
  try {
    const r = await syncStarterProfiles({ members, root: ROOT, env, github, now, dryRun });
    if (r.additions?.length) {
      console.log(
        r.synced
          ? `reconcile: wrote ${r.additions.length} starter profile(s) (PR #${r.prNumber}): ${r.additions.map((a) => a.folder).join(', ')}.`
          : `reconcile: ${dryRun ? 'DRY RUN would write' : 'planned'} ${r.additions.length} starter profile(s): ${r.additions.map((a) => `${a.folder} (${a.displayName})`).join(', ')}${r.reason && !dryRun ? ` (SKIPPED: ${r.reason})` : ''}.`,
      );
    } else if (r.reason !== 'every paying member has a profile') {
      console.log(`reconcile: starter profiles SKIPPED (${r.reason}).`);
    }
    for (const s of r.skipped ?? []) console.warn(`reconcile: starter profile for ${s.folder} skipped: ${s.reason}.`);
  } catch (e) {
    console.error('reconcile: starter profiles FAILED:', e?.message ?? e);
    process.exitCode = 1;
  }

  // SOW-024: sync the member-identity-free favorite counts (house/favorite-counts.yml) from the deletable edge
  // store (KV) into git, so the static build shows aggregate favorite counts without committing any
  // who-favorited-what data. A dry run only reports intent; an apply lists KV + opens an auto-merged PR when
  // the counts changed (no-op when unchanged, or skipped when CF creds / a GitHub client are absent).
  if (dryRun) {
    console.log('reconcile: DRY RUN would sync favorite counts + opt-in favorited-by from KV -> house/favorite-counts.yml + house/favorited-by.yml (requires CF creds + a GitHub PR).');
  } else {
    try {
      const r = await syncFavoriteCounts({
        env, github, now,
        readCurrentCounts: () => readCountsFromDisk(ROOT),
        readCurrentFavoritedBy: () => readFavoritedByFromDisk(ROOT), // SOW-114
        readMembersIndex: () => readMembersIndexFromDisk(ROOT), // SOW-114: github_id -> username for the opt-in lists
      });
      console.log(
        r.synced
          ? `reconcile: synced favorite counts (PR #${r.prNumber}, ${r.total} target(s), ${r.publicTargets ?? 0} public favorited-by target(s)).`
          : `reconcile: favorite-counts sync SKIPPED (${r.reason}).`,
      );
    } catch (e) {
      console.error('reconcile: favorite-counts sync FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // sow-289: roll up the outbound partner links' clicks (Cloudflare zone analytics -> house/outbound-clicks.yml)
  // through one auto-merged PR, the favorite-counts pattern. The zone answers one day at a time and keeps eight,
  // so every run queries the last seven complete days and replaces each date's row (idempotent, so a missed run
  // backfills). Skipped, not failed, without CF_ANALYTICS_TOKEN; a day whose query fails stays unmeasured.
  if (dryRun) {
    console.log('reconcile: DRY RUN would roll up outbound link clicks from Cloudflare zone analytics -> house/outbound-clicks.yml (requires CF_ANALYTICS_TOKEN + a GitHub PR).');
  } else {
    try {
      const r = await syncOutboundClicks({
        env, github, now,
        paths: outboundRows(ROOT).map(([p]) => p),
        readCurrent: () => readClicksFromDisk(ROOT),
      });
      const failed = r.failedDates?.length ? ` ${r.failedDates.length} day(s) NOT measured: ${r.failedDates.map((f) => `${f.date} (${f.reason})`).join('; ')}.` : '';
      console.log(
        r.synced
          ? `reconcile: rolled up outbound clicks (PR #${r.prNumber}, ${r.dates.length} day(s)).${failed}`
          : `reconcile: outbound-clicks rollup SKIPPED (${r.reason}).${failed}`,
      );
    } catch (e) {
      console.error('reconcile: outbound-clicks rollup FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-186 phase 3: reconverge the reverse follower index (followers:<github_id>) from the forward follow graph
  // (follows:<github_id>) in KV. This is the SOLE writer of the reverse index (the follow hot path only writes
  // the forward store); a full recompute with stale-key deletion, so unfollows, renames, erasures, and the
  // retired username-keyed entries all self-heal. KV -> KV (private follower ids stay in the edge store, nothing
  // reaches git), so it needs CF creds but no GitHub client. Unresolvable followed-usernames are skipped fail-safe.
  if (dryRun) {
    console.log('reconcile: DRY RUN would reconverge the reverse follower index followers:<github_id> from follows:* in KV (requires CF creds).');
  } else {
    try {
      const r = await syncFollowerIndex({ env, now: () => now.getTime(), membersIndex: readMembersIndexFromDisk(ROOT) });
      console.log(
        r.synced
          ? `reconcile: reverse follower index synced (${r.followedTargets} target(s): ${r.written} written, ${r.unchanged} unchanged, ${r.deleted} stale deleted; ${r.unresolved} unresolved follow edge(s) skipped).`
          : `reconcile: reverse follower index sync SKIPPED (${r.reason}).`,
      );
    } catch (e) {
      console.error('reconcile: reverse follower index sync FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-053 Part B: surface conflicting PRs (auto-merge stalls silently on them). Runs in both modes; the sweep
  // only labels + comments on --apply, and is fail-soft so it never breaks the rest of reconcile.
  try {
    const { surfaced, stuck } = await surfaceConflicts({ github, dryRun });
    if (surfaced.length) {
      console.log(`reconcile: ${surfaced.length} conflicting PR(s)${dryRun ? ' (dry-run, would label + comment)' : ' surfaced'}: ` + surfaced.map((c) => `#${c.number}`).join(', '));
    }
    // SOW-152: the class /ci health cannot see (the gate's failed merge stays a green run). A stuck bot
    // superadmin-automerge PR cannot auto-merge and the re-publish comment is a dead end for a bot, so it needs
    // a human to bring the change in or re-trigger the action. Surfaced distinctly so it never piles up unseen.
    if (stuck.length) {
      console.log(`reconcile: ${stuck.length} STUCK superadmin-automerge BOT PR(s) needing recovery (cannot auto-merge; bring the change in by hand or re-trigger the action): ` + stuck.map((c) => `#${c.number}`).join(', '));
    }
  } catch (e) {
    console.error('reconcile: conflict sweep failed (non-fatal):', e?.message ?? e);
  }

  // sow-314: the Shop Talk guest list, beside the Discord role sync.
  //
  // DELIBERATELY ABOVE THE DRY-RUN RETURN. It was first placed below it, which made the sweep unreachable in
  // dry-run mode: `npm run reconcile` printed no Shop Talk line at all and exited 0, so the preview the whole
  // "always dry-run first" rule depends on silently did not exist. The unit tests could not catch it because
  // they call enactShoptalk directly and never run main(). `apply: !dryRun` is what keeps it read-only here.
  //
  // AND NEVER IN TARGETED MODE (2026-09-10). A repository_dispatch run gathers ONE member. On 2026-09-09 that
  // one-member roster reached the sweep, which read every other placed seat as lapsed and mailed 22 members
  // a cancellation; the next morning's full run mailed them all a fresh invitation. The planner's rule 4 now
  // makes that structurally impossible, and this guard makes it unnecessary to rely on: a partial roster
  // never reaches the sweep at all. The daily run seats a new payer by the next morning.
  const shopSkip = shoptalkTargetedSkip(targetId);
  if (shopSkip) {
    console.log('reconcile: ' + shopSkip);
  } else {
    try {
      const shop = await enactShoptalk(members, { env, apply: !dryRun });
      console.log('reconcile: ' + (shop.ok ? shop.summary : shop.reason));
      if (!shop.ok && !shop.skipped) process.exitCode = 1;
      if (shop.ok && shop.withheld?.length) process.exitCode = 1; // the removal cap fired: red, so somebody looks
    } catch (e) {
      console.error('reconcile: Shop Talk enrollment FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  if (dryRun) {
    console.log('reconcile: DRY RUN (no changes). Re-run with --apply to enact.');
    return;
  }

  // sow-198: enactPlan isolates each action and never throws for an action-level failure, so the summary
  // ALWAYS prints and the log always records what the run attempted. The outer catch covers only a genuine
  // programming error. A failure still turns the run red via exitCode; what it no longer does is take the
  // rest of the plan and the summary down with it.
  let counts = {};
  let failures = [];
  try {
    ({ counts, failures } = await enactPlan(actions, { github, discord, resend }, env));
  } catch (e) {
    console.error('reconcile: enact FAILED:', e?.message ?? e);
    process.exitCode = 1;
  }
  console.log('reconcile: applied. ' + JSON.stringify(counts));
  if (failures.length) {
    console.error(`reconcile: ${failures.length} action(s) failed; the rest of the plan was still enacted.`);
    process.exitCode = 1;
  }
}

/**
 * sow-314: add paid and trial members to the Shop Talk guest list, and take lapsed ones off.
 *
 * Sits beside the Discord role sync and works the same way: reconcile holds the service credential and calls
 * the service. Exported and fully injected so the whole decision surface is testable without a network.
 *
 * EVERY REFUSAL PATH RETURNS ok:false WITH A REASON AND CHANGES NOTHING. That is the point of the function.
 * An unconfigured credential, an unreadable opt-out list and a missing series are three different problems
 * with three different fixes, and none of them may be reported as a quiet successful run of zero changes,
 * because a sweep that enrolls nobody while looking healthy is the failure this whole feature is built to
 * avoid.
 */
/** Same guard for the digest entitlement list: a whole-roster artifact must never be built from one member. */
export function digestEntitlementTargetedSkip(targetId) {
  if (!targetId) return null;
  return `digest entitlement publish SKIPPED in targeted mode (github_id ${targetId}): a one-member roster would replace the whole list. The daily run publishes it.`;
}

/** The one-line reason a targeted run does not sweep, or null for a full run. Pure, so it is a unit test. */
export function shoptalkTargetedSkip(targetId) {
  if (!targetId) return null;
  return `Shop Talk sweep SKIPPED in targeted mode (github_id ${targetId}): a one-member roster must never reach the sweep. The daily run covers enrollment.`;
}

export async function enactShoptalk(members, { env = process.env, fetchImpl = globalThis.fetch, apply = false, calendar = null } = {}) {
  const cal = calendar ?? (
    env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET && env.GOOGLE_CALENDAR_REFRESH_TOKEN
      ? createGoogleCalendarClient({
        clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
        clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
        refreshToken: env.GOOGLE_CALENDAR_REFRESH_TOKEN,
        calendarId: env.GOOGLE_CALENDAR_ID || 'primary',
        fetch: fetchImpl,
      })
      : null
  );
  if (!cal) return { ok: false, skipped: true, reason: 'GOOGLE_CALENDAR_* not set; Shop Talk enrollment skipped' };

  const placedRead = await readPlaced({ env, fetchImpl });
  if (!placedRead.ok) return { ok: false, reason: `Shop Talk enrollment SKIPPED: ${placedRead.reason}` };
  const optRead = await readOptedOut({ env, fetchImpl });
  if (!optRead.ok) return { ok: false, reason: `Shop Talk enrollment SKIPPED: ${optRead.reason}` };
  const seenRead = await readSeen({ env, fetchImpl });
  if (!seenRead.ok) return { ok: false, reason: `Shop Talk enrollment SKIPPED: ${seenRead.reason}` };

  const result = await runShoptalkSweep({
    members, cal, placed: placedRead.placed, optedOut: optRead.optedOut, seen: seenRead.seen, apply,
  });
  if (!result.ok) return { ok: false, reason: result.message };

  // Written ONLY after a successful apply. Writing it on a dry run, or after a failed one, would record
  // ownership of addresses that were never placed.
  if (result.applied && result.placed) await writePlaced(result.placed, { env, fetchImpl });
  // The seen record is written on ANY apply run whose reading changed it, including a zero-change run: the
  // first run after rule 5 landed has to remember everybody already on the event without touching the event.
  if (apply && result.seenChanged) await writeSeen(result.seen, { env, fetchImpl });
  return { ok: true, ...result, summary: describeSweep(result) };
}

// Only run the CLI when invoked directly (so the test can import the helpers without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('reconcile: failed:', err?.message ?? err);
    process.exit(1);
  });
}

export { ROLE, STATUS };
