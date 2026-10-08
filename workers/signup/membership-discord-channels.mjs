// SOW-100 QA: the guild's Discord channel NAMES for the admin categories workspace. The channel map stores
// bare ids (git-native); names live only in Discord, and only the Worker holds the bot token — so this
// admin-gated read lists the guild's channels (id, name, type, parent) with a one-hour KV cache. Fail-closed
// on the admin gate; a Discord failure serves the stale cache when one exists.
import { authorizeAdmin } from './membership-admin.mjs';

// v2 carries `position`, so the pickers can follow Discord's sidebar order. A new key rather than the old one, so the
// first read after a deploy fetches the new shape instead of serving an hour of the old.
const CACHE_KEY = 'discord:channels:v2';
const TTL_MS = 60 * 60 * 1000;

export async function membershipDiscordChannels(request, env, { authorize = authorizeAdmin, fetchImpl = globalThis.fetch, now = Date.now, allowCookie = false } = {}) {
  // sow-161 B: allowCookie threads the WEBSITE cookie session through (the categories channel column on
  // gbti.network). Default false keeps the extension's bearer-only path unchanged; a GET carries no CSRF.
  const auth = await authorize(request, env, { allowCookie });
  if (!auth.ok) return { status: auth.status ?? 403, body: { error: auth.error ?? 'forbidden' } };
  const r = await readGuildChannels(env, { fetchImpl, now });
  if (r.reason) return { status: 200, body: { channels: [], reason: r.reason } };
  if (!r.ok) return { status: 502, body: { error: 'discord-unavailable', message: r.message } };
  return { status: 200, body: { channels: r.channels, ...(r.cached ? { cached: r.cached } : {}) } };
}

/**
 * The guild's channels (id, name, type, parent), through the one-hour KV cache. sow-171: split out of the route so
 * the news publisher can check that a superadmin's chosen channel is really one of ours, from the same list the
 * picker showed. Returns { ok:true, channels, cached? } | { ok:false, reason:'discord-not-provisioned' } |
 * { ok:false, message }. A Discord failure serves the stale cache when one exists.
 */
export async function readGuildChannels(env, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return { ok: false, reason: 'discord-not-provisioned' };
  const kv = env.SIGNUP_KV;
  let cached = null;
  try { cached = kv ? await kv.get(CACHE_KEY, 'json') : null; } catch { cached = null; }
  if (cached && Array.isArray(cached.channels) && now() - (cached.generatedAt ?? 0) < TTL_MS) {
    return { ok: true, channels: cached.channels, cached: true };
  }
  try {
    const res = await fetchImpl(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/channels`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`discord ${res.status}`);
    const raw = await res.json();
    // type 0 = text, 5 = announcement, 4 = category group (kept so the UI can show the section a channel sits in).
    // position is Discord's sidebar order within each list (categories among categories, channels within one).
    const channels = (Array.isArray(raw) ? raw : [])
      .filter((c) => [0, 4, 5].includes(c.type))
      .map((c) => ({ id: String(c.id), name: String(c.name || ''), type: c.type, parentId: c.parent_id ? String(c.parent_id) : null,
        position: Number.isFinite(c.position) ? c.position : 0 }));
    const body = { channels, generatedAt: now() };
    try { if (kv) await kv.put(CACHE_KEY, JSON.stringify(body)); } catch { /* cache is best-effort */ }
    return { ok: true, channels };
  } catch (err) {
    if (cached && Array.isArray(cached.channels)) return { ok: true, channels: cached.channels, cached: 'stale' };
    return { ok: false, message: String(err?.message ?? err) };
  }
}
