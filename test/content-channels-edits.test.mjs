// SOW-087: the pure edit cores behind the channel-map manager (content-channels + moderation flags +
// syndication templates). Idempotency, validation, audit shape. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setChannel, removeChannel, ContentChannelEditError } from '../membership/content-channels-edits.mjs';
import { addFlagTerm, removeFlagTerm, ModerationFlagEditError } from '../membership/moderation-flags-edits.mjs';
import { setTemplate, TemplateEditError } from '../membership/syndication-template-edits.mjs';
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
  assert.equal(templateFor(syndicationConfigFromParsed(clear.next), 'share'), 'Shared by {memberdiscord} {shareurl}');
  // the rest of the config survives the edit
  assert.equal(clear.next.syndication.enabled, true);
  assert.throws(() => setTemplate(doc, { type: 'news', template: 'x' }, ctx), TemplateEditError);
});
