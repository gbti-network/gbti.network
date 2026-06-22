// SOW-058: the Discord syndication adapter. Reuses clients/discord.mjs (ping-safe allowed_mentions). Posts the
// queue item to the per-source channel; allows ONLY the resolved author mention (item.mention), never a mass ping.

import { createDiscordClient } from '../discord.mjs';
import { buildChannelText } from '../../membership/syndication-format.mjs';
import { channelLimit } from '../../membership/syndication-channels.mjs';

const CHANNEL_ENV = {
  post: 'DISCORD_CHANNEL_POSTS',
  product: 'DISCORD_CHANNEL_PRODUCTS',
  prompt: 'DISCORD_CHANNEL_PROMPTS',
  share: 'DISCORD_CHANNEL_SHARES',
};

/** allow ONLY the resolved author (a `<@id>` mention) to be pinged; author text never fires a mass/role ping. */
function allowedMentionsFor(mention) {
  const m = /^<@!?(\d+)>$/.exec(String(mention || ''));
  return m ? { parse: [], users: [m[1]] } : { parse: [] };
}

export function createDiscordAdapter({ env = {}, fetchImpl = globalThis.fetch, client = null } = {}) {
  return {
    name: 'discord',
    enabled() { return Boolean(env.DISCORD_BOT_TOKEN); },
    async post(item) {
      const channelId = env[CHANNEL_ENV[item.source]] || null;
      if (!channelId) return { ok: false, error: `no Discord channel configured for ${item.source}` };
      const discord = client ?? createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl });
      // Discord protects mass mentions via allowed_mentions, so the author mention may be a real <@id> here.
      const text = buildChannelText(item, { limit: channelLimit('discord') - 32, sanitize: false });
      const content = item.mention ? `${item.mention} ${text}` : text;
      const res = await discord.postChannelMessage(channelId, content, { allowedMentions: allowedMentionsFor(item.mention) });
      const id = res?.id || null;
      const url = id && (res?.channel_id || channelId) ? `https://discord.com/channels/${env.DISCORD_GUILD_ID || '@me'}/${res?.channel_id || channelId}/${id}` : null;
      return { ok: true, id, url };
    },
  };
}
