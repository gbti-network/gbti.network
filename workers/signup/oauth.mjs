// OAuth helpers for the signup chain (membership-and-access.md section 3). Two providers:
//   GitHub  (scope read:user)                  -> immutable github_id + current github_login
//   Discord (scopes identify, guilds.join, email) -> discord_user_id + email + access_token
// The Discord access_token is required by addGuildMember (guilds.join) to add the user to the guild.
// The email (Discord email scope) is captured for the day-87 trial reminder and is persisted ONLY in
// the Stripe Customer, never elsewhere (Stripe is the registry).
//
// Pure URL builders plus token-exchange + profile-fetch functions over an injectable fetch, so every
// request shape is fixture-testable with no network and no secrets.

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_USER = 'https://api.github.com/user';
const GITHUB_EMAILS = 'https://api.github.com/user/emails';

const DISCORD_AUTHORIZE = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/oauth2/token';
const DISCORD_USER = 'https://discord.com/api/v10/users/@me';

export const GITHUB_SCOPES = 'read:user user:email'; // SOW: user:email lets a GitHub-only signup get the email (Discord deferred)
export const DISCORD_SCOPES = 'identify guilds.join email';

function form(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.set(k, String(v));
  }
  return u;
}

// ---- GitHub ----

/** Build the GitHub authorize URL. `state` carries our CSRF token + the referral code round-trip. */
export function githubAuthorizeUrl({ clientId, redirectUri, state, scope = GITHUB_SCOPES }) {
  const q = form({ client_id: clientId, redirect_uri: redirectUri, scope, state, allow_signup: 'true' });
  return `${GITHUB_AUTHORIZE}?${q.toString()}`;
}

/** Exchange a GitHub OAuth code for an access token. Returns the access_token string. */
export async function githubExchangeCode({ clientId, clientSecret, code, redirectUri }, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(GITHUB_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`github token exchange failed ${res.status}: ${text}`);
  const data = JSON.parse(text);
  if (data.error || !data.access_token) {
    throw new Error(`github token exchange error: ${data.error || 'no access_token'}`);
  }
  return data.access_token;
}

/**
 * SOW: refresh a GitHub App user-to-server access token using its refresh token. GitHub App user tokens expire
 * (~8h) and the device flow hands back a `refresh_token` (valid ~6 months) we use to mint a fresh access token
 * WITHOUT another sign-in. Refreshing requires the App's client_id + client_secret, so it runs here on the Worker
 * (the extension is secretless). The refresh token ROTATES on each use, so the caller MUST persist the new one.
 * Returns { accessToken, refreshToken, expiresIn, refreshTokenExpiresIn }.
 */
export async function githubRefreshToken({ clientId, clientSecret, refreshToken }, fetchImpl = globalThis.fetch) {
  if (!refreshToken) throw new Error('githubRefreshToken: refreshToken is required');
  const res = await fetchImpl(GITHUB_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`github token refresh failed ${res.status}: ${text}`);
  const data = JSON.parse(text);
  if (data.error || !data.access_token) throw new Error(`github token refresh error: ${data.error || 'no access_token'}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresIn: Number(data.expires_in) || 0,
    refreshTokenExpiresIn: Number(data.refresh_token_expires_in) || 0,
  };
}

/** Fetch the GitHub user. Returns { githubId, githubLogin }. github_id is the immutable primary key.
 *  GitHub intermittently rejects the Worker's egress with a TRANSIENT 403 (secondary rate limit) / 429 / 5xx,
 *  which read as "the token could not be verified" even though the token is fine. Retry those a couple times with
 *  a short backoff so a valid caller is not spuriously denied. A 401 (a genuinely bad/expired token) is NOT
 *  retried. On a final failure the thrown Error carries `.status` so the caller can surface the real code. */
export async function githubFetchUser(accessToken, fetchImpl = globalThis.fetch, { retries = 2, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastStatus = 0;
  let lastText = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetchImpl(GITHUB_USER, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'gbti-network-signup',
        },
      });
    } catch (netErr) {
      lastStatus = 0; lastText = String(netErr?.message ?? netErr);
      if (attempt < retries) { await sleep(250 * (attempt + 1)); continue; }
      const e = new Error(`github user fetch failed (network): ${lastText}`); e.status = 0; throw e;
    }
    const text = await res.text();
    if (res.ok) {
      const u = JSON.parse(text);
      if (u.id === undefined || u.id === null) throw new Error('github user fetch: missing id');
      return { githubId: String(u.id), githubLogin: u.login ? String(u.login) : '' };
    }
    lastStatus = res.status; lastText = text;
    // 403 (secondary rate limit) / 429 / 5xx are transient; 401 (bad credentials) is not.
    const transient = res.status === 403 || res.status === 429 || res.status >= 500;
    if (transient && attempt < retries) { await sleep(250 * (attempt + 1)); continue; }
    break;
  }
  const e = new Error(`github user fetch failed ${lastStatus}: ${lastText}`);
  e.status = lastStatus;
  throw e;
}

/**
 * Fetch the GitHub user's PRIMARY verified email (needs the `user:email` scope). Best-effort: returns '' if the
 * scope was not granted or no verified email exists, so a GitHub-only signup still succeeds (the email only powers
 * the Stripe Customer + the day-87 reminder, which degrade gracefully). NEVER throws.
 */
export async function githubFetchPrimaryEmail(accessToken, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(GITHUB_EMAILS, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network-signup' },
    });
    if (!res.ok) return '';
    const list = JSON.parse(await res.text());
    if (!Array.isArray(list)) return '';
    const pick = list.find((e) => e && e.primary && e.verified)
      || list.find((e) => e && e.verified)
      || list.find((e) => e && e.email);
    return pick && pick.email ? String(pick.email) : '';
  } catch {
    return '';
  }
}

// ---- Discord ----

/** Build the Discord authorize URL (identify + guilds.join + email). */
export function discordAuthorizeUrl({ clientId, redirectUri, state, scope = DISCORD_SCOPES }) {
  const q = form({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, state });
  return `${DISCORD_AUTHORIZE}?${q.toString()}`;
}

/** Exchange a Discord OAuth code for tokens. Returns { accessToken, scope }. */
export async function discordExchangeCode({ clientId, clientSecret, code, redirectUri }, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(DISCORD_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`discord token exchange failed ${res.status}: ${text}`);
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('discord token exchange: missing access_token');
  return { accessToken: data.access_token, scope: data.scope };
}

/**
 * Fetch the Discord user with the OAuth access token (the user's token, not the bot token).
 * Returns { discordUserId, email, accessToken } so the caller can both store the id/email and pass
 * the access token to addGuildMember (guilds.join).
 */
export async function discordFetchUser(accessToken, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(DISCORD_USER, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`discord user fetch failed ${res.status}: ${text}`);
  const u = JSON.parse(text);
  if (!u.id) throw new Error('discord user fetch: missing id');
  return { discordUserId: String(u.id), email: u.email ? String(u.email) : '', accessToken };
}
