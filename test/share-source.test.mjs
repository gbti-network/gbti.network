// sow-222: the source card points at the creator, not at the domain. The derivation table for the eight
// platforms that carry the creator in the path, the two that do not (YouTube and Vimeo, read from what the
// share stored at publish time), and the card model both renderers share. Pure, no network, no secrets.
//
// SIX OF THE NINE PLATFORMS HAVE NO LIVE SHARE TO CHECK AGAINST (measured at origin: 34 YouTube, 1 x.com,
// 1 github.com, and nothing on Bluesky, Mastodon, Substack, Mixcloud, Dev.to or Medium), so this file is the
// only coverage they have until someone shares one. That is why every platform carries both a match and a
// refusal here rather than a single happy case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creatorFrom, sourceCardModel } from '../client/src/share-source.mjs';

const YT = { creatorUrl: 'https://www.youtube.com/@classicaloasis', creatorName: 'Classical Oasis' };

test('sow-222: the eight derivable platforms resolve from the shared url alone', () => {
  const cases = [
    ['https://x.com/hudsonatwell/status/1234567890', 'https://x.com/hudsonatwell', 'Follow', 'X'],
    ['https://twitter.com/hudsonatwell/status/1234567890', 'https://x.com/hudsonatwell', 'Follow', 'X'],
    ['https://bsky.app/profile/pfrazee.com/post/3kabc', 'https://bsky.app/profile/pfrazee.com', 'Follow', 'Bluesky'],
    ['https://mastodon.social/@Gargron/109876543210987654', 'https://mastodon.social/@Gargron', 'Follow', 'Mastodon'],
    ['https://platformer.substack.com/p/the-thing', 'https://platformer.substack.com/', 'Subscribe', 'Substack'],
    ['https://open.substack.com/pub/platformer/p/the-thing', 'https://platformer.substack.com/', 'Subscribe', 'Substack'],
    ['https://www.mixcloud.com/lane8/summer-2026-mixtape/', 'https://www.mixcloud.com/lane8/', 'Follow', 'Mixcloud'],
    ['https://github.com/gbti-network/gbti.network/pull/534', 'https://github.com/gbti-network', 'Follow', 'GitHub'],
    ['https://dev.to/ben/how-to-thing-1a2b', 'https://dev.to/ben', 'Follow', 'DEV'],
    ['https://medium.com/@kentcdodds/why-4321', 'https://medium.com/@kentcdodds', 'Follow', 'Medium'],
    ['https://blog.medium.com/a-post', 'https://blog.medium.com/', 'Follow', 'Medium'],
  ];
  for (const [url, creator, verb, label] of cases) {
    const got = creatorFrom(url);
    assert.ok(got, `expected a creator for ${url}`);
    assert.equal(got.url, creator, url);
    assert.equal(got.verb, verb, url);
    assert.equal(got.label, label, url);
  }
});

test('sow-222: a page that is not a person resolves to nothing, and the card stays as it is', () => {
  const refusals = [
    'https://kotaku.com/some-article',                 // an ordinary site
    'https://x.com/i/status/123',                      // X internal, not a handle
    'https://x.com/hudsonatwell',                      // a profile is not a shared post
    'https://github.com/features/copilot',             // a product page, not an owner
    'https://github.com/gbti-network',                 // an owner page is not a shared item
    'https://open.substack.com/inbox',                 // the reader app with no publication in it
    'https://bsky.app/search?q=x',                     // not a post
    'https://dev.to/ben',                              // a profile, not an article
    'https://medium.com/tag/javascript',               // a tag page
    'https://example.com/@notmastodon/some-slug',      // the loose /@name/ shape a wider rule would claim
    'https://example.com/@user/123/extra',             // deeper than a status url
    'javascript:alert(1)//@x/123',                     // never a link
    'ftp://example.com/@user/123',
    '',
    null,
  ];
  for (const url of refusals) assert.equal(creatorFrom(url), null, `expected no creator for ${JSON.stringify(url)}`);
});

