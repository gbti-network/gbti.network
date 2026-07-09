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

// SOW-088: the new default-format tokens. {content-type} renders the type label; {member-discord-username}
// prefers the resolved mention, then the public profile Discord handle, then the GitHub username.
test('renderTemplate: hyphenated tokens, {content-type}, and the {member-discord-username} fallback chain', () => {
  const T2 = 'New {content-type} published by {member-discord-username}: "{title}" {url}';
  const base = { source: 'prompt', title: 'CI Skill', url: 'https://x.dev/p' };
  // Mention wins.
  assert.equal(renderTemplate(T2, { ...base, mention: '<@42>', authorDiscord: 'huds', author: 'atwellpub' }),
    'New prompt published by <@42>: "CI Skill" https://x.dev/p');
  // Profile Discord handle next (sanitized: the @ gets the zero-width guard on social channels).
  const withHandle = renderTemplate(T2, { ...base, authorDiscord: 'hudsdiscord', author: 'atwellpub' });
  assert.match(withHandle, /published by @.?hudsdiscord:/);
  // GitHub username last, @-prefixed like the handle path (the sanitizer's zero-width guard may follow the @).
  const ghOnly = renderTemplate(T2, { ...base, author: 'atwellpub' });
  assert.match(ghOnly, /published by @.?atwellpub:/);
  // A profile discord INVITE URL is not a username: it falls through to the GitHub fallback (hit live).
  const urlHandle = renderTemplate(T2, { ...base, authorDiscord: 'https://discord.gg/EwmcKcJZC6', author: 'atwellpub' });
  assert.match(urlHandle, /published by @.?atwellpub:/);
  assert.ok(!urlHandle.includes('discord.gg'), 'an invite URL never renders as the username');
  // {content-type} labels per source.
  assert.match(renderTemplate('{content-type}', { source: 'post' }), /^article$/);
  assert.match(renderTemplate('{content-type}', { source: 'share' }), /^link$/);
});
