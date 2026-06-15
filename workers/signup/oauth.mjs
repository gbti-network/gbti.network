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

const DISCORD_AUTHORIZE = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/oauth2/token';
const DISCORD_USER = 'https://discord.com/api/v10/users/@me';

export const GITHUB_SCOPES = 'read:user';
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

/** Fetch the GitHub user. Returns { githubId, githubLogin }. github_id is the immutable primary key. */
export async function githubFetchUser(accessToken, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(GITHUB_USER, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'gbti-network-signup',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`github user fetch failed ${res.status}: ${text}`);
  const u = JSON.parse(text);
  if (u.id === undefined || u.id === null) throw new Error('github user fetch: missing id');
  return { githubId: String(u.id), githubLogin: u.login ? String(u.login) : '' };
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
