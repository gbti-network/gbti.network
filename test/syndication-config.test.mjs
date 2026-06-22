// SOW-058: the shared syndication config. Pure normalization, fail-closed defaults, and the secret-free KV
// mirror shape. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SYNDICATION_CONFIG, CHANNELS, syndicationConfigFromParsed, isSyndicationEnabled, holdMs,
  upvoteThreshold, isChannelEnabled, enabledChannelNames, toSyndicationMirror,
} from '../membership/syndication-config.mjs';

test('a missing/empty config fails closed to the safe defaults', () => {
  const c = syndicationConfigFromParsed({});
  assert.equal(c.enabled, false);
  assert.equal(c.hold_minutes, 60);
  assert.equal(c.upvote_threshold, 2);
  for (const name of CHANNELS) assert.equal(c.channels[name], false);
  assert.equal(isSyndicationEnabled(c), false);
});

test('reads the syndication: namespace and a bare object identically', () => {
  const a = syndicationConfigFromParsed({ syndication: { enabled: true, hold_minutes: 30 } });
  const b = syndicationConfigFromParsed({ enabled: true, hold_minutes: 30 });
  assert.deepEqual(a, b);
  assert.equal(a.enabled, true);
  assert.equal(holdMs(a), 30 * 60_000);
});

test('hold_minutes coerces to a non-negative integer; threshold never drops below 1', () => {
  assert.equal(syndicationConfigFromParsed({ hold_minutes: -5 }).hold_minutes, 0);
  assert.equal(syndicationConfigFromParsed({ hold_minutes: 90.9 }).hold_minutes, 90);
  assert.equal(syndicationConfigFromParsed({ hold_minutes: 'nope' }).hold_minutes, 60); // fallback
  assert.equal(upvoteThreshold(syndicationConfigFromParsed({ upvote_threshold: 0 })), 2); // 0 is invalid -> default
  assert.equal(upvoteThreshold(syndicationConfigFromParsed({ upvote_threshold: 5 })), 5);
  assert.equal(upvoteThreshold(syndicationConfigFromParsed({ upvote_threshold: '3' })), 3);
});

test('channel switches accept yes/on/1 string forms and default false', () => {
  const c = syndicationConfigFromParsed({ channels: { discord: 'on', x: 'yes', linkedin: 1, mastodon: 'off' } });
  assert.equal(isChannelEnabled(c, 'discord'), true);
  assert.equal(isChannelEnabled(c, 'x'), true);
  assert.equal(isChannelEnabled(c, 'linkedin'), true);
  assert.equal(isChannelEnabled(c, 'mastodon'), false);
  assert.equal(isChannelEnabled(c, 'bluesky'), false); // missing -> default false
  assert.deepEqual(enabledChannelNames(c).sort(), ['discord', 'linkedin', 'x']);
});

test('toSyndicationMirror returns the secret-free shape for KV', () => {
  const m = toSyndicationMirror({ enabled: true, hold_minutes: 60, upvote_threshold: 2, channels: { discord: true } });
  assert.deepEqual(m, {
    enabled: true, hold_minutes: 60, upvote_threshold: 2,
    channels: { discord: true, x: false, linkedin: false, mastodon: false, bluesky: false },
  });
  // No surprise keys (no token/secret fields).
  assert.deepEqual(Object.keys(m).sort(), ['channels', 'enabled', 'hold_minutes', 'upvote_threshold']);
});

test('DEFAULT_SYNDICATION_CONFIG is frozen and disabled', () => {
  assert.ok(Object.isFrozen(DEFAULT_SYNDICATION_CONFIG));
  assert.equal(DEFAULT_SYNDICATION_CONFIG.enabled, false);
});
