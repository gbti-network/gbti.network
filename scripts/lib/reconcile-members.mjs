// Reconcile member gathering (SOW-005): turns Stripe customers plus the overrides into the member entries the
// pure planner (scripts/lib/reconcile-plan.mjs) consumes. Split out of scripts/reconcile.mjs at the 900-line
// limit; reconcile.mjs re-exports every name here, so existing importers keep working. No top-level side
// effects: every function takes its clients, overrides and env as arguments.

import { deriveStatusFromCustomer, deriveMembershipFromCustomer, STATUS } from '../../membership/derive-status.mjs';
import { effectiveStatus, roleOf } from '../../membership/overrides.mjs';
import { buildEnvPriceTierMap, resolveEffectiveTier } from '../../membership/tier-gate.mjs'; // sow-185: price map + override-aware tier

/** Has this customer converted to a paid (active/past_due) subscription? Used to skip the day-87 reminder. */
function isConverted(customer) {
  const derived = deriveStatusFromCustomer(customer);
  return derived === STATUS.paid;
}

/**
 * Resolve the on-disk folder (username) a Stripe customer owns. Authoritative and fail-closed.
 * Resolution order:
 *   1. overrides.membersIndex.get(githubId)         (the M0 authoritative github_id -> folder map)
 *   2. repoIndex.byGithubId.get(githubId)           (profile.md carries a github_id, when present)
 *   3. repoIndex.byGithubLogin.get(login.toLowerCase()) (profile links.github URL trailing segment)
 *   4. a case-insensitive match of github_login against the folder (byUsername) keys
 * Returns the username string, or null when nothing resolves.
 *
 * This exists because a Stripe metadata.github_login does NOT always equal the on-disk folder name.
 * Confirmed in real data: folder 'hudson' has links.github https://github.com/atwellpub, so the login
 * is 'atwellpub' and a plain login -> folder lookup misses. Steps 1 to 3 close that hole. Since sow-197
 * the stake is BAN enforcement rather than lapse enforcement: an unresolvable banned member would leave
 * their content live, which is the fail-OPEN case the planner now reports as `unresolved`.
 */
export function resolveUsername(githubId, githubLogin, overrides, repoIndex) {
  const id = String(githubId ?? '');
  const fromIndex = overrides?.membersIndex?.get(id);
  if (fromIndex) return fromIndex;

  const byGithubId = repoIndex?.byGithubId;
  if (byGithubId && byGithubId.get(id)) return byGithubId.get(id);

  const login = githubLogin ? String(githubLogin).toLowerCase() : null;
  const byGithubLogin = repoIndex?.byGithubLogin;
  if (login && byGithubLogin && byGithubLogin.get(login)) return byGithubLogin.get(login);

  const byUsername = repoIndex?.byUsername;
  if (login && byUsername) {
    for (const folder of Object.keys(byUsername)) {
      if (folder.toLowerCase() === login) return folder;
    }
  }
  return null;
}

/**
 * Turn one Stripe Customer plus overrides into a member entry for the planner. Pure given `now`.
 * `repoIndex` (from buildRepoIndex) is used to resolve the owned folder authoritatively. discordRoles is
 * passed in by gatherMembers (the set of managed roles the member currently holds, from Discord
 * getMember); it defaults to empty so the planner stays idempotent when the Discord client is absent.
 */
