// SOW-058: the pure message formatter. Sanitization, truncation, URL preservation, no body leak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelText, sanitizeMentions, hostOf } from '../membership/syndication-format.mjs';

test('sanitizeMentions neutralizes @mentions and Discord mass-ping tokens', () => {
  assert.ok(!/@everyone/.test(sanitizeMentions('hey @everyone')));
  assert.ok(!/@here/.test(sanitizeMentions('@here look')));
  assert.ok(!/<@\d+>/.test(sanitizeMentions('ping <@123456>')));
  // a normal @handle gets a zero-width space inserted so it does not resolve to a real mention
  const s = sanitizeMentions('thanks @alice');
  assert.ok(s.includes('@​'));
});

test('buildChannelText composes a lead + headline + blurb + url and carries NO body', () => {
  const item = { source: 'share', author: 'alice', title: 'Great read', blurb: 'why', url: 'https://ex.com/a' };
  const text = buildChannelText(item, { limit: 280 });
  assert.match(text, /shared by @​?alice/);
  assert.match(text, /Great read/);
  assert.match(text, /why/);
  assert.match(text, /https:\/\/ex\.com\/a/);
  assert.ok(!text.toLowerCase().includes('body'));
});

test('buildChannelText keeps the URL intact when truncating to a tight limit', () => {
  const item = { source: 'post', author: 'bob', title: 'A'.repeat(400), blurb: 'B'.repeat(400), url: 'https://ex.com/keep' };
  const text = buildChannelText(item, { limit: 100 });
  assert.ok(text.length <= 100, `expected <=100, got ${text.length}`);
  assert.ok(text.endsWith('https://ex.com/keep'), 'the URL survives truncation');
});

test('hostOf strips www and tolerates garbage', () => {
  assert.equal(hostOf('https://www.example.com/x'), 'example.com');
  assert.equal(hostOf('not a url'), '');
});
