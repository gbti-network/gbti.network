// Signup Worker entrypoint (SOW-002, the only always-on surface). A Cloudflare Worker ESM fetch
// handler that wires the frozen Stripe + Discord clients to the pure modules in this folder and
// routes the signup, checkout, and optional webhook paths.
//
// Routes:
//   GET  /healthz                  liveness probe (no secrets touched)
//   GET  /signup/start             abuse checks, then redirect to GitHub OAuth (state carries ?ref)
//   GET  /signup/github/callback   exchange GitHub code -> github_id; redirect to Discord OAuth
//   GET  /signup/discord/callback  exchange Discord code -> discord id + email; run the signup chain;
//                                  set the signed session cookie; redirect to /account
//   POST /checkout                 session -> resolve customer -> Stripe Checkout Session -> redirect
//   POST /webhook                  OPTIONAL verified Stripe webhook (real-time Discord role sync)
//
// Local dev: this is a Worker, so there is no bind port to free. Run it with
//   `npx wrangler dev workers/signup/index.mjs --local`
// which picks its own local port and respects .dev.vars. The CLAUDE.md port-fallback rule applies to
// long-running node servers (Astro dev, the SOW-006 client); it does not apply to a Worker because
// wrangler manages the local port and production runs on Cloudflare's edge with no fixed port.
//
// State across the OAuth hops is carried in the signed `state` parameter (an HMAC-protected blob via
// session.mjs sign/verify) so we need no server-side session store between the two callbacks. The
// state round-trips the referral code and (after the GitHub hop) the resolved github_id + login so
// the Discord callback can run the signup chain without a database.
//
// CSRF control (FIX 4): the HMAC signature over the state blob IS the CSRF defense. A callback only
// proceeds when unpackState verifies the signature with SESSION_SECRET, so an attacker cannot mint or
// tamper with a state value, and a forged callback (one not issued by us) is rejected. An additional
// browser-bound nonce cookie would have to survive a full-page redirect out to GitHub and Discord and
// back across origins, which a SameSite cookie does not reliably do over the two external hops; the
// signed, server-held SESSION_SECRET already gives an unforgeable binding, so we do not carry a
// separate nonce. The short TTL on the state token (600 seconds) further bounds replay.

import { createStripeClient } from '../../clients/stripe.mjs';
import { createDiscordClient } from '../../clients/discord.mjs';

import { signSession, verifySession, sessionCookieHeader, readSessionCookie } from './session.mjs';
import {
  githubAuthorizeUrl,
  githubExchangeCode,
  githubFetchUser,
  discordAuthorizeUrl,
  discordExchangeCode,
  discordFetchUser,
} from './oauth.mjs';
import { verifyTurnstile, rateLimit } from './abuse.mjs';
import { runSignup } from './signup.mjs';
import { resolveCustomerId, createCheckout } from './checkout.mjs';
import { startOnboarding } from './connect.mjs';
import { verifyStripeSignature, isDuplicateEvent, markEventSeen, handleStripeEvent } from './webhook.mjs';
import { membershipStatus } from './membership-status.mjs';
import { membershipDecrypt, membershipEncrypt } from './membership-content.mjs';
import { membershipAdminStatuses } from './membership-admin.mjs';
import { handleActivity } from './membership-activity.mjs';
import { handleFollows } from './membership-follows.mjs';
import { membershipNews, membershipNewsCategories, membershipNewsSources } from './membership-news.mjs'; // SOW-043/046: members-only news proxy
import { handlePrefs } from './membership-prefs.mjs'; // SOW-046: member prefs (categories + followed news channels)
import { handleDiscordInvite } from './discord-invite.mjs';
import { openPullForMember, listMemberPulls, memberPrStatus, listOpenPullsForReview, reviewPrDetail, reviewPrFiles, reviewFileContent } from './github-app.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
// CORS for the membership endpoints (token-authenticated, no cookies). Covers BOTH the GET reads (status oracle,
// my-pulls, pr-status) and the POST mutations (open-pr, activity, follows), so the preflight must allow POST +
// Content-Type. Safe cross-origin: wildcard origin + bearer-token auth + NO cookies, so broadening the methods
// cannot enable CSRF (there is no ambient credential to ride).
const MEMBERSHIP_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// SOW-016: the member-content crypto endpoints are POST with a JSON body, so they need POST + Content-Type in
// the preflight. Still wildcard-origin + no cookies (bearer-token auth), safe cross-origin.
const MEMBER_CONTENT_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function redirect(location, extraHeaders = {}) {
  return new Response(null, { status: 302, headers: { Location: location, ...extraHeaders } });
}