export function memberEntryFor(customer, overrides, now, { repoIndex = null, discordRoles = [], priceTierMap = null } = {}) {
  const meta = customer.metadata ?? {};
  const githubId = String(meta.github_id ?? '');
  const githubLogin = meta.github_login ?? null;
  const derived = deriveStatusFromCustomer(customer, now);
  const effective = effectiveStatus(githubId, derived, overrides, now);
  // sow-185: resolve the effective TIER (override-aware) for the Content-Creator Discord badge. stripeTier comes
  // from the subscription's price id; the override source wins (staff/grandfather -> creator). INERT until the
  // price env is mapped. With no price env the map is empty and tierForPrice now fails closed to `none`
  // (2026-08-11); nothing consumes this tier unless shouldSyncCreatorRole is true, which needs that same env.
  const stripeTier = deriveMembershipFromCustomer(customer, { priceTierMap, now }).tier;
  const tier = resolveEffectiveTier({ source: effective.source, status: effective.status, stripeTier, grant: overrides.grandfathers.get(githubId) });
  const username = resolveUsername(githubId, githubLogin, overrides, repoIndex);
  return {
    githubId,
    githubLogin,
    discordUserId: meta.discord_user_id ?? null,
    email: customer.email ?? null,
    username,
    derived,
    effective,
    tier, // sow-185: the effective paid tier (drives the Content-Creator Discord badge)
    role: roleOf(githubId, overrides.roles),
    trialStartedAt: meta.trial_started_at ?? null,
    converted: isConverted(customer),
    discordRoles,
    couponGrant: couponGrantFor(githubId, overrides), // SOW-119: feeds the coupon-expiry reminder
  };
}

/** SOW-119: extract a coupon grant ({ code, until }) from the member's grandfather entry, if any. */
export function couponGrantFor(githubId, overrides) {
  const entry = overrides?.grandfathers?.get?.(String(githubId));
  const reason = String(entry?.reason ?? '');
  if (!entry || !entry.until || !reason.startsWith('coupon:')) return null;
  return { code: reason.slice('coupon:'.length), until: entry.until };
}

/**
 * Parse the optional DISCORD_MENTION_OVERRIDES env JSON ({ "<login>": "<discord_user_id>", ... }) into a
 * lowercased-login -> discord_user_id Map. This is the SAME map the content-syndication workflow uses to
 * resolve a content author's Discord mention; reconcile reuses it to find the discord_user_id of a
 * grandfathered/banned member who has NO Stripe customer, so it can still sync their managed Discord role.
 * discord_user_id is kept OUT of the public repo, so this rides a GitHub Actions secret, never a committed
 * file. Returns an empty Map on absent or invalid JSON (best-effort; never throws).
 */
export function parseDiscordUserMap(env = {}) {
  const map = new Map();
  const raw = env.DISCORD_MENTION_OVERRIDES;
  if (!raw) return map;
  let obj;
  try { obj = JSON.parse(raw); } catch { return map; }
  if (!obj || typeof obj !== 'object') return map;
  for (const [login, id] of Object.entries(obj)) {
    if (login && id) map.set(String(login).toLowerCase(), String(id));
  }
  return map;
}

/**
 * Resolve the SET of managed Discord roles a member CURRENTLY holds (a subset of 'member' | 'trial' |
 * 'locked' | 'creator') from their live guild member record. The planner reconciles the exclusive ACCESS
 * role (member/trial/locked) to exactly one, removing any stray, AND independently syncs the stackable
 * 'creator' badge (sow-185). Best-effort: any getMember error (including a missing member) returns [] so the
 * planner treats the member as holding no managed role and simply adds the target(s).
 */
export async function resolveDiscordRoles(discord, guildId, discordUserId, env) {
  if (!discord || !guildId || !discordUserId) return [];
  let member;
  try {
    member = await discord.getMember(guildId, discordUserId);
  } catch {
    // sow-218: NULL, not []. These are different facts and returning [] for both was a fail-open: the plan
    // only emits a remove-role for a role it can SEE held, so "unknown" read as "holds nothing" and a lapsed
    // member kept @Member (the role that actually grants access) through any transient Discord error.
    // planReconcile treats null as "assume anything" and strips every non-target role.
    //
    // ONLY this path. A 404 is handled below and is a different fact.
    return null;
  }
  // A null member is the 404 path, which clients/discord.mjs maps explicitly (`getMember`, :38). That is
  // KNOWN, not unknown: they are not in the guild, so they hold nothing. Returning null here instead would
  // make the planner emit three doomed role calls for every member who left or has a stale discord_user_id,
  // which is noise, not safety. Verified against a dry run: treating 404 as unknown took the plan from 3
  // actions to 15, all of them destined to fail.
  if (!member) return [];
  const roleIds = new Set((member.roles ?? []).map(String));
  const held = [];
  if (env.DISCORD_MEMBER_ROLE_ID && roleIds.has(String(env.DISCORD_MEMBER_ROLE_ID))) held.push('member');
  if (env.DISCORD_TRIAL_ROLE_ID && roleIds.has(String(env.DISCORD_TRIAL_ROLE_ID))) held.push('trial');
  if (env.DISCORD_LOCKED_ROLE_ID && roleIds.has(String(env.DISCORD_LOCKED_ROLE_ID))) held.push('locked');
  if (env.DISCORD_CREATOR_ROLE_ID && roleIds.has(String(env.DISCORD_CREATOR_ROLE_ID))) held.push('creator'); // sow-185: the stackable badge
  return held;
}

