// Shared PR classification + merge decision (roles-and-capabilities.md, review-hardening #5).
// ONE module imported by the SOW-005 PR-gate and the SOW-003 scoping CI so they cannot diverge.
// Pure functions over a list of changed paths plus the author's role and owned folder. Fail closed.
//
// Path tiers (fail-closed: anything not clearly member/house content is infra = superadmin-tier):
//   Tier S (superadmin-owned): every path CODEOWNERS pins to the two superadmins (roles.yml,
//                              content-channels.yml, moderation-flags.yml, site-settings.yml,
//                              syndication-config.yml, house/applets/**), CODEOWNERS itself, .github/**,
//                              and any path outside members/** and house/**.
//   Tier A (admin-owned):      the rest of house/** (bans.yml, grandfathered.yml, referral-config.yml,
//                              house content, members-index.yml).
//   Member content:            members/**.

// ROLE comes from the node-free overrides-core (not overrides.mjs, which adds node:fs loaders): this module is
// bundled into the browser client + MV3 extension (SOW-028 inbox), so it must not transitively pull in node:fs.
import { ROLE } from './overrides-core.mjs';
// sow-185 phase 3a: the tier axis. tiers.mjs has ZERO imports (node-free), so it is safe in this bundled module.
// The caller (pr-gate) resolves the author's + owner's effective tier; decide() only ranks it with meetsTier.
import { TIER, meetsTier } from './tiers.mjs';
// sow-298: the SINGLE source of per-path role rank, mirroring CODEOWNERS. isTierS used to re-derive the tier
// and got it WRONG for the superadmin-pinned house files, calling them Tier A. That made the PR gate and
// CODEOWNERS share one blind spot, so the "even a bug at the endpoint cannot merge beyond the caller's real
// role" property did not hold for exactly the files it was written to protect. path-rank.mjs imports only
// overrides-core.mjs, so this adds no cycle and keeps the module node-free for the MV3 bundle.
import { rankForPath } from './path-rank.mjs';

const CONTENT_DIRS = ['posts', 'projects', 'products', 'prompts', 'comments'];
const ROLE_RANK = { [ROLE.member]: 0, [ROLE.moderator]: 1, [ROLE.admin]: 2, [ROLE.superadmin]: 3 };

/**
 * A path is safe to classify only if it is already canonical and repo-relative. Raw prefix matching
 * (startsWith) is fooled by "../" and "./" segments: "members/octocat/../../house/roles.yml" begins
 * with the owner prefix yet targets a superadmin file. We therefore reject, fail-closed, ANY path
 * that is not a clean forward-slash relative path: no leading slash, no backslash, no NUL, and every
 * segment non-empty and not "." or "..". Anything unclean forces the whole PR to rejected-escalation.
 */
export function isCleanPath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.startsWith('/')) return false; // absolute
  if (p.includes('\\')) return false; // backslash (Windows-style or escape trick)
  if (p.includes('\0')) return false; // NUL
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export function isMemberPath(p) {
  return p.startsWith('members/');
}
export function isHousePath(p) {
  return p === 'house' || p.startsWith('house/');
}

/**
 * Superadmin-owned, delegated to rankForPath so this and the admin-write gate cannot disagree (sow-298).
 * Covers every CODEOWNERS-pinned house file, CODEOWNERS, .github/**, and anything outside members/ and
 * house/. A non-canonical path fails closed to superadmin there, which is at least as strict as the
 * unclean-path rejection classifyPaths already applies first.
 */
export function isTierS(p) {
  return rankForPath(p) === ROLE_RANK[ROLE.superadmin];
}

/**
 * Admin-owned: house/** except anything Tier S. Disjoint from isTierS BY CONSTRUCTION rather than by the
 * order decide() happens to test them in (sow-298): before the pinned set moved to Tier S, a path could
 * only ever be one or the other, and classifyPaths exports both lists to callers that do not know the
 * branch order at line 261.
 */
export function isTierA(p) {
  if (!isHousePath(p)) return false;
  if (isTierS(p)) return false;
  return true;
}

