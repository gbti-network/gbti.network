// SOW-058: the channel-adapter registry. Builds the per-channel adapters and exposes the set that is BOTH
// config-enabled AND has its secrets present (an enabled-but-unconfigured channel is reported, so the drain can
// record it "skipped" rather than "failed"). The drain iterates the resolved adapters.

import { createDiscordAdapter, createDiscordCategoryAdapter } from '../clients/syndication/discord-channel.mjs';
import { createXAdapter } from '../clients/syndication/x.mjs';
import { createLinkedinAdapter } from '../clients/syndication/linkedin.mjs';
import { createMastodonAdapter } from '../clients/syndication/mastodon.mjs';
import { createBlueskyAdapter } from '../clients/syndication/bluesky.mjs';
import { enabledChannelNames } from './syndication-config.mjs';
import { secretsPresent } from './syndication-channels.mjs';

const FACTORIES = {
  discord: createDiscordAdapter,
  'discord-category': createDiscordCategoryAdapter, // SOW-087: the second, category-channel Discord post
  x: createXAdapter,
  linkedin: createLinkedinAdapter,
  mastodon: createMastodonAdapter,
  bluesky: createBlueskyAdapter,
};

/** Build every adapter (keyed by name). Pure construction; no network until post() is called.
 *  SOW-087: `channelMap` (the KV-mirrored house/content-channels.yml) feeds the discord-category adapter;
 *  the other factories ignore it. */
export function buildAdapters({ env = {}, fetchImpl = globalThis.fetch, channelMap = null } = {}) {
  const out = {};
  for (const [name, make] of Object.entries(FACTORIES)) out[name] = make({ env, fetchImpl, channelMap });
  return out;
}

/**
 * Resolve the run plan for a config + env: which config-enabled channels are READY (secrets present, will be
 * attempted) vs SKIPPED (config-on but no secrets). Channels not enabled in config are omitted entirely.
 * Returns { ready: [adapter...], skipped: [name...] }.
 */
export function resolveAdapterRun({ cfg, env = {}, adapters = null, fetchImpl = globalThis.fetch, channelMap = null } = {}) {
  const all = adapters ?? buildAdapters({ env, fetchImpl, channelMap });
  const ready = [];
  const skipped = [];
  for (const name of enabledChannelNames(cfg)) {
    if (secretsPresent(env, name) && all[name]?.enabled?.()) ready.push(all[name]);
    else skipped.push(name);
  }
  return { ready, skipped };
}
