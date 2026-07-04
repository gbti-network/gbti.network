// SOW-058: the channel registry. Pure config/limits logic shared by the drain and the adapters. No IO.
//
// A channel is ATTEMPTED only when it is BOTH switched on in house/syndication-config.yml AND has its secrets
// present in the environment. A channel switched on with no secret is recorded "skipped" (not "failed"); a
// channel switched off is not attempted at all. The actual posting lives in the adapters (clients/syndication/*).

// Per-channel character caps for the formatted message body. Conservative; the adapter truncates to this.
export const CHANNEL_LIMITS = Object.freeze({
  discord: 2000,
  'discord-category': 2000, // SOW-087: the category-channel Discord post
  x: 280,
  linkedin: 3000,
  mastodon: 500,
  bluesky: 300,
});

// The env var(s) each channel requires to be considered configured. Discord needs the bot token (the per-type
// channel id is resolved separately at post time). The social channels need their brand-account credentials.
export const CHANNEL_SECRET_KEYS = Object.freeze({
  discord: ['DISCORD_BOT_TOKEN'],
  'discord-category': ['DISCORD_BOT_TOKEN'], // SOW-087: the same bot posts the category-channel copy
  x: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'],
  linkedin: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORG_URN'],
  mastodon: ['MASTODON_BASE_URL', 'MASTODON_ACCESS_TOKEN'],
  bluesky: ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'],
});

/** The character cap for a channel (a small safe default for an unknown name). */
export function channelLimit(name) {
  return CHANNEL_LIMITS[name] ?? 280;
}

/** Are all the secret env vars for this channel present and non-empty? */
export function secretsPresent(env, name) {
  const keys = CHANNEL_SECRET_KEYS[name];
  if (!keys) return false;
  return keys.every((k) => typeof env?.[k] === 'string' && env[k].trim() !== '');
}

/**
 * Resolve which channels to ATTEMPT for this run: switched on in config AND with secrets present. `cfgEnabled`
 * is the list of channel names config-enabled (from enabledChannelNames(cfg)).
 */
export function resolveEnabledChannels({ cfgEnabled = [], env = {} } = {}) {
  return cfgEnabled.filter((name) => secretsPresent(env, name));
}

/**
 * A per-channel status map for the tracker/drain over the config-enabled set: 'ready' (will attempt),
 * 'no-secret' (config-on but missing secrets -> recorded "skipped"). Channels not config-enabled are omitted.
 */
export function channelReadiness({ cfgEnabled = [], env = {} } = {}) {
  const out = {};
  for (const name of cfgEnabled) out[name] = secretsPresent(env, name) ? 'ready' : 'no-secret';
  return out;
}
