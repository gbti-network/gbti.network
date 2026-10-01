// The signup and Discord link routes: /signup/start, the GitHub and Discord OAuth callbacks, and the /discord/link
// and /discord/unlink flows. Moved out of index.mjs at the 900-line limit (owner, 2026-09-30). index.mjs calls
// handleSignupRoutes at the point in its router where these checks stood, so their order is unchanged.

import { signSession, verifySession, sessionCookieHeader, readSessionCookie } from './session.mjs';
import { signinLanding } from './signin-landing.mjs'; // sow-343: a new account meets the welcome steps first
import { handleExtensionCallback, EXT_STATE_KIND } from './extension-signin.mjs'; // sow-393: extension sign-in through the website
import {
  githubAuthorizeUrl,
  githubExchangeCode,
  githubFetchUser,
  githubFetchPrimaryEmail,
  discordAuthorizeUrl,
  discordExchangeCode,
  discordFetchUser,
} from './oauth.mjs';
import { verifyTurnstileDetailed, rateLimit } from './abuse.mjs';
import { wantsHtml, turnstileRejectedPage } from './turnstile-page.mjs'; // the page a browser gets for a spent token
import { runSignup, discordJoinEligibility } from './signup.mjs'; // sow-356: the shared Discord join rule
import { validateCouponParam } from './coupons.mjs'; // SOW-119
import { unlinkDiscord } from './discord-unlink.mjs'; // sow-218: disconnect Discord (roles first, then the link)
import { buildEnvPriceTierMap } from '../../membership/tier-gate.mjs'; // sow-185: price -> tier map for the Creator badge
import { SESSION_RE } from './membership-touches.mjs'; // SOW-059 P1c: the touch-session shape carried through signup
import { sendCouponRedemptionAlert } from './coupon-alert.mjs'; // sow-279: fail-soft owner notice on a NEW coupon redemption
import { corsHeaders } from './cors.mjs'; // sow-158 Phase 1b: credentialed reflected-origin CORS for cookie routes
import { generateCsrfToken, csrfCookieHeader, requireCsrf } from './csrf.mjs'; // sow-158 Phase 1b: double-submit CSRF
import { json, redirect, clientsFromEnv, discordConfig, MEMBERSHIP_CORS } from './route-helpers.mjs';
import {
  packState, unpackState, consumeStateJti, readOauthNonce, safeReturnTo, funnel, EXT_SIGNIN_HELPERS, OAUTH_NONCE_COOKIE,
} from './oauth-state.mjs';