/**
 * Gather every member entry by iterating the CONSISTENT Stripe customer list (not Search). Threads
 * the repoIndex (authoritative folder resolution) and the Discord client + env (the set of managed
 * roles each member currently holds) into each entry. A non-paid/non-grandfathered member whose
 * folder does NOT resolve is logged as a WARNING so the owner can add them to members-index.yml (we
 * never silently skip a lapse).
 */
/**
 * sow-185: whether reconcile should sync the Content-Creator Discord badge this run. BOTH conditions are
 * required: (1) the owner has provisioned DISCORD_CREATOR_ROLE_ID, and (2) reconcile's env actually carries a
 * Stripe price map (buildEnvPriceTierMap non-empty). Condition 2 remains load-bearing even after tierForPrice
 * was made fail-closed (2026-08-11): an empty map now resolves every Stripe tier to `none` rather than to
 * creator, so the badge would not flood, but a GRANDFATHER grant still resolves to creator via grantTier
 * regardless of the price map. Enabling the badge on the role id alone would therefore still stamp @Creator on
 * all 16 grandfathered members in the live guild. Tying it to a populated price map keeps the badge inert until the
 * prices are wired into reconcile's env, so the role id can be committed now and stays correctly dormant until
 * then. reconcile.yml passes no price env today, so this is false in production until that changes. Pure.
 */
export function shouldSyncCreatorRole(env = {}) {
  return !!env.DISCORD_CREATOR_ROLE_ID && buildEnvPriceTierMap(env).size > 0;
}

export async function gatherMembers(stripe, overrides, now, { repoIndex = null, discord = null, env = {} } = {}) {
  const members = [];
  const guildId = env.DISCORD_GUILD_ID ?? null;
  const priceTierMap = buildEnvPriceTierMap(env); // sow-185: built once; INERT (legacy $150 -> creator) until the $5 price is mapped
  for await (const customer of stripe.listCustomers()) {
    const meta = customer.metadata ?? {};
    if (!meta.github_id) continue; // not a membership customer
    const githubId = String(meta.github_id);
    const discordRoles = await resolveDiscordRoles(discord, guildId, meta.discord_user_id ?? null, env);
    const entry = memberEntryFor(customer, overrides, now, { repoIndex, discordRoles, priceTierMap });

    // NO "unresolved folder" WARNING HERE, deliberately. Removed 2026-08-11; do not re-add it.
    //
    // It used to fire for any member who was not effectively paid and had no resolvable folder, on the
    // rationale that "their content cannot be drafted on lapse". SOW-197 removed that behaviour: a lapse no
    // longer touches content in either direction, so the reason the warning existed is gone.
    //
    // What remained was a false positive that grew with every signup. Publishing is paid-only and a folder
    // is minted only at publish (enrollmentCandidates enrolls PAID members exclusively), so every free or
    // trial member who never published has no folder BY DESIGN and tripped it. Worse, the remediation it
    // printed, "add a members-index.yml entry", contradicts that rule: hand-adding a non-paid member is not
    // something the system would ever do for itself. It produced owner to-do items that could not be
    // correctly actioned, and two of them were carried across three band compactions before anyone checked
    // the premise.
    //
    // The case that genuinely still matters, a BANNED member whose folder cannot be resolved so the ban
    // cannot be enforced, is covered strictly better in scripts/lib/reconcile-plan.mjs by the `unresolved`
    // action: it surfaces the member AND exits non-zero, where this only printed to stderr.
    members.push(entry);
  }
  return members;
}

