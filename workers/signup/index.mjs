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
//
// The router is split across modules at the 900-line limit (owner, 2026-09-30). This file keeps the default
// export, the /auth/* routes, the anonymous touch, mail and sponsorship routes, and the order of the checks. The
// signup, billing, member and admin routes live in signup-routes.mjs, billing-routes.mjs, member-routes.mjs and
// admin-routes.mjs, called in that order (ROUTE_GROUPS); cron.mjs holds the scheduled jobs, route-helpers.mjs the
// shared helpers and oauth-state.mjs the OAuth state. Every name this file exported before is re-exported below.

import { wlog } from './wlog.mjs'; // SOW-124: Worker diagnostic logger (redacted, retained via [observability])

import { signSession, sessionCookieHeader } from './session.mjs';
import { handleExtensionStart, handleExtensionClaim } from './extension-signin.mjs'; // sow-393: extension sign-in through the website
import { githubRefreshToken, githubFetchUser } from './oauth.mjs';
import { rateLimit } from './abuse.mjs';
import { handleTouch } from './membership-touches.mjs'; // SOW-059 P1b: touch capture
import { handleUnsubscribe } from './membership-unsubscribe.mjs'; // SOW-166: one-click digest unsubscribe (RFC 8058)
import { handleMailClick } from './mail-click-route.mjs'; // sow-273 follow-up: the digest click counter
import { handleMailOpen } from './mail-open-route.mjs'; // the digest open counter (1x1 pixel)
import { handleDigestWeb } from './mail-web-route.mjs'; // sow-383: GET /digest/<issueId>, the web edition
import { handleSubscribe, handleConfirm } from './mail-subscribe.mjs'; // SOW-166: anonymous double-opt-in digest subscribe + confirm
import { handleSponsorInquiry } from './sponsor-inquiry.mjs'; // sow-266: the digest sponsorship inquiry form
import { corsHeaders } from './cors.mjs'; // sow-158 Phase 1b: credentialed reflected-origin CORS for cookie routes
import { generateCsrfToken, csrfCookieHeader, requireCsrf } from './csrf.mjs'; // sow-158 Phase 1b: double-submit CSRF
import { json, MEMBER_CONTENT_CORS } from './route-helpers.mjs';
import { EXT_SIGNIN_HELPERS } from './oauth-state.mjs';
import { handleSignupRoutes } from './signup-routes.mjs';
import { handleBillingRoutes } from './billing-routes.mjs';
import { handleMemberRoutes } from './member-routes.mjs';
import { handleAdminRoutes } from './admin-routes.mjs';
import { runScheduled } from './cron.mjs';

export { packState, unpackState, consumeStateJti, readOauthNonce, safeReturnTo } from './oauth-state.mjs';
export { mailDrainDeps, resolveCronJob } from './cron.mjs';

