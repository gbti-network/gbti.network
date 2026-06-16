// On-demand Discord guild invite (surfaced by the SOW-029 welcome view's "Join our Discord" step).
//
// Why a Worker endpoint and not a hardcoded link: the bot mints a real invite via the Discord API (the token
// NEVER leaves the Worker), but Discord invites are not meant to be minted per page-load. So we cache ONE shared
// invite in SIGNUP_KV and reuse it until it is near expiry, regenerating only "as needed". Auth = a verified
// GitHub bearer token (the welcome view is post-signup); access to the actual channels is still governed by the
// reconcile role sync (member/trial/locked), so this endpoint only needs a verified identity, not a paid gate.
// FAIL-CLOSED to a static DISCORD_INVITE_URL (a vanity link) when the bot/channel are not configured or error.

import { githubFetchUser } from './oauth.mjs';

export const INVITE_KV_KEY = 'discord:invite';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // a fresh invite lives a week
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000; // regenerate once under a day of life remains

/** Pure: reuse the cached invite, or mint a new one? Reuse only a well-formed, not-near-expiry cache entry. */
export function shouldReuseInvite(cached, nowMs, marginMs = REFRESH_MARGIN_MS) {
  if (!cached || typeof cached.url !== 'string' || !cached.url) return false;
  const exp = Number(cached.expiresAt);
  if (!Number.isFinite(exp)) return false;
  return exp - nowMs > marginMs;
}

/** Pure: a discord.gg URL for an invite code, or null. */
export function inviteUrlFromCode(code) {
  return code ? `https://discord.gg/${code}` : null;
}

/**
 * GET /membership/discord-invite -> { ok, url, source } where source is 'cache' | 'fresh' | 'static'.
 * deps.discord is the injected createDiscordClient(...). Returns { status, body } (the index handler adds CORS).
 */
export async function handleDiscordInvite(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch,
    fetchUser = githubFetchUser,
    discord = null,
    kv = env?.SIGNUP_KV,
    now = Date.now(),
    ttlSeconds = Number(env?.DISCORD_INVITE_TTL_SECONDS) || DEFAULT_TTL_SECONDS,
  } = deps;

  // Auth: a valid GitHub bearer token. Fail-closed (the role sync enforces actual channel access downstream).
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return { status: 401, body: { error: 'unauthorized', message: 'a GitHub bearer token is required' } };
  let user;
  try { user = await fetchUser(token, fetchImpl); } catch { return { status: 401, body: { error: 'unauthorized', message: 'could not verify the GitHub token' } }; }
  if (!user?.githubId) return { status: 401, body: { error: 'unauthorized', message: 'the GitHub token has no user id' } };

  const channelId = env?.DISCORD_INVITE_CHANNEL_ID || null;
  const staticUrl = env?.DISCORD_INVITE_URL || null;

  // 1) Reuse a still-fresh cached invite so we do not mint a new one per request.
  try {
    const raw = kv ? await kv.get(INVITE_KV_KEY) : null;
    const cached = raw ? JSON.parse(raw) : null;
    if (shouldReuseInvite(cached, now)) return { status: 200, body: { ok: true, url: cached.url, source: 'cache' } };
  } catch { /* unreadable cache -> mint a fresh one */ }

  // 2) Mint a fresh invite when the bot + channel are configured; cache it.
  if (channelId && discord) {
    try {
      const inv = await discord.createInvite(channelId, { maxAgeSeconds: ttlSeconds, maxUses: 0, unique: false });
      const url = inv?.url || inviteUrlFromCode(inv?.code);
      if (url) {
        try { if (kv) await kv.put(INVITE_KV_KEY, JSON.stringify({ url, code: inv?.code ?? null, expiresAt: now + ttlSeconds * 1000 })); } catch { /* cache write is best-effort */ }
        return { status: 200, body: { ok: true, url, source: 'fresh' } };
      }
    } catch { /* fall through to the static fallback */ }
  }

  // 3) Fail-closed to the configured vanity link, else a clear error.
  if (staticUrl) return { status: 200, body: { ok: true, url: staticUrl, source: 'static' } };
  return { status: 502, body: { error: 'invite_unavailable', message: 'could not generate a Discord invite' } };
}