/** Build the two collaborator clients from env (least-privilege keys, see .dev.vars.example). */
function clientsFromEnv(env) {
  return {
    stripe: createStripeClient({ apiKey: env.STRIPE_SECRET_KEY }),
    discord: createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN }),
  };
}

function discordConfig(env) {
  return {
    guildId: env.DISCORD_GUILD_ID,
    trialRoleId: env.DISCORD_TRIAL_ROLE_ID,
    memberRoleId: env.DISCORD_MEMBER_ROLE_ID,
    signupSource: 'signup-worker',
  };
}

// state is a signed blob carrying { ref, via, githubId?, githubLogin? } between the OAuth hops. The HMAC
// signature over the blob is the CSRF control (FIX 4): a callback proceeds only when the signature
// verifies, so the state cannot be forged or tampered with. There is no separate browser nonce; see
// the CSRF note in the file header for why a cookie-bound nonce is not used across the external hops.
//
// We reuse signSession/verifySession as the signing primitive. signSession requires a non-empty
// github_id, so we pin it to a fixed marker ('state') and carry the real payload as JSON in the
// github_login slot. A short 600-second TTL bounds replay of an issued state token.
const STATE_SUBJECT = 'state';

export async function packState(payload, env) {
  return signSession({ githubId: STATE_SUBJECT, githubLogin: JSON.stringify(payload) }, env.SESSION_SECRET, {
    ttlSeconds: 600,
  });
}
export async function unpackState(token, env) {
  const verified = await verifySession(token, env.SESSION_SECRET);
  if (!verified || verified.github_id !== STATE_SUBJECT) return null;
  try {
    return JSON.parse(verified.github_login);
  } catch {
    return null;
  }
}

async function handleStart(request, env) {
  const url = new URL(request.url);
  const ip = request.headers.get('CF-Connecting-IP') || '';

  // Abuse checks FIRST, before any OAuth or registry work.
  const turnstileToken = url.searchParams.get('cf-turnstile-response') || '';
  const ok = await verifyTurnstile({ token: turnstileToken, secret: env.TURNSTILE_SECRET_KEY, remoteIp: ip });
  if (!ok) return json({ error: 'turnstile_failed' }, 403);

  const rl = await rateLimit({ kv: env.SIGNUP_KV, ip });
  if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

  const ref = url.searchParams.get('ref') || '';
  // The content the reader first landed on (SOW-007/008). Carried alongside ?ref so the payout job can
  // split the owner's commission with that content's contributors + commenters. Validated at signup.mjs.
  const via = url.searchParams.get('via') || '';
  // No browser-bound nonce: the HMAC signature over the state blob is the CSRF control (FIX 4).
  const state = await packState({ ref, via }, env);
  const location = githubAuthorizeUrl({
    clientId: env.GITHUB_OAUTH_CLIENT_ID,
    redirectUri: `${env.PUBLIC_BASE_URL}/signup/github/callback`,
    state,
  });
  return redirect(location);
}

async function handleGithubCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await unpackState(url.searchParams.get('state'), env);
  if (!code || !state) return json({ error: 'bad_oauth_state' }, 400);

  const accessToken = await githubExchangeCode(
    {
      clientId: env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirectUri: `${env.PUBLIC_BASE_URL}/signup/github/callback`,
    },
    globalThis.fetch,
  );
  const { githubId, githubLogin } = await githubFetchUser(accessToken, globalThis.fetch);

  // Carry the resolved identity (and the first-touch ref + via) into the Discord hop via a fresh state.
  const nextState = await packState({ ref: state.ref, via: state.via, githubId, githubLogin }, env);
  const location = discordAuthorizeUrl({
    clientId: env.DISCORD_OAUTH_CLIENT_ID,
    redirectUri: `${env.PUBLIC_BASE_URL}/signup/discord/callback`,
    state: nextState,
  });
  return redirect(location);
}

