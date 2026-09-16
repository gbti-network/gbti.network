// SOW-087: the pure edit cores behind the channel-map manager (content-channels + moderation flags +
// syndication templates). Idempotency, validation, audit shape. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setChannel, removeChannel, ContentChannelEditError } from '../membership/content-channels-edits.mjs';
import { addFlagTerm, removeFlagTerm, ModerationFlagEditError } from '../membership/moderation-flags-edits.mjs';
import { setTemplate, setNewsEngagement, TemplateEditError } from '../membership/syndication-template-edits.mjs';
import { templateFor, syndicationConfigFromParsed } from '../membership/syndication-config.mjs';

const ctx = { actor: { githubId: '42', login: 'root' }, now: '2026-07-04T00:00:00Z' };

test('setChannel upserts (add, update, no-op) with validation, sorted + lowercased', () => {
  const add = setChannel({ channels: [] }, { category: 'DevOps', channelId: '12345' }, ctx);
  assert.equal(add.changed, true);
  assert.deepEqual(add.next.channels, [{ category: 'devops', channelId: '12345' }]);
  assert.equal(add.audit.action, 'content-channel.set');
  assert.equal(add.audit.actor.github_id, '42');
  const noop = setChannel(add.next, { category: 'devops', channelId: '12345' }, ctx);
  assert.equal(noop.changed, false);
  const update = setChannel(add.next, { category: 'devops', channelId: '99999' }, ctx);
  assert.equal(update.changed, true);
  assert.equal(update.next.channels[0].channelId, '99999');
  assert.throws(() => setChannel({}, { category: 'Not Valid!', channelId: '12345' }, ctx), ContentChannelEditError);
  assert.throws(() => setChannel({}, { category: 'ai', channelId: 'abc' }, ctx), ContentChannelEditError);
});

test('removeChannel deletes a mapping; a missing category is an error', () => {
  const doc = { channels: [{ category: 'ai', channelId: '11111' }] };
  const r = removeChannel(doc, { category: 'AI' }, ctx);
  assert.equal(r.changed, true);
  assert.deepEqual(r.next.channels, []);
  assert.throws(() => removeChannel({ channels: [] }, { category: 'ai' }, ctx), ContentChannelEditError);
});

test('addFlagTerm / removeFlagTerm: case-insensitive idempotency, list must exist, caps enforced', () => {
  const doc = { lists: { political: ['election'], profanity: [] } };
  const add = addFlagTerm(doc, { list: 'profanity', term: ' Fudge ' }, ctx);
  assert.equal(add.changed, true);
  assert.deepEqual(add.next.lists.profanity, ['Fudge']);
  assert.equal(addFlagTerm(add.next, { list: 'profanity', term: 'fudge' }, ctx).changed, false);
  const rm = removeFlagTerm(add.next, { list: 'profanity', term: 'FUDGE' }, ctx);
  assert.deepEqual(rm.next.lists.profanity, []);
  assert.throws(() => addFlagTerm(doc, { list: 'nope', term: 'x' }, ctx), ModerationFlagEditError); // a typo never creates a list
  assert.throws(() => addFlagTerm(doc, { list: 'political', term: '' }, ctx), ModerationFlagEditError);
  assert.throws(() => removeFlagTerm(doc, { list: 'political', term: 'absent' }, ctx), ModerationFlagEditError);
});

test('setTemplate writes/clears syndication.templates and round-trips through templateFor', () => {
  const doc = { syndication: { enabled: true } };
  const set = setTemplate(doc, { type: 'share', template: '{title} {shareurl}' }, ctx);
  assert.equal(set.changed, true);
  assert.equal(templateFor(syndicationConfigFromParsed(set.next), 'share'), '{title} {shareurl}');
  assert.equal(setTemplate(set.next, { type: 'share', template: '{title} {shareurl}' }, ctx).changed, false);
  // clearing falls back to the share default
  const clear = setTemplate(set.next, { type: 'share', template: '' }, ctx);
  assert.equal(clear.changed, true);
  assert.equal(templateFor(syndicationConfigFromParsed(clear.next), 'share'), 'Shared on the GBTI Network: "{title}" {url}'); // sow-180: the share default is content-first, no member credit
  // the rest of the config survives the edit
  assert.equal(clear.next.syndication.enabled, true);
  assert.throws(() => setTemplate(doc, { type: 'news', template: 'x' }, ctx), TemplateEditError);
});

