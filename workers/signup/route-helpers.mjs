// Shared response, CORS and client helpers for the signup Worker's routes. Moved out of index.mjs at the 900-line
// limit (owner, 2026-09-30), so every route module shares one json(), one redirect() and one set of CORS headers
// without importing the entry point.

import { createStripeClient } from '../../clients/stripe.mjs';
import { createDiscordClient } from '../../clients/discord.mjs';
import { buildEnvPriceTierMap } from '../../membership/tier-gate.mjs'; // sow-185: price -> tier map for the Creator badge

const JSON_HEADERS = { 'Content-Type': 'application/json' };
// CORS for the membership endpoints (token-authenticated, no cookies). Covers BOTH the GET reads (status oracle,
// my-pulls, pr-status) and the POST mutations (activity, follows), so the preflight must allow POST +
// Content-Type. Safe cross-origin: wildcard origin + bearer-token auth + NO cookies, so broadening the methods
// cannot enable CSRF (there is no ambient credential to ride).
export const MEMBERSHIP_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// SOW-016: the member-content crypto endpoints are POST with a JSON body, so they need POST + Content-Type in
// the preflight. Still wildcard-origin + no cookies (bearer-token auth), safe cross-origin.
export const MEMBER_CONTENT_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// sow-158 Phase 1b: `cookies` is an optional array of Set-Cookie strings. A plain headers object cannot hold two
// Set-Cookie keys (the OAuth callbacks now set BOTH the session and the CSRF cookie, and logout expires both), so
// build a Headers object and append each. extraHeaders may still carry a single Set-Cookie (the OAuth nonce flows).
export function json(body, status = 200, extraHeaders = {}, cookies = []) {
  const headers = new Headers({ ...JSON_HEADERS, ...extraHeaders });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

export function redirect(location, extraHeaders = {}, cookies = []) {
  const headers = new Headers({ Location: location, ...extraHeaders });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

/** Build the two collaborator clients from env (least-privilege keys, see .dev.vars.example). */
export function clientsFromEnv(env) {
  return {
    stripe: createStripeClient({ apiKey: env.STRIPE_SECRET_KEY }),
    discord: createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN }),
  };
}

export function discordConfig(env) {
  return {
    guildId: env.DISCORD_GUILD_ID,
    trialRoleId: env.DISCORD_TRIAL_ROLE_ID,
    memberRoleId: env.DISCORD_MEMBER_ROLE_ID,
    // sow-218: all three ids are now needed, because signup RESOLVES which one to assign (resolveSignupRole)
    // rather than hardcoding one, and SWAPS to it (stripping the other two). `locked` is the fail-closed
    // fallback, not the default.
    lockedRoleId: env.DISCORD_LOCKED_ROLE_ID,
    // sow-185: the stackable Content Creator badge, a separate axis from the exclusive access role. Unset ->
    // signup touches it at all, matching how reconcile gates the same axis.
    creatorRoleId: env.DISCORD_CREATOR_ROLE_ID,
    // sow-185: so signup can resolve a paying subscriber's TIER for the badge above. Without it every price is
    // unknown and resolves to `none` (fail closed), which withholds the badge until reconcile adds it.
    priceTierMap: buildEnvPriceTierMap(env),
    signupSource: 'signup-worker',
  };
}