async function handleDiscordCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await unpackState(url.searchParams.get('state'), env);
  if (!code || !state || !state.githubId) return json({ error: 'bad_oauth_state' }, 400);

  const { accessToken } = await discordExchangeCode(
    {
      clientId: env.DISCORD_OAUTH_CLIENT_ID,
      clientSecret: env.DISCORD_OAUTH_CLIENT_SECRET,
      code,
      redirectUri: `${env.PUBLIC_BASE_URL}/signup/discord/callback`,
    },
    globalThis.fetch,
  );
  const { discordUserId, email } = await discordFetchUser(accessToken, globalThis.fetch);

  const { stripe, discord } = clientsFromEnv(env);
  await runSignup({
    identity: {
      githubId: state.githubId,
      githubLogin: state.githubLogin,
      discordUserId,
      email,
      discordAccessToken: accessToken,
    },
    stripe,
    discord,
    kv: env.SIGNUP_KV,
    config: discordConfig(env),
    refCode: state.ref,
    via: state.via,
  });

  const session = await signSession({ githubId: state.githubId, githubLogin: state.githubLogin }, env.SESSION_SECRET);
  return redirect(`${env.PUBLIC_BASE_URL}/account`, { 'Set-Cookie': sessionCookieHeader(session) });
}

async function handleCheckout(request, env) {
  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  if (!session) return json({ error: 'no_session' }, 401);

  const { stripe } = clientsFromEnv(env);
  const customerId = await resolveCustomerId({ githubId: session.github_id, kv: env.SIGNUP_KV, stripe });
  if (!customerId) return json({ error: 'no_customer' }, 409); // fail closed

  const checkout = await createCheckout({
    stripe,
    customerId,
    priceId: env.STRIPE_PRICE_ID,
    githubId: session.github_id,
    baseUrl: env.PUBLIC_BASE_URL,
  });
  return redirect(checkout.url);
}

// FIX 1: the post-payment landing. Stripe's success_url (built in checkout.mjs) points here with a
// `gh` param. We validate that gh against the signed session cookie (the github_id MUST match the
// session) before kicking the targeted re-gate that releases the member's held content PRs and
// upgrades their Discord role right away. Fail closed: if the session is missing or gh does not match
// the session, we still redirect to /account (so the browser lands somewhere sane) but we do NOT kick
// the re-gate; the daily scheduled reconcile heals that member on its next run.
async function handleCheckoutSuccess(request, env) {
  const url = new URL(request.url);
  const gh = url.searchParams.get('gh') || '';
  const accountUrl = `${env.PUBLIC_BASE_URL}/account`;

  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  // The gh param must match the authenticated session's github_id. A missing session, a missing gh,
  // or a mismatch means we cannot trust the caller to nudge a re-gate, so we skip it (fail closed).
  if (!session || !gh || String(session.github_id) !== String(gh)) {
    return redirect(accountUrl);
  }

  const { kickRegate } = await import('./checkout.mjs');
  await kickRegate(
    { githubId: session.github_id, dispatchToken: env.REGATE_DISPATCH_TOKEN, contentRepo: env.GITHUB_CONTENT_REPO },
    globalThis.fetch,
  );
  return redirect(accountUrl);
}

// SOW-007: Stripe Connect Express onboarding for referral payouts. Gated behind REFERRAL_ENABLED (an
// env flag the owner sets to mirror house/referral-config.yml `enabled` when the feature goes live), so
// the onboarding entry point stays dark until referrals are advertised. Both /start (a POST from the
// account page) and /refresh (Stripe's redirect when an Account Link expires) mint a fresh onboarding
// link for the session's own customer. Fail closed: no session or no customer means no onboarding.
async function handleConnectOnboard(request, env) {
  if (env.REFERRAL_ENABLED !== 'true') return json({ error: 'referral_disabled' }, 403);
  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  if (!session) return json({ error: 'no_session' }, 401);

  const { stripe } = clientsFromEnv(env);
  const customerId = await resolveCustomerId({ githubId: session.github_id, kv: env.SIGNUP_KV, stripe });
  if (!customerId) return json({ error: 'no_customer' }, 409); // fail closed
  const customer = await stripe.getCustomer(customerId);

  const { url } = await startOnboarding({ stripe, customer, email: customer.email, baseUrl: env.PUBLIC_BASE_URL });
  return redirect(url);
}

