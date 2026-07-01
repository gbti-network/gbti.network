// SOW Part C: the deferred Discord-LINK flow on the signup Worker. The (extension-only) welcome opens this in a tab;
// it authenticates via the post-signup session cookie, runs Discord OAuth, then links discord_user_id + assigns the
// role. OPEN this endpoint (the session + nonce binding is on the Worker); do NOT reconstruct the OAuth URL here.
export const DISCORD_LINK_URL = 'https://signup.gbti.network/discord/link/start';
