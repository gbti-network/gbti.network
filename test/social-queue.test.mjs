// SOW-121: the Social Queue pure model. Covers the manual-assist config, the shared channel-text builder
// (parity with what the X adapter posts), the web-compose intent URL, and the task build/action/split helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syndicationConfigFromParsed, isManualAssist, manualAssistChannels, toSyndicationMirror, isChannelEnabled } from '../membership/syndication-config-core.mjs';
import { renderChannelText } from '../membership/syndication-render.mjs';
import { webComposeUrl } from '../membership/syndication-format.mjs';
import { buildSocialTask, applyTaskAction, splitTasks } from '../membership/social-queue.mjs';

test('manual_assist_channels normalizes to known channels and drives isManualAssist', () => {
  const cfg = syndicationConfigFromParsed({ syndication: { manual_assist_channels: ['x', 'bogus', 'x', 'reddit'] } });
  assert.deepEqual(manualAssistChannels(cfg), ['x', 'reddit']); // dedupe + drop unknown
  assert.equal(isManualAssist(cfg, 'x'), true);
  assert.equal(isManualAssist(cfg, 'discord'), false);
  assert.equal(isManualAssist(syndicationConfigFromParsed({}), 'x'), false); // default empty
});

test('toSyndicationMirror carries manual_assist_channels', () => {
  const m = toSyndicationMirror({ syndication: { manual_assist_channels: ['x'] } });
  assert.deepEqual(m.manual_assist_channels, ['x']);
});

test('renderChannelText: configured x template with the SOW-120 tokens, textOverride wins, 280 cap', () => {
  const cfg = syndicationConfigFromParsed({ syndication: { channel_templates: { x: {
    prompt: 'New {content-type} by {member-x-handle}: "{title}" {url} {category-hashtag} {tags-hashtags}',
  } } } });
  const item = { source: 'prompt', title: 'My Prompt', url: 'https://gbti.network/prompts/my-prompt/', authorName: 'Hudson Atwell', authorX: 'https://x.com/atwellpub', category: 'AI', tags: ['Prompts'] };
  const text = renderChannelText(cfg, item, 'x');
  assert.ok(text.includes('@atwellpub') && text.includes('#AI') && text.includes('#Prompts') && text.includes(item.url));
  assert.equal(renderChannelText(cfg, item, 'x', { textOverride: 'hand written' }), 'hand written');
  assert.ok(renderChannelText(cfg, { ...item, textOverride: undefined }, 'x', { textOverride: 'z'.repeat(400) }).length <= 280);
});

test('renderChannelText: a members-only item renders the stub, never a body', () => {
  const cfg = syndicationConfigFromParsed({});
  const text = renderChannelText(cfg, { source: 'post', title: 'Secret', url: 'https://gbti.network/x/', authorName: 'A', visibility: 'members' }, 'x');
  assert.ok(/Members-only/i.test(text)); // the X default stub
});

test('webComposeUrl builds the X intent and null for others', () => {
  assert.equal(webComposeUrl('x', 'hello #ai https://e.com'), 'https://twitter.com/intent/tweet?text=' + encodeURIComponent('hello #ai https://e.com'));
  assert.equal(webComposeUrl('discord', 'x'), null);
});

test('buildSocialTask: stable id per item+channel, public fields only, pending', () => {
  const item = { id: 'prompt:my-prompt#100', source: 'prompt', author: 'atwellpub', title: 'My Prompt', url: 'https://gbti.network/prompts/my-prompt/' };
  const t = buildSocialTask({ item, channel: 'x', text: 'the tweet', trigger: 'manual', now: 123 });
  assert.equal(t.id, 'prompt:my-prompt#100::x');
  assert.equal(t.channel, 'x');
  assert.equal(t.trigger, 'manual');
  assert.equal(t.status, 'pending');
  assert.equal(t.text, 'the tweet');
  assert.equal(t.createdAt, 123);
  assert.equal(buildSocialTask({ item, channel: 'x', text: 't', now: 1 }).trigger, 'auto'); // default
});

test('applyTaskAction: done stamps, delete removes, unknown is a no-op', () => {
  const t = buildSocialTask({ item: { id: 'a#1' }, channel: 'x', text: 't', now: 1 });
  const done = applyTaskAction(t, 'done', { githubId: '999' }, 555);
  assert.equal(done.ok, true); assert.equal(done.task.status, 'done'); assert.equal(done.task.doneAt, 555); assert.equal(done.task.doneBy, '999');
  const del = applyTaskAction(t, 'delete', {}, 1);
  assert.equal(del.ok, true); assert.equal(del.remove, true); assert.equal(del.task, null);
  assert.equal(applyTaskAction(t, 'nonsense', {}, 1).ok, false);
  assert.equal(applyTaskAction(null, 'done', {}, 1).ok, false);
});

test('splitTasks orders pending by createdAt and done by doneAt, newest first', () => {
  const mk = (id, status, c, d) => ({ id, status, createdAt: c, doneAt: d });
  const { pending, done } = splitTasks([mk('a', 'pending', 1), mk('b', 'pending', 3), mk('c', 'done', 0, 5), mk('d', 'done', 0, 9)]);
  assert.deepEqual(pending.map((t) => t.id), ['b', 'a']);
  assert.deepEqual(done.map((t) => t.id), ['d', 'c']);
});