/**
 * sow-213 Step 3: the two override files that MOVE OFF the public repository. After Step 3 deletes them, no PR
 * may re-create them. A person-keyed entitlement record in a public, forkable, CDN-cached repo is permanent and
 * can never satisfy a right-to-erasure request, which is the whole reason for the migration. Recreating a file
 * is also actively dangerous: gitOwnedSections() decides ownership by existsSync, so a reappearing file flips
 * its section back to git-owned and the next mirror write rebuilds it from whatever the file contains, which
 * can strip live entitlements on a green run.
 */
// The retired git files that must never REAPPEAR: sow-213 removed the governance overrides, and sow-291 removes
// the coupon registry (a coupon code is a bearer credential). The name is historical; the set is every file that
// left the public repository for KV. The same existsSync hazard applies to house/coupons.yml through
// loadCouponsRaw: a reappearing file flips ownedByGit back to true and the next coupon mirror rebuilds from git.
export const OVERRIDES_GIT_FILES = Object.freeze(['house/bans.yml', 'house/grandfathered.yml', 'house/coupons.yml']);

// The ONLY diff statuses a guarded file may legitimately carry: `modified` (the git writers, in the window
// before Step 3 deletes the files) and `removed` (the deletion commit itself). Anything that RESULTS IN THE
// FILE EXISTING against a base where it does not, added / renamed-into / copied, is a reappearance and is
// rejected fail-closed. Keying on creation status, not on merely touching the path, is what lets the writers
// keep modifying these files in the split-commit window without the guard blocking every legitimate admin
// action. An unknown or missing status on a guarded path is treated as a violation (fail-closed).
const OVERRIDES_ALLOWED_FILE_STATUS = new Set(['modified', 'removed']);

/**
 * PURE. Given the PR's changed files as `[{ path, status }]` (the GitHub files-API shape), return the guarded
 * override paths this PR RE-CREATES. Empty means no reappearance.
 */
export function overridesReappearance(changedFiles = []) {
  if (!Array.isArray(changedFiles)) return [];
  return changedFiles
    .filter((f) => f && OVERRIDES_GIT_FILES.includes(String(f.path)) && !OVERRIDES_ALLOWED_FILE_STATUS.has(String(f.status)))
    .map((f) => String(f.path));
}

/** The folder a github_id owns, resolved through the members-index (github_id -> username). */
export function ownedFolderFor(githubId, membersIndex) {
  return membersIndex.get(String(githubId)) ?? null;
}

/**
 * Classify a set of changed paths against the author's owned folder.
 * Returns the path buckets plus whether the PR stays entirely inside the author's own folder.
 */
export function classifyPaths(paths, ownedFolder) {
  // Pull out any non-canonical path FIRST so prefix matching only ever sees clean paths. An unclean
  // path is never counted as own content and always forces decide() to reject (fail closed).
  const unclean = paths.filter((p) => !isCleanPath(p));
  const clean = paths.filter(isCleanPath);
  const tierS = clean.filter(isTierS);
  const tierA = clean.filter(isTierA);
  const memberPaths = clean.filter(isMemberPath);
  const ownPrefix = ownedFolder ? `members/${ownedFolder}/` : null;
  const ownPaths = ownPrefix ? memberPaths.filter((p) => p.startsWith(ownPrefix)) : [];
  const otherMemberPaths = memberPaths.filter((p) => !ownPrefix || !p.startsWith(ownPrefix));
  // The distinct other-member folders this PR touches (the `<X>` in members/<X>/...). A contribution
  // is allowed only when this set has exactly one owner who is not the author.
  const otherOwners = [...new Set(otherMemberPaths.map((p) => p.split('/')[1]).filter(Boolean))];
  const ownFolderOnly =
    paths.length > 0 &&
    unclean.length === 0 &&
    tierS.length === 0 &&
    tierA.length === 0 &&
    otherMemberPaths.length === 0 &&
    ownPaths.length === paths.length;
  // SOW-024: there is NO favorites carve-out anymore. Favorites used to be a git-native
  // members/<ownedFolder>/favorites.yml toggled via an auto-merged PR (SOW-013), with a trial carve-out in
  // decide(). Favorites now live in the deletable edge store (KV), never as a PR, so the gate treats every
  // content PR uniformly (paid-only publish). A stray favorites.yml PR is just own-folder content, not a
  // special case, which is the stricter, fail-safe behavior.
  return { unclean, tierS, tierA, ownPaths, otherMemberPaths, otherOwners, memberPaths, ownFolderOnly };
}

