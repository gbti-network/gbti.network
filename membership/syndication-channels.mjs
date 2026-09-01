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
  reddit: 300, // the Reddit post-title cap (SOW-088: the template renders the title)
  devto: 128, // the dev.to title cap (the article body is not template-limited)
  hashnode: 250, // SOW-134: the Hashnode title cap (the article body is not template-limited)
  dailydev: 300, // SOW-135: the daily.dev manual-assist note cap (a link + a short line; no secret keys, it is manual)
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
  // sow-260 (2026-08-26): the three OAuth secrets are GONE. They authenticated an application Reddit
  // destroyed when it banned the posting account on 2026-08-25, and it cannot be recreated because
  // self-service app creation closed in November 2025. Reddit is manual-assist now and the manual lane
  // needs no credential at all, so listing dead keys here would only make a working channel report itself
  // unconfigured. REDDIT_SUBREDDIT stays: it names the destination and the dormant adapter still reads it.
  reddit: ['REDDIT_SUBREDDIT'], // SOW-088, narrowed by sow-260
  devto: ['DEVTO_API_KEY', 'DEVTO_ORG_ID'], // SOW-088: full-body crossposts to the GBTI dev.to organization
  hashnode: ['HASHNODE_TOKEN', 'HASHNODE_PUBLICATION_ID'], // SOW-134: PAT + the gbti.hashnode.dev publication id
});

// sow-300: DOES THIS CHANNEL'S DELIVERY SURFACE RENDER MARKDOWN?
//
// READ THE NAME LITERALLY: this is about the surface the text lands on, NOT about the platform. Reddit is
// `false` even though Reddit's API accepts markdown, because the manual rail hands the text to a human who
// pastes it into Reddit's RICH-TEXT composer, and that composer renders pasted markdown as literal
// asterisks. That is the defect this exists to fix. Do not "correct" reddit to true on the grounds that
// Reddit supports markdown; it does, in an editor our members are not using.
//
// An unknown channel defaults to FALSE. A channel added later without registering here then delivers clean
// text, which is the harmless direction; the other default ships asterisks to a live audience.
//
// The one deliberate exception lives in syndication-render.mjs: `renderRedditComment` keeps its markdown
// even though reddit is false here, because that stored markdown is the SOURCE the Social Queue's copy
// button converts into the clipboard's text/html flavour. See membership/markdown-plain.mjs.
export const CHANNEL_MARKDOWN = Object.freeze({
  discord: true,            // a Discord message, and Discord renders markdown natively
  'discord-category': true, // the same bot, the same rendering
  // EVERY OTHER CHANNEL IS FALSE, INCLUDING dev.to AND HASHNODE, and those two are the ones that look wrong.
  // They are markdown platforms. But this map governs the text renderChannelText produces, and on dev.to and
  // Hashnode that text is the post TITLE (see the channelOnly note in syndication-config-core.mjs), which is
  // a plain-text field on both. Their article BODIES never pass through here: they are built by
  // renderBodyTemplate and keep their markdown untouched. Flip either of these to true and you put
  // asterisks in an article title.
  devto: false,
  hashnode: false,
  reddit: false,            // the manual rail is the rich-text composer, not the markdown editor
  x: false,
  bluesky: false,
  mastodon: false,
  linkedin: false,
  dailydev: false,
});

/** Does this channel's delivery surface render markdown? Unknown channels fail to FALSE (strip it). */
export function rendersMarkdown(name) {
  return CHANNEL_MARKDOWN[name] === true;
}

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
