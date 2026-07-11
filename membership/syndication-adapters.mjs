// SOW-058: the channel-adapter registry. Builds the per-channel adapters and exposes the set that is BOTH
// config-enabled AND has its secrets present (an enabled-but-unconfigured channel is reported, so the drain can
// record it "skipped" rather than "failed"). The drain iterates the resolved adapters.

import { createDiscordAdapter, createDiscordCategoryAdapter } from '../clients/syndication/discord-channel.mjs';
import { createXAdapter } from '../clients/syndication/x.mjs';
import { createLinkedinAdapter } from '../clients/syndication/linkedin.mjs';
import { createMastodonAdapter } from '../clients/syndication/mastodon.mjs';
import { createBlueskyAdapter } from '../clients/syndication/bluesky.mjs';
import { createRedditAdapter } from '../clients/syndication/reddit.mjs'; // SOW-088: the Radle port
import { createDevtoAdapter } from '../clients/syndication/devto.mjs'; // SOW-088: full-body crossposts to the GBTI org
import { enabledChannelNames } from './syndication-config-core.mjs';
import { secretsPresent } from './syndication-channels.mjs';

const FACTORIES = {
  discord: createDiscordAdapter,
  'discord-category': createDiscordCategoryAdapter, // SOW-087: the second, category-channel Discord post
  x: createXAdapter,
  linkedin: createLinkedinAdapter,
  mastodon: createMastodonAdapter,
  bluesky: createBlueskyAdapter,
  reddit: createRedditAdapter, // SOW-088,
  devto: ({ env, fetchImpl, cfg }) => createDevtoAdapter({ env, fetchImpl, cfg }),
};

/** Build every adapter (keyed by name). Pure construction; no network until post() is called.
 *  SOW-087: `channelMap` (the KV-mirrored house/content-channels.yml) feeds the discord-category adapter and
 *  `cfg` carries the per-type Discord templates; the other factories ignore both. */
export function buildAdapters({ env = {}, fetchImpl = globalThis.fetch, channelMap = null, cfg = null } = {}) {
  const out = {};
  for (const [name, make] of Object.entries(FACTORIES)) out[name] = make({ env, fetchImpl, channelMap, cfg });
  return out;
}

/**
 * Resolve the run plan for a config + env: which config-enabled channels are READY (secrets present, will be
 * attempted) vs SKIPPED (config-on but no secrets). Channels not enabled in config are omitted entirely.
 * Returns { ready: [adapter...], skipped: [name...] }.
 */
export function resolveAdapterRun({ cfg, env = {}, adapters = null, fetchImpl = globalThis.fetch, channelMap = null } = {}) {
  const all = adapters ?? buildAdapters({ env, fetchImpl, channelMap, cfg });
  const ready = [];
  const skipped = [];
  for (const name of enabledChannelNames(cfg)) {
    if (secretsPresent(env, name) && all[name]?.enabled?.()) ready.push(all[name]);
    else skipped.push(name);
  }
  return { ready, skipped };
}
