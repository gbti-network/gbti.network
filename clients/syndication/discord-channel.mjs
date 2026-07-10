// SOW-058: the Discord syndication adapters. Reuses clients/discord.mjs (ping-safe allowed_mentions); allows
// ONLY the resolved author mention (item.mention), never a mass ping.
//
// SOW-087 DUAL-POST model (owner-decided): every item posts to its per-type FEATURED channel (#articles /
// #products / #prompts / #shares via the DISCORD_CHANNEL_* env vars — the `discord` adapter, unchanged), and
// ADDITIONALLY to the channel mapped to its CATEGORY in house/content-channels.yml (the `discord-category`
// adapter below, fed the KV-mirrored map by the drain). An unmapped category, or a category channel equal to
// the per-type channel, is a clean recorded no-op (status "skipped"), never a retry loop.

import { createDiscordClient } from '../discord.mjs';
import { buildChannelText, renderTemplate } from '../../membership/syndication-format.mjs';
import { channelLimit } from '../../membership/syndication-channels.mjs';
import { channelForCategory, channelForCategoryPath } from '../../membership/news-channels.mjs';
import { templateFor } from '../../membership/syndication-config-core.mjs';

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

/** Post one item to one channel id. Shared by both Discord adapters.
 *  SOW-087: a configured per-type template (house/syndication-config.yml `templates:`) replaces the built-in
 *  message; the default share template is "Shared by {memberdiscord} {shareurl}" (no-ping full name when the
 *  mention does not resolve). allowed_mentions still caps pings to the author id either way. */
export async function postToChannel(channelId, item, { env, fetchImpl, client, cfg, textOverride = null, templateChannel = null }) {
  const discord = client ?? createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl });
  // SOW-088: the caller names which channel's template set applies ('discord' featured vs
  // 'discord-category'); the chain is channel override -> shared map -> built-in.
  const template = templateFor(cfg, item.source, templateChannel);
  let content;
  if (typeof textOverride === 'string' && textOverride.trim()) {
    // SOW-088 manual syndicate: the caller already rendered (and mention-sanitized) the message via the
    // shared renderTemplate; allowed_mentions below still caps pings to the author either way.
    content = textOverride;
  } else if (template) {
    content = renderTemplate(template, item, { limit: channelLimit('discord') });
  } else {
    // Discord protects mass mentions via allowed_mentions, so the author mention may be a real <@id> here.
    const text = buildChannelText(item, { limit: channelLimit('discord') - 32, sanitize: false });
    content = item.mention ? `${item.mention} ${text}` : text;
  }
  const res = await discord.postChannelMessage(channelId, content, { allowedMentions: allowedMentionsFor(item.mention) });
  const id = res?.id || null;
  const url = id && (res?.channel_id || channelId) ? `https://discord.com/channels/${env.DISCORD_GUILD_ID || '@me'}/${res?.channel_id || channelId}/${id}` : null;
  return { ok: true, id, url };
}

/** The FEATURED per-type post (#articles/#products/#prompts/#shares). */
export function createDiscordAdapter({ env = {}, fetchImpl = globalThis.fetch, client = null, cfg = null } = {}) {
  return {
    name: 'discord',
    enabled() { return Boolean(env.DISCORD_BOT_TOKEN); },
    async post(item) {
      const channelId = env[CHANNEL_ENV[item.source]] || null;
      if (!channelId) return { ok: false, error: `no Discord channel configured for ${item.source}` };
      return postToChannel(channelId, item, { env, fetchImpl, client, cfg, templateChannel: 'discord' });
    },
  };
}

/** SOW-087: the SECOND post, to the item's category-mapped channel (house/content-channels.yml via KV). */
export function createDiscordCategoryAdapter({ env = {}, fetchImpl = globalThis.fetch, client = null, channelMap = null, cfg = null } = {}) {
  return {
    name: 'discord-category',
    enabled() { return Boolean(env.DISCORD_BOT_TOKEN); },
    async post(item) {
      // SOW-088: the FULL taxonomy path resolves DEEPEST-mapped first (skill -> #devops beats ai -> #general);
      // items without a path (shares, older queue records) keep the flat single-key behavior.
      const mapped = channelForCategoryPath(channelMap, item.categoryPath?.length ? item.categoryPath : [item.category]);
      // No category / unmapped category: only the featured post happens. A clean terminal no-op, never a retry.
      if (!mapped) return { ok: true, skipped: true, reason: item.category ? `no channel mapped for category "${item.category}"` : 'no category on the item' };
      // Misconfiguration guard: the category channel equals the per-type channel; never double-post one channel.
      if (mapped === (env[CHANNEL_ENV[item.source]] || null)) return { ok: true, skipped: true, reason: 'the category channel equals the per-type channel' };
      return postToChannel(mapped, item, { env, fetchImpl, client, cfg, templateChannel: 'discord-category' });
    },
  };
}