/**
 * The single other-member folder this PR contributes to, or null. A contribution PR touches exactly
 * one other member's content folder and nothing else (no own folder, no house/infra, all canonical).
 * Returns the target owner username so the gate can require that owner's review approval.
 */
export function contributionTarget(paths, ownedFolder) {
  const c = classifyPaths(paths, ownedFolder);
  if (c.unclean.length || c.tierS.length || c.tierA.length || c.ownPaths.length) return null;
  if (c.otherOwners.length !== 1) return null;
  return c.otherOwners[0];
}

/**
 * The OWNER-side mirror of contributionTarget (SOW-028, the in-client review inbox). True when a PR is an
 * incoming contribution to `ownerFolder`: every changed path is canonical AND sits inside a REVIEWABLE
 * content dir of members/<ownerFolder>/ (posts/projects/prompts/comments per CONTENT_DIRS, NOT a
 * personal-activity dir like shares/), with at least one path. Because every path is under the owner's own prefix, no
 * other-member folder and no house/infra (Tier A/S) path can be present, so this exactly identifies the set
 * the gate would classify as a contribution awaiting THIS owner's approval (the caller still excludes PRs the
 * owner authored). Fail closed: no folder, a non-array, an empty list, or any unclean/out-of-folder path -> false.
 */
export function isContributionToFolder(paths, ownerFolder) {
  if (!ownerFolder || !Array.isArray(paths) || paths.length === 0) return false;
  const prefix = `members/${ownerFolder}/`;
  return paths.every((p) => {
    if (!isCleanPath(p) || !p.startsWith(prefix)) return false;
    // Only a reviewable content dir is a contribution; personal-activity paths (shares/, favorites/, ...)
    // are the member's own stream, never an incoming contribution to review (a share PR was wrongly here).
    return CONTENT_DIRS.includes(p.slice(prefix.length).split('/')[0]);
  });
}

/**
 * The type this function reports for an own-folder path it cannot classify: a share, a favorites file, anything
 * outside CONTENT_DIRS. It exists because SILENCE WAS A FAIL-OPEN (sow-218, 2026-08-11).
 *
 * This function used to drop such a path entirely. requiredTierFor then read only the types that DID land, so a
 * share alone produced an empty set and got creator by the empty-set default, which looked correct and was the
 * reason nobody noticed. Bundle that same share with one comment and the set became exactly ['comment'], the
 * "comments only" branch fired, and a Network Member published a Share on the member floor. The share was
 * invisible to the decision rather than argued about.
 *
 * Reporting the unclassifiable makes requiredTierFor's stated intent ("a type we cannot cleanly classify as
 * comments-only never publishes on the member floor") true for the first time, and it fails in the safe
 * direction by construction: a path we do not understand raises the bar rather than vanishing from it.
 */
export const TYPE_OTHER = 'other';

/**
 * Which content types an own-folder PR publishes (for labelling/notification, and the sow-185 tier floor).
 * Any own-folder path that is not profile.md and not under a CONTENT_DIRS dir reports as TYPE_OTHER; see above.
 */
export function contentTypesTouched(paths, ownedFolder) {
  const types = new Set();
  const prefix = ownedFolder ? `members/${ownedFolder}/` : null;
  for (const p of paths) {
    if (prefix && p.startsWith(prefix)) {
      const rest = p.slice(prefix.length);
      if (rest === 'profile.md') types.add('profile');
      else {
        const dir = rest.split('/')[0];
        if (CONTENT_DIRS.includes(dir)) types.add(dir.replace(/s$/, ''));
        else types.add(TYPE_OTHER); // never silently drop it: an unclassified own-folder path requires creator
      }
    }
  }
  return [...types];
}

/**
 * sow-185: the minimum TIER required to author a set of content types (from contentTypesTouched). Content
 * Creator authors public presence (post / project / prompt / profile); a Network Member authors comments.
 * Fail closed: an empty or mixed set, or any non-comment type, requires creator, the higher tier, so a type we
 * cannot cleanly classify as comments-only never publishes on the member floor.
 */
