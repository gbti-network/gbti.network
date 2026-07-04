// SOW-058: the pure message formatter. Sanitization, truncation, URL preservation, no body leak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelText, sanitizeMentions, hostOf, renderTemplate } from '../membership/syndication-format.mjs';

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

// ---- SOW-087: the configurable Discord template ----

const T = 'Shared by {memberdiscord} {shareurl}';

test('renderTemplate: a resolved mention pings; no mention falls back to the no-ping full name', () => {
  const withMention = renderTemplate(T, { mention: '<@123>', authorName: 'Alice Q', url: 'https://ex.com/a' });
  assert.equal(withMention, 'Shared by <@123> https://ex.com/a');
  const noMention = renderTemplate(T, { mention: '@alice', authorName: 'Alice Q', url: 'https://ex.com/a' });
  assert.ok(noMention.startsWith('Shared by Alice Q'));
  assert.ok(!noMention.includes('<@')); // no ping token
  const noName = renderTemplate(T, { author: 'alice', url: 'https://ex.com/a' });
  assert.ok(noName.includes('alice')); // @login text fallback (zero-width-space neutralized)
});

test('renderTemplate sanitizes every author-controlled variable (never a mass mention)', () => {
  const out = renderTemplate('{title} {fullName} {category}', {
    title: '@everyone free stuff <@&999>',
    authorName: '@here Bob',
    category: 'devops',
  });
  assert.ok(!out.includes('@everyone'));
  assert.ok(!out.includes('@here'));
  assert.ok(!out.includes('<@&999>'));
  assert.ok(out.includes('devops'));
  // a forged mention token in authorName is stripped, not passed through as {memberdiscord}
  const forged = renderTemplate(T, { authorName: '<@666>', url: 'https://x.y' });
  assert.ok(!forged.includes('<@666>'));
});

test('renderTemplate: unknown tokens render empty, case-insensitive names, truncation applies', () => {
  assert.equal(renderTemplate('A {nope} B', {}), 'A B');
  assert.equal(renderTemplate('{TITLE}!', { title: 'Hi' }), 'Hi!');
  const long = renderTemplate('{title}', { title: 'x'.repeat(50) }, { limit: 10 });
  assert.equal(long.length, 10);
});
