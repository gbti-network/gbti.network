// Thin Discord REST client (bot auth) for guild join + role sync (SOW-002 / SOW-005). Injectable
// fetch. The bot's own role must sit ABOVE the trial and member roles or these calls fail (403).
// Role-mutation calls return 204 No Content on success; we normalize that to null.

export class DiscordError extends Error {
  constructor(status, body) {
    super(`discord error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

export function createDiscordClient({ botToken, fetch = globalThis.fetch, baseUrl = 'https://discord.com/api/v10' }) {
  if (!botToken) throw new Error('createDiscordClient: botToken is required');

  async function req(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) throw new DiscordError(res.status, text);
    return text ? JSON.parse(text) : null;
  }

  return {
    _req: req,

    /** Add a user to the guild using their OAuth access token (scope guilds.join), optionally with roles. */
    addGuildMember(guildId, userId, { accessToken, roles = [] }) {
      return req('PUT', `/guilds/${guildId}/members/${userId}`, { access_token: accessToken, roles });
    },

    getMember(guildId, userId) {
      return req('GET', `/guilds/${guildId}/members/${userId}`).catch((e) => {
        if (e instanceof DiscordError && e.status === 404) return null;
        throw e;
      });
    },

    addRole(guildId, userId, roleId) {
      return req('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
    },

    removeRole(guildId, userId, roleId) {
      return req('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
    },

    /** DM a user (used for the optional secondary day-87 nudge): open a DM channel then post. */
    async sendDirectMessage(userId, content) {
      const channel = await req('POST', '/users/@me/channels', { recipient_id: userId });
      return req('POST', `/channels/${channel.id}/messages`, { content });
    },

    /** Post a message to a channel (SOW-018/034: syndicate content to a co-op channel). SAFE BY DEFAULT: the
     *  message content can carry member-authored text (titles), so allowed_mentions defaults to `{ parse: [] }`
     *  -- NO @everyone/@here/role/user pings fire from raw text. A caller opts into a specific ping (e.g. the
     *  resolved author) by passing allowedMentions: { parse: [], users: ['<id>'] }. */
    async postChannelMessage(channelId, content, { allowedMentions = { parse: [] } } = {}) {
      return req('POST', `/channels/${channelId}/messages`, { content, allowed_mentions: allowedMentions });
    },

    /** Edit a message the bot posted (SOW-046 D: append a "discussion started" notice to a news post). Same
     *  ping-safe default as postChannelMessage. Needs the message to be the bot's own. */
    async editChannelMessage(channelId, messageId, content, { allowedMentions = { parse: [] } } = {}) {
      return req('PATCH', `/channels/${channelId}/messages/${messageId}`, { content, allowed_mentions: allowedMentions });
    },

    /** SOW-087: list a guild's channels (id, name, type, parent_id). Read-only; used by the
     *  seed-content-channels script to name-match category channels. Needs the bot in the guild. */
    async listGuildChannels(guildId) {
      return req('GET', `/guilds/${guildId}/channels`);
    },

    /**
     * Create an instant invite to a channel (on-demand guild invite). Needs CREATE_INSTANT_INVITE on the
     * channel for the bot. `maxAgeSeconds` 0 = never expires; `maxUses` 0 = unlimited; `unique: true` forces a
     * fresh code instead of reusing an equivalent existing one. Returns the API invite object plus a convenience
     * `url` (`https://discord.gg/<code>`), or null.
     */
    async createInvite(channelId, { maxAgeSeconds = 0, maxUses = 0, unique = false } = {}) {
      const inv = await req('POST', `/channels/${channelId}/invites`, { max_age: maxAgeSeconds, max_uses: maxUses, unique });
      if (!inv || !inv.code) return null;
      return { ...inv, url: `https://discord.gg/${inv.code}` };
    },
  };
}