/**
 * Gather member entries for grandfathered / banned github_ids that have NO Stripe customer, so their
 * managed Discord role is still synced. gatherMembers iterates Stripe customers only, so a complimentary
 * co-op member granted access who never ran the paid signup (no Stripe customer) would otherwise never be
 * enumerated, and their Member role never assigned. `seen` is the set of github_ids already produced from
 * Stripe (skip those: their Stripe metadata is authoritative for trial/discord ids). discord_user_id is
 * resolved from the DISCORD_MENTION_OVERRIDES login->id map (kept out of the public repo). A member whose
 * discord_user_id does not resolve still yields an entry (so a later content reconcile can find their
 * folder), but with no discordUserId the planner emits no Discord action for them. Effective status comes
 * from the overrides alone (derived 'none', no Stripe): grandfather -> paid -> Member role; ban -> Locked.
 */
export async function gatherOverrideOnlyMembers(overrides, now, { seen = new Set(), repoIndex = null, discord = null, env = {} } = {}) {
  const members = [];
  const userMap = parseDiscordUserMap(env);
  const guildId = env.DISCORD_GUILD_ID ?? null;
  // grandfathered + banned entries each carry { github_id, login }. bans first so a banned id wins the
  // dedupe over a (contradictory) grandfather listing of the same id; effectiveStatus enforces ban anyway.
  const entries = [...(overrides?.bans?.values?.() ?? []), ...(overrides?.grandfathers?.values?.() ?? [])];
  for (const e of entries) {
    const githubId = String(e?.github_id ?? '');
    if (!githubId || seen.has(githubId)) continue;
    seen.add(githubId);
    const login = e?.login ?? null;
    const discordUserId = login ? (userMap.get(String(login).toLowerCase()) ?? null) : null;
    const effective = effectiveStatus(githubId, 'none', overrides, now);
    // sow-185: resolve the tier for the Content-Creator Discord badge. These override-only members have NO
    // Stripe subscription, so the tier comes entirely from the override (grandfather -> the grant's tier,
    // default member (owner Q15); staff -> creator; ban -> none). Mirrors memberEntryFor so the Stripe-customer path and
    // this override-only path agree, and so a grandfathered creator is not stripped of @Creator every run.
    const tier = resolveEffectiveTier({ source: effective.source, status: effective.status, grant: overrides.grandfathers.get(githubId) });
    const username = resolveUsername(githubId, login, overrides, repoIndex);
    const discordRoles = await resolveDiscordRoles(discord, guildId, discordUserId, env);
    members.push({
      githubId,
      githubLogin: login,
      discordUserId,
      email: null,
      username,
      derived: 'none',
      effective,
      tier, // sow-185: keep the Content-Creator badge consistent with the Stripe-customer path + the Worker
      role: roleOf(githubId, overrides.roles),
      trialStartedAt: null,
      converted: false,
      discordRoles,
    });
  }
  return members;
}

/**
 * Gather only the single targeted member (FIX 4). In repository_dispatch 'regate' mode we fetch ONLY
 * that customer via Stripe Search (instead of iterating every customer) and build one member entry, so
 * a just-paid member's Discord role is upgraded right away. Returns an array of zero or one member entries.
 */
export async function gatherTargetedMember(stripe, overrides, now, githubId, { repoIndex = null, discord = null, env = {} } = {}) {
  const customer = await stripe.searchCustomerByGithubId(githubId);
  if (!customer) {
    console.warn(`reconcile: targeted github_id ${githubId} has no Stripe customer (Search lag or no signup). Nothing to do.`);
    return [];
  }
  const discordRoles = await resolveDiscordRoles(discord, env.DISCORD_GUILD_ID ?? null, customer.metadata?.discord_user_id ?? null, env);
  return [memberEntryFor(customer, overrides, now, { repoIndex, discordRoles, priceTierMap: buildEnvPriceTierMap(env) })];
}
