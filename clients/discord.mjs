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

    /** Post a message to a channel (SOW-018: syndicate a PUBLIC Share to the co-op Shares channel). */
    async postChannelMessage(channelId, content) {
      return req('POST', `/channels/${channelId}/messages`, { content });
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