async function handleStart(request, env) {
  const url = new URL(request.url);
  const ip = request.headers.get('CF-Connecting-IP') || '';

  // Abuse checks FIRST, before any OAuth or registry work.
  const turnstileToken = url.searchParams.get('cf-turnstile-response') || '';
  const ts = await verifyTurnstileDetailed({ token: turnstileToken, secret: env.TURNSTILE_SECRET_KEY, remoteIp: ip });
  const ok = ts.ok;
  // `hadResponse` separates a bot or an expired widget (a solution was sent, it did not verify) from a client that
  // never solved at all, which is what a broken or blocked Turnstile widget on our OWN page looks like. The second
  // is our fault and the first is not, and they are the same 403 to the caller.
  // NOT named hadToken: devlog-core redacts any key matching /token|secret|.../i, so that name would have logged
  // "<redacted>" forever and the distinction this line exists to draw would never have appeared.
  // `codes` is Cloudflare's reason (timeout-or-duplicate for a spent or expired token), so the log answers the
  // question on its own. A BROWSER landing here has just spent its token (a second tap, Back and tap again, a reload
  // of this page: measured 2026-09-15, first tap accepted, two more with the same token seconds later) and gets a
  // page saying so; a script caller keeps the JSON it always had.
  if (!ok) {
    funnel('start rejected', { reason: 'turnstile', hadResponse: Boolean(turnstileToken), codes: ts.codes });
    if (wantsHtml(request)) return new Response(turnstileRejectedPage(request, env), { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    return json({ error: 'turnstile_failed' }, 403);
  }

  const rl = await rateLimit({ kv: env.SIGNUP_KV, ip });
  if (!rl.allowed) { funnel('start rejected', { reason: 'rate_limited' }); return json({ error: 'rate_limited' }, 429); }

  const ref = url.searchParams.get('ref') || '';
  // The content the reader first landed on (SOW-007/008). Carried alongside ?ref so the payout job can
  // split the owner's commission with that content's contributors + commenters. Validated at signup.mjs.
  const via = url.searchParams.get('via') || '';
  // SOW-059 P1c: the visitor's rotating touch-session id (gbti_sid), forwarded as ?sid because the cookie lives on
  // gbti.network, not this Worker's origin. Validated to the session shape; anything else is dropped (fail safe ->
  // no attribution binding). Carried in the signed state so the conversion handler can later locate touch:<sid>.
  const sidParam = url.searchParams.get('sid') || '';
  const sid = SESSION_RE.test(sidParam) ? sidParam : '';
  // SOW-119: an optional coupon code (the /codeable-invite path or a hand-entered code). Validated against
  // the coupons:config mirror NOW so only a redeemable, normalized code ever enters the signed state; an
  // unknown/inactive code (or a stale mirror) drops silently and the signup proceeds as a normal trial.
  const coupon = await validateCouponParam(env.SIGNUP_KV, url.searchParams.get('coupon') || '');
  // SOW security fix: bind the state to THIS browser with a per-flow nonce (cookie + embedded in the signed state).
  const nonce = crypto.randomUUID();
  // sow-158 Phase 2: a website "Sign in" carries return_to (the path to land on after login). Validated to a
  // same-site path here, then carried in the HMAC-signed state (tamper-proof between the OAuth hops).
  const returnTo = safeReturnTo(url.searchParams.get('return_to') || '');
  // sow-236: a ONE-TIME jti, KV-consumed at the callback. The nonce above binds the state to THIS BROWSER, which
  // defends a state transplanted into someone else's; it does NOTHING against an attacker replaying their OWN state,
  // because the cookie is theirs. Turnstile and the IP rate limit are the entire economic control on coupon abuse and
  // both live HERE, at /signup/start, so without a consume one solve bought unlimited signups for the state's whole
  // TTL. The controls were not bypassed, they were amortized to zero. Same construction the Discord link token uses.
  const jti = crypto.randomUUID();
  const state = await packState({ ref, via, sid, nonce, jti, ...(coupon ? { coupon } : {}), ...(returnTo ? { returnTo } : {}) }, env);
  const location = githubAuthorizeUrl({
    clientId: env.GITHUB_OAUTH_CLIENT_ID,
    redirectUri: `${env.PUBLIC_BASE_URL}/signup/github/callback`,
    state,
  });
  // THE DENOMINATOR. Every completed signup is preceded by exactly one of these, so starts minus completes is the
  // drop-off, and `coupon` splits the invite funnel from the walk-up one, which is the split the owner actually
  // asks about. Booleans only: the coupon CODE is a bearer secret since sow-231.
  funnel('start', { coupon: Boolean(coupon), ref: Boolean(ref), returnTo: Boolean(returnTo) });
  return redirect(location, { 'Set-Cookie': `${OAUTH_NONCE_COOKIE}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, 'Referrer-Policy': 'no-referrer' });
}

async function handleGithubCallback(request, env, ctx) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await unpackState(url.searchParams.get('state'), env);
  // sow-393: the extension's website sign-in uses this same registered callback. Its states carry their own kind and go
  // to the extension handler, which never runs a signup; any OTHER kind is refused below.
  if (state?.kind === EXT_STATE_KIND) return handleExtensionCallback(request, env, EXT_SIGNIN_HELPERS);
  // Split, because these mean opposite things. No `code` is usually the MEMBER declining GitHub's consent screen,
  // which is not an error at all; an unusable `state` is expired (past the 600s TTL), tampered with, or truncated
  // by something in the middle. One is a person changing their mind, the other is a bug or an attack.
  // sow-393: a state of any other kind never completes a website signup.
  if (!code || !state || state.kind) {
    funnel('callback rejected', { reason: !code ? 'no_code' : 'bad_state', hasState: Boolean(url.searchParams.get('state')) });
    return json({ error: 'bad_oauth_state' }, 400);
  }
  // SOW security fix: require the per-browser nonce (the cookie set at /signup/start) to match the state's nonce. A
  // state transplanted into a DIFFERENT browser lacks the matching cookie, so it is rejected (login-CSRF /
  // session-fixation). NOTE: the nonce is CLIENT-HELD state, so it can never defend against the client replaying its
  // own state. That is the jti's job, below. Having this check is what made the missing consume easy to overlook.
  const cookieNonce = readOauthNonce(request.headers.get('Cookie'));
  if (!state.nonce || !cookieNonce || state.nonce !== cookieNonce) {
    // Three causes, and only one of them is the attack this check exists for. `no_cookie_nonce` is the one to
    // WATCH: the state is ours and intact but the browser sent no nonce cookie back, which is what a blocked
    // cookie, an ITP-style purge, or a trip through the consent screen longer than the cookie's 600s Max-Age
    // looks like. That is a legitimate member being turned away, and without this line it is indistinguishable
    // from an attack.
    const reason = !state.nonce ? 'no_state_nonce' : (!cookieNonce ? 'no_cookie_nonce' : 'nonce_mismatch');
    funnel('callback rejected', { reason });
    return json({ error: 'bad_oauth_state' }, 400);
  }

  // sow-236: rate-limit the CALLBACK by IP, not just /signup/start. This bounds the residual the KV consume below
  // cannot close on its own (see consumeStateJti), and it is independent of KV read consistency. The limit is
  // deliberately loose: legitimate signups share IPs behind carrier and office NAT, and this is a backstop, not the
  // primary control. A blocked caller retries; nothing is consumed before this point.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 20, windowSeconds: 600, prefix: 'rl:oauth-callback:' });
  // Worth watching rather than assuming: the limit is deliberately loose, but carrier and office NAT put many
  // legitimate members behind one IP, so a cluster of these is as likely to be a shared egress as an attacker.
  if (!rl.allowed) { funnel('callback rejected', { reason: 'rate_limited' }); return json({ error: 'rate_limited' }, 429); }

  // sow-236: CONSUME THE ONE-TIME STATE. Before the code exchange, so a replay costs no GitHub or Stripe work.
  // Fails closed: an absent jti (including a state minted by the previous deploy, within its 600s TTL), an
  // unreachable KV, or an already-consumed jti all reject. A member caught by the deploy rollover restarts signup.
  // consumeStateJti logs WHICH of its four denials fired; this line only records that the gate closed.
  if (!(await consumeStateJti(env.SIGNUP_KV, state.jti))) { funnel('callback rejected', { reason: 'state_not_consumed' }); return json({ error: 'bad_oauth_state' }, 400); }

  // NAME THE STEP THAT THREW. Everything below talks to GitHub or Stripe, and a throw from any of it lands in the
  // router's single top-level catch, which reports the method, the path and a message. That is enough to know a
  // signup 500ed and nothing about where, so a Stripe outage and a GitHub outage read identically. `step` logs the
  // step name and RETHROWS, so the 500 and its response are unchanged: this adds a record, not a behaviour.
  const step = async (name, fn) => {
    try { return await fn(); } catch (err) {
      funnel('callback failed', { step: name, status: err?.status ?? null, message: err?.message ?? null });
      throw err;
    }
  };

  const accessToken = await step('github_exchange_code', () => githubExchangeCode(
    {
      clientId: env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirectUri: `${env.PUBLIC_BASE_URL}/signup/github/callback`,
    },
    globalThis.fetch,
  ));
  const { githubId, githubLogin } = await step('github_fetch_user', () => githubFetchUser(accessToken, globalThis.fetch));
  const email = await githubFetchPrimaryEmail(accessToken, globalThis.fetch); // genuinely best-effort: it swallows and returns '' itself

  // SOW: Discord is DEFERRED. Complete the signup on GitHub ALONE -- create the trial Customer (no discord_user_id,
  // no guild join) and sign the session. The member links Discord later from the extension welcome (which re-runs
  // the same Discord OAuth + idempotently attaches discord_user_id + the role to this Customer).
  const { stripe, discord } = clientsFromEnv(env);
  const signup = await step('run_signup', () => runSignup({
    identity: { githubId, githubLogin, discordUserId: null, email, discordAccessToken: null },
    stripe,
    discord,
    kv: env.SIGNUP_KV,
    config: discordConfig(env),
    couponLockSecret: env.COUPON_LOCK_KEY ?? null, // sow-212: enforce the post-erasure minimized coupon lock
    refCode: state.ref,
    via: state.via,
    touchSession: state.sid, // SOW-059: bind the touch session to this new Customer (new-customer-only)
    coupon: state.coupon, // SOW-119: a pre-validated code from the signed state (absent for a plain signup)
  }));

  // THE NUMERATOR, and the first line in this flow that can name a person. `created` distinguishes a genuinely new
  // member from a returning one re-running signup, and `couponApplied` says whether the invite actually converted,
  // which until now could only be answered by reading KV after the fact and asking the member.
  funnel('complete', { githubId, created: signup.created, couponApplied: signup.couponApplied });

  // sow-279: a genuinely-new coupon redemption is the owner's abuse-control signal for the uncapped codes
  // (owner ruling 2026-08-11). Fire it fire-and-forget through waitUntil so the notice never delays the
  // member's redirect, and fail-soft (sendCouponRedemptionAlert never throws) so it can never break signup.
  // Only the GitHub leg carries a NEW grant; the deferred Discord leg re-runs redeemCoupon as `already` and
  // leaves signup.couponRedeemed null, so this fires exactly once per member.
  if (signup.couponRedeemed) {
    const alert = sendCouponRedemptionAlert(env, signup.couponRedeemed);
    if (ctx?.waitUntil) ctx.waitUntil(alert); else await alert;

    // sow-316 Phase 4: THE MEMBER'S DISCORD ROLE ARRIVES NOW, NOT AT THE NEXT NIGHTLY SWEEP. Measured on
    // 2026-09-08: a member who redeemed a coupon at signup sat in Discord wearing the LOCKED role, the one
    // reserved for lapsed and banned accounts, for the better part of a day, because the role sync only ran
    // on the nightly schedule. The sync itself was correct; nothing had asked it to run. Redemption is the
    // moment of most goodwill and the role turned up a day late.
    //
    // Same nudge checkout fires after a payment: a targeted reconcile for this one github_id. Targeted mode
    // folds pending coupon grants BEFORE it gathers the member, so the grant written above is visible to the
    // run it triggers. Fail-soft, exactly like the alert: kickRegate never throws and returns false when the
    // token is unset, and the nightly run heals any missed nudge, so a failed dispatch can never block the
    // member's redirect. Fired through waitUntil so it never delays them either.
    const nudge = import('./checkout.mjs').then(({ kickRegate }) => kickRegate(
      { githubId, dispatchToken: env.REGATE_DISPATCH_TOKEN, contentRepo: env.GITHUB_CONTENT_REPO },
      globalThis.fetch,
    )).catch(() => false);
    if (ctx?.waitUntil) ctx.waitUntil(nudge); else await nudge;
  }

  const session = await signSession({ githubId, githubLogin }, env.SESSION_SECRET);
  // sow-207: a fresh signup (a trial OR a SOW-119 coupon invitee) lands on the WEBSITE welcome flow (/welcome/).
  // It hydrates the signed-in state from the session cookie just set below and walks the member through connecting
  // Discord, following members and channels, adding socials, and picking topics. The extension is now a reader,
  // not the forced post-signup destination (sow-204). The coupon needs no query param: the /welcome/ phase banner
  // reads the effective status (couponUntil) from the oracle and shows the free period on its own.
  // sow-158 Phase 2 + sow-343: a website login carries a validated same-site return_to (re-validated here). A NEW
  // account goes to /welcome/ first and carries it as next; a returning one lands on it. See signin-landing.mjs.
  const dest = `${env.SITE_BASE_URL}${signinLanding({ created: signup.created, returnTo: safeReturnTo(state.returnTo) })}`; // sow-343
  // sow-158 Phase 1b: mint the CSRF token cookie alongside the session so the website client can make
  // credentialed writes (double-submit). Both are set here as two Set-Cookie headers via the cookies array.
  return redirect(dest, {}, [sessionCookieHeader(session), csrfCookieHeader(generateCsrfToken(), { domain: env.COOKIE_DOMAIN })]);
}

// SOW Part C: the DEFERRED Discord-link callback. Signup no longer hops through Discord (it is deferred), so this
// callback is reached only from the extension-welcome link flow (/discord/link/start), which authenticates the member
// via their post-signup session cookie and carries the verified github_id + a per-browser nonce in the signed state.
// runSignup is idempotent: it reuses the existing Customer, attaches discord_user_id, and assigns the role.
async function handleDiscordCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await unpackState(url.searchParams.get('state'), env);
  if (!code || !state || !state.githubId) return json({ error: 'bad_oauth_state' }, 400);
  const cookieNonce = readOauthNonce(request.headers.get('Cookie'));
  if (!state.nonce || !cookieNonce || state.nonce !== cookieNonce) return json({ error: 'bad_oauth_state' }, 400);

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
  const linked = await runSignup({
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
    couponLockSecret: env.COUPON_LOCK_KEY ?? null, // sow-212: enforce the post-erasure minimized coupon lock
    refCode: state.ref,
    via: state.via,
    touchSession: state.sid, // SOW-059 P1c: bind the touch session to this new Customer (new-customer-only)
    coupon: state.coupon, // SOW-119: idempotent (the grant record is the lock), so the re-run is safe
  });

  const session = await signSession({ githubId: state.githubId, githubLogin: state.githubLogin }, env.SESSION_SECRET);
  // SOW: land the member in Discord (the community they just joined), NOT back on the marketing site. The flow
  // started from the extension welcome, which polls /discord/link/status and advances itself once the link lands.
  //
  // sow-356: unless the join was REFUSED, in which case sending them to a server invite would be the one thing
  // the ruling forbids. They keep their session (they are still signed in, still a member of the network) and
  // land on the membership page, which explains what the community costs.
  const dest = linked.discordLinked
    ? (env.DISCORD_INVITE_URL || `${env.SITE_BASE_URL}/extension/?linked=discord`)
    : `${env.SITE_BASE_URL}/membership/?discord=members-only`;
  // sow-158 Phase 1b: re-issue the CSRF cookie with the refreshed session (two Set-Cookie headers).
  return redirect(dest, {}, [sessionCookieHeader(session), csrfCookieHeader(generateCsrfToken(), { domain: env.COOKIE_DOMAIN })]);
}

// SOW Part C: deferred Discord link, step 1. The extension welcome opens this in a tab. It authenticates the member
// via their post-signup session cookie (set on this Worker's origin at GitHub-only signup), then starts Discord OAuth
// carrying the verified github_id + a per-browser nonce. The /signup/discord/callback (above) completes the link.
// SOW Part C: deferred Discord link, INIT (the robust extension path). The extension (which holds the member's
// GitHub App token) calls this; we verify the token -> github_id and return a one-time SIGNED link URL the extension
// opens in a tab. This binds the link to the EXTENSION identity, so it works with NO website session.
async function handleDiscordLinkInit(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json({ error: 'no_token' }, 401, MEMBERSHIP_CORS);
  let id = null;
  try { id = await githubFetchUser(token, globalThis.fetch); } catch { id = null; }
  if (!id || !id.githubId) return json({ error: 'bad_token' }, 401, MEMBERSHIP_CORS);
  // The lt is a ONE-TIME, short-lived token (jti -> KV-consumed in /discord/link/start) so a replayed/leaked lt
  // cannot bind a different Discord account to this github_id (account-hijack defense).
  const lt = await packState({ githubId: id.githubId, githubLogin: id.githubLogin, linkInit: true, jti: crypto.randomUUID() }, env, 120);
  return json({ url: `${env.SITE_BASE_URL}/discord/link/start?lt=${encodeURIComponent(lt)}` }, 200, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
}

// SOW: link-status poll for the extension welcome. The welcome opens the Discord OAuth tab (which redirects the
// member into Discord, never back to the site), then polls THIS endpoint until it reports linked and auto-advances.
// Read-only + fail-closed: it verifies the member's GitHub token -> github_id, looks up the Customer, and reports
// whether discord_user_id is attached. Any error / no token -> { linked: false } (never blocks, never opens).
// sow-207: the WEBSITE welcome flow polls this too, but it carries no bearer token. When the bearer is absent,
// resolve the member from the httpOnly session cookie and answer with credentialed CORS (a reflected, allow-listed
// Origin). The extension bearer path stays byte-for-byte unchanged (wildcard CORS). Read-only + fail-closed to
// { linked: false } on every branch, so a poll never blocks the wizard and a cross-site read learns nothing.
async function handleDiscordLinkStatus(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token) {
    const cors = { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' };
    let id = null;
    try { id = await githubFetchUser(token, globalThis.fetch); } catch { id = null; }
    if (!id || !id.githubId) return json({ linked: false }, 200, cors);
    return json({ linked: await discordLinkedFor(env, id.githubId) }, 200, cors);
  }
  // Website path: identity from the signed session cookie; credentialed CORS so the browser may read the response.
  const cors = { ...corsHeaders(request, env, { credentials: true }), 'Cache-Control': 'no-store' };
  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  const githubId = session && session.github_id ? String(session.github_id) : null;
  if (!githubId) return json({ linked: false }, 200, cors);
  return json({ linked: await discordLinkedFor(env, githubId) }, 200, cors);
}

// sow-207: shared read behind the link-status poll — is a discord_user_id attached to this github_id's Stripe
// Customer? Fail-closed to false on any error (no customer, Stripe hiccup) so the poll never falsely reports linked.
async function discordLinkedFor(env, githubId) {
  try {
    const { stripe } = clientsFromEnv(env);
    const customer = await stripe.findCustomerByGithubId(String(githubId));
    return Boolean(customer?.metadata?.discord_user_id);
  } catch { return false; }
}

// sow-218: POST /discord/unlink -- disconnect this member's Discord account.
//
// Same dual identity as the link-status poll (extension bearer, or the website session cookie), but this one
// WRITES, so the cookie path additionally requires CSRF. The bearer path does not: a bearer token is not sent
// ambiently by a browser, so there is no cross-site request to forge.
//
// The work itself, including why the two writes are ordered as they are, lives in discord-unlink.mjs.
async function handleDiscordUnlink(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  let githubId = null;
  let cors = { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' };

  if (token) {
    let id = null;
    try { id = await githubFetchUser(token, globalThis.fetch); } catch { id = null; }
    if (!id || !id.githubId) return json({ error: 'bad_token' }, 401, cors);
    githubId = String(id.githubId);
  } else {
    cors = { ...corsHeaders(request, env, { credentials: true }), 'Cache-Control': 'no-store' };
    const csrf = requireCsrf(request, env);
    if (!csrf.ok) return json({ error: 'bad_csrf' }, 403, cors);
    const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
    githubId = session && session.github_id ? String(session.github_id) : null;
    if (!githubId) return json({ error: 'no_session' }, 401, cors);
  }

  const { stripe, discord } = clientsFromEnv(env);
  const r = await unlinkDiscord({ githubId, stripe, discord, config: discordConfig(env) });
  // A failed unlink is a 502, not a 200 with ok:false. The member is about to be told whether their account is
  // disconnected, and a silent failure here leaves them believing it is when it is not.
  return json(r, r.ok ? 200 : 502, cors);
}

async function handleDiscordLinkStart(request, env) {
  const url = new URL(request.url);
  // Authenticate the linker by EITHER a one-time link token (the extension's GitHub-App identity, the robust path)
  // OR the post-signup session cookie (the website path). Either yields the SERVER-verified github_id.
  let githubId = null;
  let githubLogin = '';
  const lt = url.searchParams.get('lt');
  if (lt) {
    const tok = await unpackState(lt, env);
    if (tok && tok.linkInit && tok.githubId && tok.jti) {
      // SOW security: consume the ONE-TIME jti in KV. A replayed/stolen lt finds the jti already used and sets NO
      // identity -> it falls through to the session check (which fails for an attacker lacking the victim's session),
      // so a leaked lt cannot bind a different Discord account to this github_id.
      const jtiKey = `linkjti:${tok.jti}`;
      const used = env.SIGNUP_KV ? await env.SIGNUP_KV.get(jtiKey) : null;
      if (!used) {
        if (env.SIGNUP_KV) { try { await env.SIGNUP_KV.put(jtiKey, '1', { expirationTtl: 600 }); } catch { /* best-effort consume */ } }
        githubId = String(tok.githubId);
        githubLogin = tok.githubLogin || '';
      }
    }
  }
  if (!githubId) {
    const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
    if (session && session.github_id) { githubId = String(session.github_id); githubLogin = session.github_login || ''; }
  }
  if (!githubId) {
    // sow-207: no identity (no/expired link token AND no session) -> land on the website welcome flow, where they
    // can sign in and retry the Discord step.
    return redirect(`${env.SITE_BASE_URL}/welcome/`);
  }
  // sow-356: refuse BEFORE the Discord sign-in, so a free account is not walked through an OAuth consent screen
  // for something it cannot have. An unknown answer continues: the callback resolves again and refuses there.
  // Unset secrets make clientsFromEnv throw, which must not 500 a route that used to work, so it is inside the
  // same guard as the lookup: both land on `known: false` and continue.
  let gate = { known: false, eligible: false };
  try {
    gate = await discordJoinEligibility({ kv: env.SIGNUP_KV, stripe: clientsFromEnv(env).stripe, githubId, priceTierMap: buildEnvPriceTierMap(env) });
  } catch { /* continue; the callback resolves again and refuses there */ }
  if (gate.known && !gate.eligible) return redirect(`${env.SITE_BASE_URL}/membership/?discord=members-only`);
  const nonce = crypto.randomUUID();
  const state = await packState({ githubId, githubLogin, nonce, link: true }, env);
  const location = discordAuthorizeUrl({
    clientId: env.DISCORD_OAUTH_CLIENT_ID,
    redirectUri: `${env.PUBLIC_BASE_URL}/signup/discord/callback`,
    state,
  });
  return redirect(location, { 'Set-Cookie': `${OAUTH_NONCE_COOKIE}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, 'Referrer-Policy': 'no-referrer' });
}

/**
 * The signup and Discord link checks from the router, in the order they stood there. Returns the Response for a
 * path and method this group serves, or null so the router goes on to its next check.
 */
export async function handleSignupRoutes(request, env, ctx, { pathname, method }) {
  if (method === 'GET' && pathname === '/signup/start') return await handleStart(request, env);
  if (method === 'GET' && pathname === '/signup/github/callback') return await handleGithubCallback(request, env, ctx); // sow-279: ctx for the fire-and-forget coupon notice
  if (method === 'GET' && pathname === '/signup/discord/callback') return await handleDiscordCallback(request, env);
  if (method === 'GET' && pathname === '/discord/link/init') return await handleDiscordLinkInit(request, env);   // SOW Part C: mint a token-bound link URL (extension)
  if (method === 'GET' && pathname === '/discord/link/start') return await handleDiscordLinkStart(request, env); // SOW Part C: deferred Discord link
  if (method === 'GET' && pathname === '/discord/link/status') return await handleDiscordLinkStatus(request, env); // SOW: welcome auto-detect poll
  if (pathname === '/discord/unlink') { // sow-218: disconnect Discord (strips the managed roles, then the link)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env, { credentials: true }) });
    if (method === 'POST') return await handleDiscordUnlink(request, env);
  }
  return null;
}