// The route groups, in the order the router checks them. Each returns a Response for a path it serves, or null
// to hand the request on. They sit where their blocks stood in the single-file router, between the /auth/* routes
// and the anonymous touch and mail routes; no path is matched by more than one group, so none can shadow another.
const ROUTE_GROUPS = [handleSignupRoutes, handleBillingRoutes, handleMemberRoutes, handleAdminRoutes];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    try {
      if (method === 'GET' && pathname === '/healthz') return json({ ok: true });

      // SOW: refresh a GitHub App user token. The extension is secretless, so it POSTs only its (rotating)
      // refresh_token here; the Worker adds the App client_id + secret and returns the fresh tokens. The
      // refresh_token IS the credential, so no bearer is needed; we never log it. A dead refresh token -> 401, and
      // the extension clears the session + re-signs-in. Called by the MV3 background (host-permission fetch), but
      // CORS is added so a future page-context caller works too.
      if (pathname === '/auth/refresh') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBER_CONTENT_CORS });
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405, MEMBER_CONTENT_CORS);
        const clientId = env.GITHUB_PUBLISHER_CLIENT_ID;
        const clientSecret = env.GITHUB_PUBLISHER_CLIENT_SECRET;
        if (!clientId || !clientSecret) return json({ error: 'refresh_not_configured' }, 501, MEMBER_CONTENT_CORS);
        let reqBody;
        try { reqBody = await request.json(); } catch { return json({ error: 'bad_request' }, 400, MEMBER_CONTENT_CORS); }
        const refreshToken = reqBody?.refresh_token;
        if (!refreshToken || typeof refreshToken !== 'string') return json({ error: 'refresh_token_required' }, 400, MEMBER_CONTENT_CORS);
        try {
          const r = await githubRefreshToken({ clientId, clientSecret, refreshToken });
          return json({ access_token: r.accessToken, refresh_token: r.refreshToken, expires_in: r.expiresIn, refresh_token_expires_in: r.refreshTokenExpiresIn }, 200, MEMBER_CONTENT_CORS);
        } catch {
          return json({ error: 'refresh_failed' }, 401, MEMBER_CONTENT_CORS); // expired/revoked -> caller re-auths
        }
      }

      // sow-158 Phase 1b: end a website session. This is a cookie-authenticated write, so it is CSRF-gated
      // (Origin allow-list + double-submit token). It clears BOTH the session and the CSRF cookie (matching
      // attributes, Max-Age=0 so the browser deletes them). There is no bearer path: the extension + npm hosts
      // sign out by discarding their own token, never by calling this.
      if (pathname === '/auth/logout') {
        const cors = corsHeaders(request, env, { credentials: true, methods: 'POST, OPTIONS' });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const csrf = requireCsrf(request, env);
          if (!csrf.ok) return json(csrf.body, csrf.status, { ...cors, 'Cache-Control': 'no-store' });
          // Expire BOTH the Domain=gbti.network gbti_csrf AND a host-only one: a user who first signed in before
          // the web-login fix carries a stale host-only signup.gbti.network gbti_csrf alongside the Domain cookie.
          // Deleting only the Domain variant would leave the stale one to keep colliding on future writes.
          const clearCsrf = [csrfCookieHeader('', { ttlSeconds: 0 })];
          if (env.COOKIE_DOMAIN) clearCsrf.push(csrfCookieHeader('', { ttlSeconds: 0, domain: env.COOKIE_DOMAIN }));
          return json({ ok: true }, 200, { ...cors, 'Cache-Control': 'no-store' }, [
            sessionCookieHeader('', { ttlSeconds: 0 }),
            ...clearCsrf,
          ]);
        }
      }

      // sow-158: mint the website cookie session from the extension's ALREADY-verified GitHub token, so ONE sign-in
      // (in the extension) also signs the member into gbti.network — no separate web sign-in. Bearer-authenticated:
      // the token already authorizes every member endpoint AS that member, so minting THEIR OWN session grants no
      // new capability (exactly what the OAuth callback does after verifying a token, minus the redirect). No
      // cookie/CSRF gate (a cross-site page cannot forge a bearer token); the extension calls this via a host
      // permission fetch. Rate-limited; never returns the token.
      if (pathname === '/auth/session-from-token') {
        const cors = corsHeaders(request, env, { credentials: true, methods: 'POST, OPTIONS' });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const authHeader = request.headers.get('Authorization') || '';
          const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
          if (!token) return json({ error: 'unauthorized' }, 401, { ...cors, 'Cache-Control': 'no-store' });
          const ip = request.headers.get('CF-Connecting-IP') || '';
          const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 30, windowSeconds: 600, prefix: 'rl:session-mint:' });
          if (!rl.allowed) return json({ error: 'rate_limited' }, 429, { ...cors, 'Cache-Control': 'no-store' });
          if (!env.SESSION_SECRET) return json({ error: 'misconfigured', message: 'sessions are not configured' }, 500, { ...cors, 'Cache-Control': 'no-store' });
          let id = null;
          try { id = await githubFetchUser(token, globalThis.fetch); } catch { id = null; }
          if (!id || !id.githubId) return json({ error: 'unauthorized', message: 'could not verify the member identity' }, 401, { ...cors, 'Cache-Control': 'no-store' });
          const session = await signSession({ githubId: id.githubId, githubLogin: id.githubLogin }, env.SESSION_SECRET);
          return json({ ok: true, github_id: String(id.githubId), login: id.githubLogin || null }, 200, { ...cors, 'Cache-Control': 'no-store' }, [
            sessionCookieHeader(session),
            csrfCookieHeader(generateCsrfToken(), { domain: env.COOKIE_DOMAIN }),
          ]);
        }
      }

      // sow-158: the sign-out counterpart of session-from-token. When a member signs OUT of the extension, this
      // clears the bridged website cookie session so ONE sign-out ends both surfaces (otherwise the httpOnly
      // cookie would linger until the web Sign out or the 30-day TTL). Bearer-gated only to block a gratuitous
      // cross-site forced-logout: clearing cookies is capability-free (it deletes the CALLER'S OWN cookies and
      // grants nothing), so we require a present bearer but do NOT verify it against GitHub. The extension may be
      // signing out a token that is already being revoked, and the clear must still succeed. Mirrors /auth/logout's
      // dual-clear (host-only + Domain csrf, host-only session), minus the CSRF gate (there is no cookie read here).
      if (pathname === '/auth/session-clear') {
        const cors = corsHeaders(request, env, { credentials: true, methods: 'POST, OPTIONS' });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const authHeader = request.headers.get('Authorization') || '';
          const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
          if (!token) return json({ error: 'unauthorized' }, 401, { ...cors, 'Cache-Control': 'no-store' });
          const ip = request.headers.get('CF-Connecting-IP') || '';
          const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 30, windowSeconds: 600, prefix: 'rl:session-clear:' });
          if (!rl.allowed) return json({ error: 'rate_limited' }, 429, { ...cors, 'Cache-Control': 'no-store' });
          const clearCsrf = [csrfCookieHeader('', { ttlSeconds: 0 })];
          if (env.COOKIE_DOMAIN) clearCsrf.push(csrfCookieHeader('', { ttlSeconds: 0, domain: env.COOKIE_DOMAIN }));
          return json({ ok: true }, 200, { ...cors, 'Cache-Control': 'no-store' }, [
            sessionCookieHeader('', { ttlSeconds: 0 }),
            ...clearCsrf,
          ]);
        }
      }

      // sow-393: the extension signs in through the website (extension-signin.mjs), no device code.
      if (method === 'GET' && pathname === '/auth/extension/start') return await handleExtensionStart(request, env, EXT_SIGNIN_HELPERS);
      if (pathname === '/auth/extension/claim') return await handleExtensionClaim(request, env, EXT_SIGNIN_HELPERS);

      // The signup, billing, member and admin routes, checked here, where their blocks stood (see ROUTE_GROUPS).
      for (const routes of ROUTE_GROUPS) {
        const res = await routes(request, env, ctx, { pathname, method });
        if (res) return res;
      }

      // SOW-059 P1b: the pre-signup TOUCH-CAPTURE endpoint. ANONYMOUS (a rotating, client-minted session id keys the
      // record; no GitHub token, no cookies), so a wildcard CORS origin is safe (there is no ambient credential to
      // ride). Gated by TOUCH_CAPTURE_ENABLED (off until the SOW-059 model is activated) so the live endpoint stays
      // inert; a coarse per-IP rate limit blunts floods (the capture is high-frequency + unauthenticated); the
      // handler consent-gates content touches and validates the session. Never cached.
      if (pathname === '/touch') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBER_CONTENT_CORS });
        if (method === 'POST') {
          if (env.TOUCH_CAPTURE_ENABLED !== 'true') return json({ ok: true, recorded: false, reason: 'disabled' }, 200, MEMBER_CONTENT_CORS);
          const ip = request.headers.get('CF-Connecting-IP') || '';
          const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 120, windowSeconds: 600, prefix: 'rl:touch:' });
          if (!rl.allowed) return json({ error: 'rate_limited' }, 429, MEMBER_CONTENT_CORS);
          const r = await handleTouch(request, env);
          return json(r.body, r.status, { ...MEMBER_CONTENT_CORS, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-166: the weekly-digest ONE-CLICK unsubscribe (RFC 8058). GET renders a confirmation page that POSTs
      // (a mail-client prefetch must never opt anyone out); POST performs suppress-then-erase against the
      // capability token in the URL. The handler owns method dispatch, fail-closed verification and the
      // no-referrer/no-store page headers, so the route just delegates. NOT gated behind a flag: auto-enrolment
      // was granted on the rider that the opt-out always works.
      // sow-273 follow-up: the DIGEST CLICK COUNTER. `/c/<issueId>/<placement>/<slot>` redirects to the link that
      // slot names inside that frozen issue, counting the click on the way past. It exists because Cloudflare Web
      // Analytics has no query-string field anywhere in its RUM schema and discards the digest's utm tags before
      // storage, so this is the only way an issue's performance is knowable, and the only way a NEWS click is
      // knowable at all.
      //
      // ANONYMOUS AND CACHE-BUSTING, both on purpose. It records nothing about who clicked (no hash, no address,
      // no IP, no user agent), so it cannot answer "did this person click" and never enters that conversation. It
      // is deliberately NOT rate limited: rate limiting requires keying on the client, and a reader clicking a
      // link they were sent is not abuse. The only thing an attacker gains by hammering it is an inflated number
      // in our own analytics, which is not worth acquiring per-IP state over.
      //
      // It cannot become an open redirect: the request carries a HASH of the destination, never the destination,
      // and the candidate set is rebuilt from the frozen issue. See membership/mail-click.mjs.
      if (pathname.startsWith('/c/')) {
        if (method === 'GET' || method === 'HEAD') return await handleMailClick(request, env);
      }

      // The open pixel: GET /o/<issueId> returns a 1x1 gif and counts one open against that issue. Anonymous,
      // no reader identity, best-effort (the pixel returns even if the count write fails). See mail-open.mjs.
      if (pathname.startsWith('/o/')) {
        if (method === 'GET' || method === 'HEAD') return await handleMailOpen(request, env);
      }

      if (pathname === '/mail/unsubscribe') {
        return await handleUnsubscribe(request, env);
      }

      // sow-383: the web edition of a SENT public weekly issue, which the email's masthead links to.
      if (pathname.startsWith('/digest/')) return await handleDigestWeb(request, env);

      // SOW-166: anonymous digest capture. With the confirm step ON (`optin.double` in house/digest-config.yml,
      // sow-270; OFF is the default), subscribe writes a pending opt-in
      // and sends a confirmation email, and confirm promotes it into an active subscriber. Production runs it OFF
      // (since 2026-08-26): subscribe activates the address at once and sends no confirmation email. Both routes are
      // anonymous (no cookie/bearer) and fail-closed: unprovisioned dependencies enroll nobody.
      if (pathname === '/mail/subscribe') {
        return await handleSubscribe(request, env);
      }
      if (pathname === '/mail/confirm') {
        return await handleConfirm(request, env);
      }

      // sow-266 Phase 4: the sponsorship inquiry form on /sponsorship/. Anonymous like the two above it (no
      // cookie, no bearer), rate limited and Turnstile gated, and fail-soft on BOTH of its outputs: it answers
      // with a failure only when neither the stored record nor the owner's email got through.
      if (pathname === '/sponsorship/inquiry') {
        return await handleSponsorInquiry(request, env);
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      // Never leak internals; log server-side. Fail closed (no partial success surfaced to the client).
      wlog('worker', 'unhandled request error', { method, pathname, message: err?.message }); // SOW-124 (redacted, retained)
      return json({ error: 'internal_error' }, 500);
    }
  },

  // The cron dispatch lives in cron.mjs: runScheduled, routed by its CRON_JOBS map.
  async scheduled(controller, env, ctx) {
    return runScheduled(controller, env, ctx);
  },
};