// SOW-111: the news engagement settings edit (same file as the templates).
test('setNewsEngagement patches only the supplied fields, validates hard, and is idempotent', () => {
  const doc = { syndication: { enabled: true, templates: { share: 'x' } } };
  const set = setNewsEngagement(doc, { enabled: true, openThreshold: 3, tier: 'paid-trial' }, ctx);
  assert.equal(set.changed, true);
  assert.deepEqual(set.next.syndication.news_engagement, { enabled: true, open_threshold: 3, tier: 'paid-trial', comment_autopost: true });
  assert.equal(set.next.syndication.templates.share, 'x'); // the rest of the config survives
  assert.equal(set.audit.action, 'news-engagement.set');
  // idempotent against the normalized current state
  assert.equal(setNewsEngagement(set.next, { openThreshold: 3 }, ctx).changed, false);
  // partial patch: only the tier changes
  const tierOnly = setNewsEngagement(set.next, { tier: 'signed-in' }, ctx);
  assert.equal(tierOnly.next.syndication.news_engagement.open_threshold, 3);
  assert.equal(tierOnly.next.syndication.news_engagement.tier, 'signed-in');
  // hard validation
  assert.throws(() => setNewsEngagement(doc, { tier: 'everyone' }, ctx), TemplateEditError);
  assert.throws(() => setNewsEngagement(doc, { openThreshold: 0 }, ctx), TemplateEditError);
  assert.throws(() => setNewsEngagement(doc, { enabled: 'yes' }, ctx), TemplateEditError);
});

// sow-274: the batch apply and the tag curation op MOVED to the network with the rest of the admin writes.
// Their guards (a migration kind refused, an empty batch, an unchanged batch, the tag mode/destination
// rules) are asserted against the real endpoint in test/admin-multifile-gate.test.mjs. What stays here is
// what is still pure: the edit cores above, and the retag helper below.

// SOW-100 tag curation: the pure retag helper.
import { retagContent } from '../client/src/content-ops.mjs';

test('retagContent renames, merges (dedupe), retires, and no-ops when absent', () => {
  const doc = '---\ntitle: X\ntags:\n  - claude-code\n  - workflow\n---\n\nBody\n';
  const renamed = retagContent(doc, { tag: 'claude-code', to: 'claude code' });
  assert.equal(renamed.changed, true);
  assert.match(renamed.content, /claude code/);
  assert.ok(!/claude-code/.test(renamed.content));
  const merged = retagContent(doc, { tag: 'claude-code', to: 'workflow' }); // dest already present -> dedupe
  assert.equal((merged.content.match(/workflow/g) || []).length, 1);
  const retired = retagContent(doc, { tag: 'workflow', to: null });
  assert.ok(!/workflow/.test(retired.content));
  assert.equal(retagContent(doc, { tag: 'ghost', to: 'x' }).changed, false);
});

// SOW-100 tag policy: member input normalizes to dash-connected tags at build time.
import { buildContentFile } from '../client/src/content-ops.mjs';
import { normalizeTag } from '../client/src/schemas.mjs';

test('tags normalize to dash-connected form and dedupe at build', () => {
  const b = buildContentFile({ type: 'post', username: 'alice', input: { title: 'X', slug: 'x', excerpt: 'e', categories: ['devops'], tags: ['Claude Code', 'claude-code', 'GBTI  Network', ' node.js '] }, body: 'B' });
  assert.deepEqual(b.frontmatter.tags, ['claude-code', 'gbti-network', 'node.js']);
  assert.equal(normalizeTag('  Multi   Word_Tag  '), 'multi-word-tag');
});