test('sow-222: YouTube and Vimeo read the channel the share stored, and refuse anything else', () => {
  const yt = creatorFrom('https://www.youtube.com/watch?v=sXvmcWWBsFM', YT);
  assert.deepEqual([yt.url, yt.name, yt.verb, yt.label], ['https://www.youtube.com/@classicaloasis', 'Classical Oasis', 'Subscribe', 'YouTube']);
  assert.ok(creatorFrom('https://youtu.be/sXvmcWWBsFM', YT), 'the short form reads the same stored channel');
  assert.equal(creatorFrom('https://www.youtube.com/watch?v=x'), null, 'nothing stored: the card is unchanged');
  // A stored value is member-reachable through a pull request, so it is only trusted on the platform's host.
  assert.equal(creatorFrom('https://www.youtube.com/watch?v=x', { creatorUrl: 'https://evil.example.com/@a' }), null);
  assert.equal(creatorFrom('https://www.youtube.com/watch?v=x', { creatorUrl: 'javascript:alert(1)' }), null);
  assert.equal(creatorFrom('https://www.youtube.com/watch?v=x', { creatorUrl: 'http://www.youtube.com/@a' }), null, 'https only');
  const vimeo = creatorFrom('https://vimeo.com/123456789', { creatorUrl: 'https://vimeo.com/lane8', creatorName: 'Lane 8' });
  assert.deepEqual([vimeo.url, vimeo.verb], ['https://vimeo.com/lane8', 'Follow']);
});

test('sow-222: a creator with no name recorded is still named, from the handle in the url', () => {
  assert.equal(creatorFrom('https://x.com/hudsonatwell/status/1').name, '@hudsonatwell');
  assert.equal(creatorFrom('https://github.com/gbti-network/x/pull/1').name, 'gbti-network');
  assert.equal(creatorFrom('https://mastodon.social/@Gargron/109876543210987654').name, '@Gargron');
  // A recorded name wins over the handle.
  assert.equal(creatorFrom('https://www.youtube.com/watch?v=x', YT).name, 'Classical Oasis');
});

test('sow-222: the card model replaces Visit only when a creator resolved', () => {
  const resolved = sourceCardModel({ url: 'https://www.youtube.com/watch?v=x', memberName: 'Hudson Atwell', ...YT });
  assert.equal(resolved.name, 'Classical Oasis');
  assert.equal(resolved.credit, 'On YouTube, shared by Hudson Atwell.');
  assert.deepEqual(resolved.action, {
    href: 'https://www.youtube.com/@classicaloasis',
    text: 'Subscribe',
    title: 'Open Classical Oasis on YouTube',
  });
  assert.equal(/subscribes? you|one click/i.test(JSON.stringify(resolved)), false, 'no copy claims the click subscribes');

  const plain = sourceCardModel({ url: 'https://kotaku.com/a-story', memberName: 'Hudson Atwell' });
  assert.equal(plain.name, 'kotaku.com');
  assert.equal(plain.credit, 'The source Hudson Atwell shared this from.');
  assert.deepEqual(plain.action, { href: 'https://kotaku.com/a-story', text: 'Visit', title: 'Open kotaku.com' });
  assert.equal(plain.creator, null);

  assert.equal(sourceCardModel({ url: '', memberName: 'x' }), null, 'no link, no card');
  assert.equal(sourceCardModel({ url: 'javascript:alert(1)' }), null);
});

test('sow-222: every url the model hands a renderer is https or http, never anything executable', () => {
  const inputs = [
    { url: 'https://www.youtube.com/watch?v=x', creatorUrl: 'javascript:alert(1)' },
    { url: 'https://www.youtube.com/watch?v=x', creatorUrl: 'data:text/html,<script>' },
    { url: 'https://www.youtube.com/watch?v=x', creatorUrl: '//evil.example.com' },
    { url: 'https://x.com/a/status/1' },
    { url: 'https://mastodon.social/@a/1' },
  ];
  for (const i of inputs) {
    const m = sourceCardModel({ ...i, memberName: 'A' });
    assert.ok(m, JSON.stringify(i));
    assert.match(m.action.href, /^https?:\/\//, JSON.stringify(i));
  }
});