export function requiredTierFor(types) {
  if (!Array.isArray(types) || types.length === 0) return TIER.creator;
  return types.every((t) => t === 'comment') ? TIER.member : TIER.creator;
}

const fail = (label, reason) => ({ check: 'fail', autoMerge: false, label, reasons: [reason] });
const pass = (label, autoMerge, reason) => ({ check: 'pass', autoMerge, label, reasons: [reason] });

/**
 * The merge decision the PR-gate enforces. Order matters and is fail-closed:
 *   1. Banned author          -> fail `banned` (deplatformed, overrides everything).
 *   2. Non-canonical path      -> fail `rejected-escalation` (../, ./, leading slash, backslash).
 *   3. Not an active member    -> fail `rejected-not-a-member` (visitors and lapsed accounts; the gate
 *      auto-closes these). Members are: paid, trialing, grandfathered (folds to paid), staff, or bot.
 *   4. Escalation hard-fail    -> fail if the author lacks the role for a path tier (non-superadmin ->
 *      Tier S, non-admin -> Tier A). Defense-in-depth independent of CODEOWNERS / branch protection.
 *   5. Privileged author (moderator/admin/superadmin or bot) -> pass, may touch others' folders.
 *   6. Contribution (member, exactly one OTHER member's folder, nothing else) -> publishing a credit on
 *      the live site is paid-only, so a non-paid (trial) contributor -> fail `rejected-not-paid` (the gate
 *      auto-closes these; the draft stays on the contributor's fork). The contribution's content type sets a
 *      tier BOTH the contributor and the folder owner must hold (sow-185): a post/product/prompt needs Content
 *      Creator, a comment needs Network Member. A contributor below that tier -> fail `rejected-not-creator`;
 *      a folder owner below it -> fail `rejected-not-creator` (the content cannot live there). Otherwise a paid
 *      contributor passes only when the folder owner approved (ownerApproved) AND the owner is paid (ownerPaid);
 *      else held (`contribution-pending-owner`). Any mixed or multi-owner cross-folder PR -> `rejected-escalation`.
 *   7. Plain member, own folder only -> paid AND meeting the content's tier passes (+ auto-merge): Content
 *      Creator for post/product/prompt/profile, Network Member for comments (sow-185). A paid member below the
 *      required tier -> fail `rejected-not-creator`; a trial member -> fail `rejected-not-paid` (auto-closed;
 *      the draft stays on their fork until they pay, so no trial content reaches the repo).
 *
 * @param {object} a
 * @param {string[]} a.paths           changed file paths (repo-relative, forward slashes)
 * @param {string}   a.role            author role from roles.yml (default member)
 * @param {object}   a.effective       { status } from effectiveStatus()
 * @param {string|null} a.ownedFolder  the author's username folder (members-index), or null
 * @param {boolean}  [a.isBot]         true if the author is the reconcile bot (treated as admin)
 * @param {boolean}  [a.ownerApproved] for a contribution: the target folder owner submitted an
 *                                     APPROVED review on the current head SHA (read by github_id)
 * @param {boolean}  [a.ownerPaid]     for a contribution: the target folder owner is paid
 * @param {string}   [a.tier]          the author's effective TIER (tier-gate resolveEffectiveTier), default none
 * @param {string}   [a.ownerTier]     for a contribution: the target folder owner's effective TIER, default none
 */
