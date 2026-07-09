// SOW-058: the shared syndication config. Pure normalization, fail-closed defaults, and the secret-free KV
// mirror shape. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SYNDICATION_CONFIG, CHANNELS, syndicationConfigFromParsed, isSyndicationEnabled, holdMs,
  upvoteThreshold, isChannelEnabled, enabledChannelNames, toSyndicationMirror, classifyMode, templateFor, newsEngagement,
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
    enabled: true, require_approval: true, hold_minutes: 60, upvote_threshold: 2, classify: 'ai',
    templates: { share: 'New {content-type} published by {member-discord-username}: "{title}" {url}', post: 'New {content-type} published by {member-discord-username}: "{title}" {url}', product: 'New {content-type} published by {member-discord-username}: "{title}" {url}', prompt: 'New {content-type} published by {member-discord-username}: "{title}" {url}' },
    news_engagement: { enabled: false, open_threshold: 2, tier: 'paid', comment_autopost: true },
    channels: { discord: true, 'discord-category': false, x: false, linkedin: false, mastodon: false, bluesky: false },
  });
  // No surprise keys (no token/secret fields).
  assert.deepEqual(Object.keys(m).sort(), ['channels', 'classify', 'enabled', 'hold_minutes', 'news_engagement', 'require_approval', 'templates', 'upvote_threshold']);
});

test('DEFAULT_SYNDICATION_CONFIG is frozen and disabled', () => {
  assert.ok(Object.isFrozen(DEFAULT_SYNDICATION_CONFIG));
  assert.equal(DEFAULT_SYNDICATION_CONFIG.enabled, false);
});

// SOW-087: the share category suggestion knob.
test('classifyMode normalizes ai|keyword|off and falls back to ai', () => {
  assert.equal(classifyMode(syndicationConfigFromParsed({ syndication: { classify: 'keyword' } })), 'keyword');
  assert.equal(classifyMode(syndicationConfigFromParsed({ syndication: { classify: ' OFF ' } })), 'off');
  assert.equal(classifyMode(syndicationConfigFromParsed({ syndication: { classify: 'llm' } })), 'ai'); // unknown -> default
  assert.equal(classifyMode(syndicationConfigFromParsed({})), 'ai');
  assert.equal(classifyMode(undefined), 'ai');
});

// SOW-087: the per-type Discord templates.
test('templateFor: configured template wins, blank/missing falls back to the type default or null', () => {
  const cfg = syndicationConfigFromParsed({ syndication: { templates: { share: '{title} by {author}', post: '  ' } } });
  assert.equal(templateFor(cfg, 'share'), '{title} by {author}');
  // SOW-088: every type now has the one owner-directed default, so a blank config falls back to it.
  assert.equal(templateFor(cfg, 'post'), 'New {content-type} published by {member-discord-username}: "{title}" {url}');
  assert.equal(templateFor(syndicationConfigFromParsed({}), 'share'), 'New {content-type} published by {member-discord-username}: "{title}" {url}');
  assert.equal(templateFor(undefined, 'share'), 'New {content-type} published by {member-discord-username}: "{title}" {url}');
  assert.equal(templateFor(undefined, 'product'), 'New {content-type} published by {member-discord-username}: "{title}" {url}');
});

// SOW-111: the news engagement auto-share block.
test('newsEngagement: fail-closed defaults, normalization, and a bad tier falls back to paid', () => {
  const d = newsEngagement(syndicationConfigFromParsed({}));
  assert.deepEqual(d, { enabled: false, open_threshold: 2, tier: 'paid', comment_autopost: true });
  const c = newsEngagement(syndicationConfigFromParsed({ syndication: { news_engagement: {
    enabled: 'yes', open_threshold: '3', tier: ' Signed-In ', comment_autopost: 'off',
  } } }));
  assert.deepEqual(c, { enabled: true, open_threshold: 3, tier: 'signed-in', comment_autopost: false });
  const bad = newsEngagement(syndicationConfigFromParsed({ syndication: { news_engagement: { tier: 'everyone', open_threshold: 0 } } }));
  assert.equal(bad.tier, 'paid');
  assert.equal(bad.open_threshold, 2); // below-1 falls back
  assert.deepEqual(newsEngagement(undefined), d);
});

// SOW-088: the admin pipeline-settings edit (master / approval / hold / per-channel switches).
test('setSyndicationSettings patches only the supplied fields, validates hard, and is idempotent', async () => {
  const { setSyndicationSettings } = await import('../membership/syndication-template-edits.mjs');
  const doc = { syndication: { enabled: true, require_approval: true, hold_minutes: 60, channels: { discord: true, x: true } } };
  const ctx = { now: '2026-07-09T00:00:00.000Z', actor: { githubId: '1', login: 'atwellpub' } };
  const r = setSyndicationSettings(doc, { requireApproval: false, channels: { x: false, bluesky: false } }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.syndication.require_approval, false);
  assert.equal(r.next.syndication.channels.x, false);
  assert.equal(r.next.syndication.enabled, true); // untouched field survives
  assert.equal(r.audit.action, 'syndication-settings.set');
  // Idempotent against the new state.
  assert.equal(setSyndicationSettings(r.next, { requireApproval: false, channels: { x: false } }, ctx).changed, false);
  // Hard validation.
  const { TemplateEditError } = await import('../membership/syndication-template-edits.mjs');
  assert.throws(() => setSyndicationSettings(doc, { holdMinutes: 9999 }, ctx), TemplateEditError);
  assert.throws(() => setSyndicationSettings(doc, { channels: { myspace: true } }, ctx), TemplateEditError);
  assert.throws(() => setSyndicationSettings(doc, { enabled: 'yes' }, ctx), TemplateEditError);
});