// The return_url after onboarding finishes (or the referrer backs out). Onboarding completeness is
// verified server-side by the payout job (it reads the Connect account's payouts_enabled), so here we
// only need to land the browser somewhere sane.
async function handleConnectReturn(request, env) {
  return redirect(`${env.PUBLIC_BASE_URL}/account?connect=done`);
}

async function handleWebhook(request, env) {
  const payload = await request.text();
  const event = await verifyStripeSignature({
    payload,
    signature: request.headers.get('Stripe-Signature'),
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  if (!event) return json({ error: 'invalid_signature' }, 400); // fail closed

  // FIX 2: check-seen BEFORE processing (return early on a true duplicate), but persist the seen-mark
  // ONLY AFTER the handler succeeds. If the handler throws (for example a transient Discord failure),
  // we do NOT mark the event seen and we return a non-2xx so Stripe retries; the retry then re-runs
  // the idempotent handler. Marking seen up front would make a transient failure look like a duplicate
  // on retry and silently drop the role change.
  if (await isDuplicateEvent({ kv: env.SIGNUP_KV, eventId: event.id })) {
    return json({ ok: true, duplicate: true });
  }

  const { stripe, discord } = clientsFromEnv(env);
  let summary;
  try {
    summary = await handleStripeEvent({
      event,
      stripe,
      discord,
      config: discordConfig(env),
      signalDisable: async (githubId) => {
        // Reuse the checkout re-gate dispatch mechanism to signal SOW-005 to disable content.
        const { kickRegate } = await import('./checkout.mjs');
        await kickRegate(
          { githubId, dispatchToken: env.REGATE_DISPATCH_TOKEN, contentRepo: env.GITHUB_CONTENT_REPO },
          globalThis.fetch,
        );
      },
    });
  } catch (err) {
    // Do NOT mark the event seen. Return non-2xx so Stripe retries the delivery; the idempotent
    // handler re-runs on the next attempt. Fail closed: no seen-mark is persisted on a failed handler.
    console.error('webhook handler failed', event.id, err?.message);
    return json({ error: 'handler_failed' }, 500);
  }

  // Handler succeeded: now it is safe to record the event id so future retries short-circuit.
  await markEventSeen({ kv: env.SIGNUP_KV, eventId: event.id });
  return json({ ok: true, summary });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    try {
      if (method === 'GET' && pathname === '/healthz') return json({ ok: true });

      if (method === 'GET' && pathname === '/signup/start') return await handleStart(request, env);
      if (method === 'GET' && pathname === '/signup/github/callback') return await handleGithubCallback(request, env);
      if (method === 'GET' && pathname === '/signup/discord/callback') return await handleDiscordCallback(request, env);

      if (method === 'POST' && pathname === '/checkout') return await handleCheckout(request, env);
      if (method === 'GET' && pathname === '/checkout/success') return await handleCheckoutSuccess(request, env);

      if (method === 'POST' && pathname === '/referral/connect/start') return await handleConnectOnboard(request, env);
      if (method === 'GET' && pathname === '/referral/connect/refresh') return await handleConnectOnboard(request, env);
      if (method === 'GET' && pathname === '/referral/connect/return') return await handleConnectReturn(request, env);

      if (method === 'POST' && pathname === '/webhook') return await handleWebhook(request, env);

      // SOW-011: the membership-status oracle for the local client (GitHub-bearer-token authenticated).
      // Cross-origin (the extension + the npm host call it), and it carries no cookies, so a wildcard CORS
      // origin with an Authorization allow-header is safe (no ambient credentials are exposed).
      if (pathname === '/membership/status') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await membershipStatus(request, env);
          // Per-token, per-user body: never cache it by URL, and vary on the bearer so no shared cache can
          // serve one caller's status to another (mirrors the decrypt/encrypt responses).
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-016: server-side member-content crypto. The AES-256-GCM epoch key NEVER leaves the Worker
      // (this supersedes the SOW-015 /membership/key handout). Both are POST, effective-paid gated, and
      // fail-closed; the decrypt response carries plaintext, so it is never cached.
      if (pathname === '/membership/decrypt' || pathname === '/membership/encrypt') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBER_CONTENT_CORS });
        if (method === 'POST') {
          const r = pathname === '/membership/decrypt'
            ? await membershipDecrypt(request, env)
            : await membershipEncrypt(request, env);
          return json(r.body, r.status, { ...MEMBER_CONTENT_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-024: member activity (favorites + collections) in the deletable edge store. Token-authenticated,
      // per-member, private, ERASABLE. Per-token body, so never cached and varied on the bearer.
      if (pathname === '/membership/activity') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET' || method === 'POST') {
          const r = await handleActivity(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-038 P2: admin-only per-member Stripe status for the superadmin dashboard. Sensitive billing status,
      // so admin-gated (fail-closed via the overrides mirror) + never cached, varied on the bearer.
      if (pathname === '/membership/admin/statuses') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await membershipAdminStatuses(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-023: the member follow graph (subscriptions) in the deletable edge store. Effective-paid only
      // (read + write), per-member, private, ERASABLE. Per-token body, so never cached and varied on the bearer.
      if (pathname === '/membership/follows') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET' || method === 'POST') {
          const r = await handleFollows(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-043: the members-only news proxy. Effective-paid gated; the news worker's NEWS_API_KEY is held by this
      // Worker and never reaches the client. Per-token body, so never cached and varied on the bearer.
      if (pathname === '/membership/news' || pathname === '/membership/news-categories' || pathname === '/membership/news-sources') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = pathname === '/membership/news' ? await membershipNews(request, env)
            : pathname === '/membership/news-sources' ? await membershipNewsSources(request, env)
            : await membershipNewsCategories(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-046: member prefs (category interests + followed news channels) in the deletable edge store.
      // Effective-paid, per-member, private, ERASABLE. Per-token body, so never cached and varied on the bearer.
      if (pathname === '/membership/prefs') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET' || method === 'POST') {
          const r = await handlePrefs(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-026: open the publish PR for a paid member. The member's fork-scoped App token cannot open a PR into
      // the canonical repo, so the Worker opens it with GBTI's own canonical-repo App installation token. The
      // App private key never leaves the Worker; the member token only authorizes + identifies them (head must
      // be their own fork). Fail-closed paid-only.
      if (pathname === '/membership/open-pr') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'POST') {
          const r = await openPullForMember(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-026: read-side proxy so the client can show PR status in app mode. A fork-scoped member token cannot
      // read the canonical repo, so the Worker reads with GBTI's installation token, SCOPED to the caller's own
      // fork (the App opens the PRs, so they are matched by head owner, not author). Public data; member-scoped.
      if (pathname === '/membership/my-pulls') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await listMemberPulls(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/pr-status') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await memberPrStatus(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-028: read proxies for the in-client contribution review INBOX in app mode. A fork-scoped member token
      // cannot read the upstream, so the Worker reads it with GBTI's installation token. Unlike my-pulls/pr-status
      // these are NOT head-owner-scoped (the inbox is about OTHER members' PRs against the caller's folder), which
      // is safe because the canonical repo is public; the client filters to the caller's folder. Reads only;
      // approving still happens on github.com in app mode (the gate needs the owner's own github_id as author).
      if (pathname === '/membership/open-pulls') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await listOpenPullsForReview(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/pr') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await reviewPrDetail(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/pr-files') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await reviewPrFiles(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/file') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await reviewFileContent(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // On-demand Discord guild invite for the welcome view. The bot mints a real invite (token never leaves the
      // Worker), cached in KV so we do not spam Discord; fail-closed to the static DISCORD_INVITE_URL. Auth = a
      // verified GitHub token; channel access is still governed by the reconcile role sync.
      if (pathname === '/membership/discord-invite') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          // Build the bot client defensively: if DISCORD_BOT_TOKEN is unset, the handler falls back to the
          // static DISCORD_INVITE_URL rather than 500-ing.
          let discord = null;
          try { discord = clientsFromEnv(env).discord; } catch { discord = null; }
          const r = await handleDiscordInvite(request, env, { discord });
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      // Never leak internals; log server-side. Fail closed (no partial success surfaced to the client).
      console.error('signup worker error', pathname, err?.message);
      return json({ error: 'internal_error' }, 500);
    }
  },
};
