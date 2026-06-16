// SOW-029: the OFFLINE FALLBACK Discord invite for the welcome view. The welcome view now prefers a fresh,
// bot-minted invite from the Worker (GET /membership/discord-invite, gated + KV-cached); this static link is used
// ONLY when that endpoint is unreachable (e.g. the bot/channel are not yet provisioned). To set a real permanent
// fallback, put a never-expiring community invite here and rebuild (node client-ui/build.mjs && npm run
// build:extension). The live path is provisioned via DISCORD_INVITE_CHANNEL_ID on the Worker.
export const DISCORD_INVITE_URL = 'https://discord.gg/gbti-network';
