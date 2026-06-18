// SOW-043 groundwork: the news-category -> Discord channel map (membership/news-channels.mjs). Pure over the
// parsed house/news-channels.yml; resolves a category to its channel (fail-closed null when unmapped) + the CI
// structural validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsChannelMap, channelForCategory, validateNewsChannels } from '../membership/news-channels.mjs';

const cfg = { channels: [{ category: 'ai', channelId: '111111111111111111' }, { category: 'DevOps', channelId: '222222222222222222' }] };

test('newsChannelMap builds a case-insensitive category -> channelId map', () => {
  const m = newsChannelMap(cfg);
  assert.equal(m.get('ai'), '111111111111111111');
  assert.equal(m.get('devops'), '222222222222222222'); // lower-cased
  assert.equal(m.size, 2);
});

test('channelForCategory resolves (case-insensitive) or fails closed to null', () => {
  assert.equal(channelForCategory(cfg, 'AI'), '111111111111111111');
  assert.equal(channelForCategory(cfg, 'devops'), '222222222222222222');
  assert.equal(channelForCategory(cfg, 'blockchain'), null); // unmapped -> no post
  assert.equal(channelForCategory(null, 'ai'), null);
  assert.equal(channelForCategory({}, 'ai'), null);
});

test('validateNewsChannels: an absent map or an empty list is valid', () => {
  assert.deepEqual(validateNewsChannels(null), []);
  assert.deepEqual(validateNewsChannels({ channels: [] }), []);
  assert.deepEqual(validateNewsChannels(cfg), []);
});

test('validateNewsChannels flags a missing channels list, a non-list, a bad/empty channelId, and a dup category', () => {
  assert.ok(validateNewsChannels({}).some((e) => /channels:` list is required/.test(e)));
  assert.ok(validateNewsChannels({ channels: 'x' }).some((e) => /must be a list/.test(e)));
  assert.ok(validateNewsChannels({ channels: [{ category: 'ai', channelId: 'not-numeric' }] }).some((e) => /numeric Discord channel id/.test(e)));
  assert.ok(validateNewsChannels({ channels: [{ category: '', channelId: '111111' }] }).some((e) => /non-empty category/.test(e)));
  assert.ok(validateNewsChannels({ channels: [{ category: 'ai', channelId: '' }] }).some((e) => /non-empty channelId/.test(e)));
  assert.ok(validateNewsChannels({ channels: [{ category: 'ai', channelId: '111111' }, { category: 'AI', channelId: '222222' }] }).some((e) => /duplicate category/.test(e)));
});