export function decide({ paths, role = ROLE.member, effective, ownedFolder, isBot = false, ownerApproved = false, ownerPaid = false, tier = TIER.none, ownerTier = TIER.none, hostedContent = false, changedFiles = null }) {
  const c = classifyPaths(paths, ownedFolder);
  // isBot is a FLOOR, not an override: it promotes an unprivileged bot to admin, but never DEMOTES a
  // bot that already holds a higher role. So an automation account that is also a superadmin (for
  // example gbtilabs running the reconcile) keeps its superadmin powers and can still edit roles.yml.
  const effectiveRole = isBot && (ROLE_RANK[role] ?? 0) < ROLE_RANK[ROLE.admin] ? ROLE.admin : role;
  const isAdminPlus = effectiveRole === ROLE.admin || effectiveRole === ROLE.superadmin;
  const isModPlus = isAdminPlus || effectiveRole === ROLE.moderator;
  const status = effective?.status;
  // A member may open a mergeable PR: active (paid/trialing), grandfathered (folds to paid), staff, or bot.
  const isMember = isModPlus || isBot || status === 'paid' || status === 'trialing';

  // 1. Ban overrides everything.
  if (status === 'banned') {
    return fail('banned', 'author is banned (deplatformed regardless of paths or payment)');
  }

  // 2. Non-canonical paths cannot be safely scoped (../, ./, leading slash, backslash). Reject the
  //    whole PR fail-closed so a traversal cannot masquerade as own-folder content.
  if (c.unclean.length > 0) {
    return fail('rejected-escalation', `non-canonical or unsafe paths: ${c.unclean.join(', ')}`);
  }

  // 2.5. sow-213 Step 3 REAPPEARANCE GUARD. Once bans.yml and grandfathered.yml are migrated off the public
  //    repo, no PR may re-create them. This fires for EVERY role, superadmin included, and BEFORE the SOW-108
  //    superadmin auto-merge short-circuit at rule 5: a re-created override file would otherwise auto-merge with
  //    no review and put person-keyed entitlement records back on the public chain (and flip the section
  //    git-owned, so the next mirror write rebuilds it from the file and can strip live grants on a green run).
  //    Keyed on CREATION status (see overridesReappearance), so the git writers' MODIFY-PRs still pass in the
  //    window before Step 3 deletes these files, and the deletion commit's own REMOVE is not blocked. Inert
  //    until the caller supplies changedFiles with statuses (the gate does; the SOW-003 scoping CI does not).
  if (changedFiles) {
    const reappeared = overridesReappearance(changedFiles);
    if (reappeared.length > 0) {
      return fail('rejected-escalation', `sow-213: these override files were migrated off the public repository and may not be re-created: ${reappeared.join(', ')}`);
    }
  }

  // 3. Members only: a visitor or a lapsed account cannot open a mergeable PR. The gate auto-closes these.
  if (!isMember) {
    return fail('rejected-not-a-member', `author is not an active member (status: ${status ?? 'none'})`);
  }

  // 4. Escalation hard-fails (cannot be bypassed by the privilege short-circuit below).
  //
  // sow-193: `hostedContent` marks a `hosted/<id>/` CONTENT branch, the head the /membership/author endpoint
  // opens. On one of those the governance tiers are refused REGARDLESS of role, superadmin included.
  //
  // Why this exists. SOW-108 lets a superadmin auto-merge any path, and rule 5 below short-circuits them to
  // `superadmin-automerge` before any own-folder check. That is fine for a PR a superadmin opened deliberately.
  // It was NOT fine for the content endpoint: `authorizeSuperadmin` accepts a BEARER token, so a superadmin's
  // extension or MCP token reaches that endpoint, and the only thing standing between it and `house/roles.yml`,
  // `CODEOWNERS` or `.github/**` was the Worker's own HOUSE_CONTENT_PREFIXES allowlist. One allowlist bug, or a
  // future "just allow bare house/" edit, and a governance change lands auto-merged and unreviewed. The gate is
  // a real second wall now.
  //
  // `hosted-admin/<id>/` branches are deliberately UNAFFECTED (parseHostedRef isolates the two kinds at
  // scripts/pr-gate.mjs:181-184): the sow-161 admin surface legitimately writes house/**, and refusing it here
  // would break every admin mutation. Ordinary PRs are unaffected too, so SOW-108 is intact.
  const governanceLocked = hostedContent; // a content branch may never touch Tier S or Tier A
  if (c.tierS.length > 0 && (governanceLocked || effectiveRole !== ROLE.superadmin)) {
    return fail('rejected-escalation', `superadmin-owned paths require superadmin: ${c.tierS.join(', ')}`);
  }
  if (c.tierA.length > 0 && (governanceLocked || !isAdminPlus)) {
    return fail('rejected-escalation', `admin-owned paths require admin: ${c.tierA.join(', ')}`);
  }

  // 5. Privileged authors are authorized for every path they touched and are membership-exempt.
  if (isModPlus) {
    // A SUPERADMIN auto-merges ANY path they touch, including house/** and Tier S (owner-elected: superadmin
    // actions merge automatically with no second code-owner review). The escalation hard-fails above already
    // protect every non-superadmin, so this loosens nothing for anyone else.
    if (effectiveRole === ROLE.superadmin) return pass('superadmin-automerge', true, `superadmin (${effectiveRole})`);
    // An admin / moderator auto-merges only inside their own folder; their cross-folder / house changes fall
    // to the protected-paths ruleset (code-owner review), so auto-merge is off.
    return pass(c.ownFolderOnly ? 'paid' : 'admin-review', c.ownFolderOnly, `privileged author (${effectiveRole})`);
  }

  // 6. Contribution: a member edits exactly one OTHER member's folder and nothing else. Publishing a
  //    contribution surfaces the contributor's credit on the live site, which is paid-only, so a trial
  //    contributor is rejected (the gate auto-closes it; the draft stays on their fork). A paid
  //    contributor merges only when that folder owner has accepted (an APPROVED review on the head SHA)
  //    and the owner is paid. Auto-merge stays off; the owner approval merges it.
  const isContribution =
    c.otherMemberPaths.length > 0 &&
    c.ownPaths.length === 0 &&
    c.tierS.length === 0 &&
    c.tierA.length === 0 &&
    c.otherOwners.length === 1;
  if (isContribution) {
    if (status !== 'paid') {
      return fail('rejected-not-paid', `contributions publish your credit on the live site, which requires paid membership (status: ${status ?? 'none'})`);
    }
    // sow-185: the contribution's content type sets a tier BOTH parties must hold. A post/product/prompt can
    // only be authored by, and land in, a Content Creator's folder; a comment needs only Network Member.
    const required = requiredTierFor(contentTypesTouched(paths, c.otherOwners[0]));
    const need = required === TIER.creator ? 'Content Creator' : 'Network Member';
    if (!meetsTier(tier, required)) {
      return fail('rejected-not-creator', `contributing this content requires the ${need} tier or higher (your tier: ${tier ?? 'none'})`);
    }
    if (ownerApproved && ownerPaid) {
      // The owner is paid (folder is live) and has approved: the content's tier must also be one their folder
      // can host, else a post could be published into a Network Member's folder.
      if (!meetsTier(ownerTier, required)) {
        return fail('rejected-not-creator', `the folder owner (${c.otherOwners[0]}) is a ${ownerTier ?? 'none'} member, so ${need} content cannot be published there`);
      }
      return pass('contribution-accepted', false, `owner ${c.otherOwners[0]} approved the contribution`);
    }
    // Not yet approved, or the owner is not paid: hold (the existing pending-owner behavior is unchanged).
    return fail('contribution-pending-owner', `awaiting an approving review from the folder owner (${c.otherOwners[0]})`);
  }
  // Any remaining cross-folder PR (own mixed with other, or multiple other owners) is an escalation.
  if (c.otherMemberPaths.length > 0) {
    return fail('rejected-escalation', `mixed or multi-owner cross-folder PR: ${c.otherMemberPaths.join(', ')}`);
  }

  // 7. Plain member: own folder only at this point. Publishing requires paid AND the tier for what is being
  //    published (sow-185): Content Creator for public presence (post/product/prompt/profile), Network Member
  //    for comments. A trial member's drafts stay on their own fork until they pay (the gate rejects + the
  //    runnable wrapper auto-closes with a nudge), so no trial content ever reaches the canonical repo.
  if (status === 'paid') {
    const required = requiredTierFor(contentTypesTouched(paths, ownedFolder));
    if (!meetsTier(tier, required)) {
      const need = required === TIER.creator ? 'Content Creator' : 'Network Member';
      return fail('rejected-not-creator', `publishing this content requires the ${need} tier or higher (your tier: ${tier ?? 'none'})`);
    }
    return pass('paid', c.ownFolderOnly, 'paid member own-folder content');
  }
  return fail('rejected-not-paid', `publishing requires paid membership; trial drafts stay on your fork (status: ${status ?? 'none'})`);
}
