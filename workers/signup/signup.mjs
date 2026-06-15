// Signup orchestration (membership-and-access.md section 3). Given the identity already resolved by
// the two OAuth callbacks (github_id + login, discord_user_id + email + access_token), this:
//   1. creates OR reuses the Stripe Customer keyed by the immutable github_id (idempotent),
//   2. NEVER resets trial_started_at on an existing Customer (the trial clock is set once, at first
//      creation, and is sacred),
//   3. writes the github_id -> customer_id KV index entry for instant, consistent gate lookups,
//   4. adds the user to the Discord guild with the Trial role (guilds.join via the user's token),
//   5. returns the customer id + a flag for the caller to mint a signed session cookie.
//
// Pure-ish: all side-effecting collaborators (stripe, discord, kv) are injected, so the whole chain
// is fixture-testable with no network. Fail closed only applies to membership STATUS decisions; here
// we surface errors to the caller so a failed signup is retried (the customer step is idempotent).
//
// This module imports the frozen Stripe + Discord client contracts via the orchestrator's injected
// instances; it does not construct them itself (the Worker entrypoint wires them with real secrets).

import { resolveReferral } from './referral.mjs';

/**
 * Decide whether to reuse an existing Stripe Customer or create a new one for this github_id.
 * Pure and separately tested: returns { action:'reuse'|'create', customerId? }.
 *
 * @param {object|null} existingCustomer  the result of stripe.searchCustomerByGithubId(github_id).
 */
export function decideCustomer(existingCustomer) {
  if (existingCustomer && existingCustomer.id) {
    return { action: 'reuse', customerId: existingCustomer.id };
  }
  return { action: 'create' };
}

/**
 * The content the new member first landed on, e.g. `post:my-slug` (SOW-007/008). Stored verbatim so the
 * payout job can find that content's per-content delegation + contributors + commenters and split the
 * owner's commission. Validated to a strict `<type>:<kebab-slug>` shape; anything else is dropped (fail
 * safe: a bad/spoofed via just yields no delegation, the owner keeps 100%). It is NOT the earner key, only
 * the content pointer: the earner is `referred_by` (the content author's github_id), set independently.
 */
const VIA_RE = /^(post|product|prompt):[a-z0-9-]+$/;
export function normalizeVia(via) {
  if (!via) return null;
  const v = String(via).trim().slice(0, 200);
  return VIA_RE.test(v) ? v : null;
}

/**
 * Build the metadata for a brand-new Customer. trial_started_at is set HERE and only here.
 * referred_by is included only when a valid (non-self) referral resolved. via is the landed-on content.
 */
export function buildNewCustomerMetadata({ githubId, githubLogin, discordUserId, trialStartedAt, signupSource, referredBy, via }) {
  const metadata = {
    github_id: String(githubId),
    github_login: githubLogin ? String(githubLogin) : '',
    discord_user_id: String(discordUserId),
    trial_started_at: trialStartedAt,
  };
  if (signupSource) metadata.signup_source = String(signupSource);
  if (referredBy) metadata.referred_by = String(referredBy);
  const v = normalizeVia(via);
  if (v) metadata.via = v;
  return metadata;
}

/**
 * Metadata to refresh on an EXISTING Customer. We opportunistically refresh the display login and
 * the discord id (a member may have re-linked), but we deliberately OMIT trial_started_at,
 * signup_source, and referred_by so a re-run can never reset the trial clock or rewrite first-touch
 * referral attribution.
 */
export function buildRefreshMetadata({ githubLogin, discordUserId }) {
  const metadata = {};
  if (githubLogin) metadata.github_login = String(githubLogin);
  if (discordUserId) metadata.discord_user_id = String(discordUserId);
  return metadata;
}

/**
 * Run the signup chain.
 *
 * @param {object} a
 * @param {object} a.identity   { githubId, githubLogin, discordUserId, email, discordAccessToken }
 * @param {object} a.stripe     a createStripeClient() instance (frozen client).
 * @param {object} a.discord    a createDiscordClient() instance (frozen client).
 * @param {object} a.kv         KV namespace for the github_id -> customer_id index: put(key,value).
 * @param {object} a.config     { guildId, trialRoleId, signupSource? }.
 * @param {string} [a.refCode]  raw ?ref value carried from the entry redirect (first-touch referral).
 * @param {string} [a.via]      raw ?via value (the content the reader landed on, e.g. `post:slug`).
 * @param {(code:string)=>string|null} [a.resolveReferral]  ref-code resolver (defaults to identity).
 * @param {Date}   [a.now]      injectable clock (trial_started_at source).
 * @returns {Promise<{ customerId:string, created:boolean, referredBy:string|null }>}
 */
export async function runSignup({ identity, stripe, discord, kv, config, refCode, via, resolveReferral: resolver, now = new Date() }) {
  const { githubId, githubLogin, discordUserId, email, discordAccessToken } = identity;
  if (!githubId) throw new Error('runSignup: githubId is required');
  if (!discordUserId || !discordAccessToken) throw new Error('runSignup: discord identity + access token are required');

  // First-touch referral, self-reject. Only used when we create a new Customer.
  const referredBy = resolveReferral({ refCode, newMemberGithubId: githubId, resolve: resolver });

  // Idempotent by github_id: look up an existing Customer first.
  const existing = await stripe.searchCustomerByGithubId(String(githubId));
  const plan = decideCustomer(existing);

  let customerId;
  let created = false;
  if (plan.action === 'reuse') {
    customerId = plan.customerId;
    // Opportunistic refresh of mutable display fields. trial_started_at is NEVER touched here.
    const refresh = buildRefreshMetadata({ githubLogin, discordUserId });
    const update = { metadata: refresh };
    if (email) update.email = email; // keep Stripe's email current for receipts + day-87 reminder
    if (Object.keys(refresh).length > 0 || email) {
      await stripe.updateCustomer(customerId, update);
    }
  } else {
    const metadata = buildNewCustomerMetadata({
      githubId,
      githubLogin,
      discordUserId,
      trialStartedAt: now.toISOString(),
      signupSource: config?.signupSource,
      referredBy,
      via,
    });
    // Idempotency key derived from github_id so a retried create cannot double-insert.
    const customer = await stripe.createCustomer({ email: email || undefined, metadata }, `signup:${githubId}`);
    customerId = customer.id;
    created = true;
  }

  // Write the github_id -> customer_id index for instant, consistent gate lookups (beats Search lag).
  if (kv && customerId) {
    await kv.put(`gh:${githubId}`, customerId);
  }

  // Add the user to the guild (guilds.join uses the user's OAuth access token). The `roles` param is
  // honored ONLY when Discord actually adds a brand-new member; for a user already in the guild Discord
  // returns 204 and ignores it. So we ALSO assign the Trial role explicitly, which is idempotent and
  // works for both new and existing members. (The bot's role must sit above the Trial role.)
  await discord.addGuildMember(config.guildId, discordUserId, {
    accessToken: discordAccessToken,
    roles: [config.trialRoleId],
  });
  await discord.addRole(config.guildId, discordUserId, config.trialRoleId);

  return { customerId, created, referredBy: created ? (referredBy ?? null) : null };
}
