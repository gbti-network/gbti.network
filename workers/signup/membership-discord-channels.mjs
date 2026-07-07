// SOW-100 QA: the guild's Discord channel NAMES for the admin categories workspace. The channel map stores
// bare ids (git-native); names live only in Discord, and only the Worker holds the bot token — so this
// admin-gated read lists the guild's channels (id, name, type, parent) with a one-hour KV cache. Fail-closed
// on the admin gate; a Discord failure serves the stale cache when one exists.
import { authorizeAdmin } from './membership-admin.mjs';

const CACHE_KEY = 'discord:channels';
const TTL_MS = 60 * 60 * 1000;

export async function membershipDiscordChannels(request, env, { authorize = authorizeAdmin, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const auth = await authorize(request, env);
  if (!auth.ok) return { status: auth.status ?? 403, body: { error: auth.error ?? 'forbidden' } };
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
    return { status: 200, body: { channels: [], reason: 'discord-not-provisioned' } };
  }
  const kv = env.SIGNUP_KV;
  let cached = null;
  try { cached = kv ? await kv.get(CACHE_KEY, 'json') : null; } catch { cached = null; }
  if (cached && Array.isArray(cached.channels) && now() - (cached.generatedAt ?? 0) < TTL_MS) {
    return { status: 200, body: { channels: cached.channels, cached: true } };
  }
  try {
    const res = await fetchImpl(`https://discord.com/api/v10/guilds/${env.DISCORD_GUILD_ID}/channels`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`discord ${res.status}`);
    const raw = await res.json();
    // type 0 = text, 5 = announcement, 4 = category group (kept so the UI can show the section a channel sits in)
    const channels = (Array.isArray(raw) ? raw : [])
      .filter((c) => [0, 4, 5].includes(c.type))
      .map((c) => ({ id: String(c.id), name: String(c.name || ''), type: c.type, parentId: c.parent_id ? String(c.parent_id) : null }));
    const body = { channels, generatedAt: now() };
    try { if (kv) await kv.put(CACHE_KEY, JSON.stringify(body)); } catch { /* cache is best-effort */ }
    return { status: 200, body: { channels } };
  } catch (err) {
    if (cached && Array.isArray(cached.channels)) return { status: 200, body: { channels: cached.channels, cached: 'stale' } };
    return { status: 502, body: { error: 'discord-unavailable', message: String(err?.message ?? err) } };
  }
}
