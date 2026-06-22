// SOW-058: the channel registry. Pure limits + secret-presence + readiness. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL_LIMITS, channelLimit, secretsPresent, resolveEnabledChannels, channelReadiness,
} from '../membership/syndication-channels.mjs';

test('channelLimit returns per-channel caps with a safe default', () => {
  assert.equal(channelLimit('x'), 280);
  assert.equal(channelLimit('bluesky'), 300);
  assert.equal(channelLimit('discord'), CHANNEL_LIMITS.discord);
  assert.equal(channelLimit('unknown'), 280); // default
});

test('secretsPresent requires every key for the channel', () => {
  assert.equal(secretsPresent({ DISCORD_BOT_TOKEN: 'x' }, 'discord'), true);
  assert.equal(secretsPresent({ DISCORD_BOT_TOKEN: '   ' }, 'discord'), false); // blank counts as missing
  assert.equal(secretsPresent({ MASTODON_BASE_URL: 'https://m' }, 'mastodon'), false); // missing token
  assert.equal(
    secretsPresent({ MASTODON_BASE_URL: 'https://m', MASTODON_ACCESS_TOKEN: 't' }, 'mastodon'),
    true,
  );
  assert.equal(secretsPresent({}, 'nope'), false);
});

test('resolveEnabledChannels = config-enabled AND secrets present', () => {
  const env = { DISCORD_BOT_TOKEN: 't', BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' };
  // discord + bluesky have secrets; x is config-on but has no secrets -> dropped
  const out = resolveEnabledChannels({ cfgEnabled: ['discord', 'x', 'bluesky'], env });
  assert.deepEqual(out.sort(), ['bluesky', 'discord']);
});

test('channelReadiness reports ready vs no-secret over the config-enabled set', () => {
  const env = { DISCORD_BOT_TOKEN: 't' };
  const r = channelReadiness({ cfgEnabled: ['discord', 'mastodon'], env });
  assert.deepEqual(r, { discord: 'ready', mastodon: 'no-secret' });
});
