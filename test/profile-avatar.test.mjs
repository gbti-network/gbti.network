// SOW-129: the avatar host allowlist shared by the profile editor + the content validator. A profile avatar may
// only come from a GitHub avatar or a Gravatar (https), never an arbitrary external image host. Pure, DOM-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSanctionedAvatar, githubAvatarUrl } from '../client-ui/src/profile-fields.mjs';

test('isSanctionedAvatar allows empty (the GitHub default)', () => {
  assert.equal(isSanctionedAvatar(''), true);
  assert.equal(isSanctionedAvatar('   '), true);
  assert.equal(isSanctionedAvatar(null), true);
  assert.equal(isSanctionedAvatar(undefined), true);
});

test('isSanctionedAvatar allows GitHub avatar hosts', () => {
  assert.equal(isSanctionedAvatar('https://avatars.githubusercontent.com/u/2002207?v=4'), true);
  assert.equal(isSanctionedAvatar('https://github.com/atwellpub.png'), true);
  assert.equal(isSanctionedAvatar('https://github.com/atwellpub.png?size=128'), true);
});

test('isSanctionedAvatar allows Gravatar hosts', () => {
  assert.equal(isSanctionedAvatar('https://secure.gravatar.com/avatar/abc123?s=512&d=identicon'), true);
  assert.equal(isSanctionedAvatar('https://www.gravatar.com/avatar/abc123'), true);
  assert.equal(isSanctionedAvatar('https://gravatar.com/avatar/abc123'), true);
});

test('isSanctionedAvatar rejects any other host', () => {
  assert.equal(isSanctionedAvatar('https://example.com/me.png'), false);
  assert.equal(isSanctionedAvatar('https://i.imgur.com/abc.png'), false);
  assert.equal(isSanctionedAvatar('https://cdn.discordapp.com/avatars/1/2.png'), false);
  // A lookalike host must not slip through (endsWith anchoring).
  assert.equal(isSanctionedAvatar('https://evilgithub.com/x.png'), false);
  assert.equal(isSanctionedAvatar('https://gravatar.com.evil.com/x.png'), false);
});

test('isSanctionedAvatar requires https + a valid URL', () => {
  assert.equal(isSanctionedAvatar('http://github.com/atwellpub.png'), false);
  assert.equal(isSanctionedAvatar('github.com/atwellpub.png'), false);
  assert.equal(isSanctionedAvatar('not a url'), false);
  assert.equal(isSanctionedAvatar('javascript:alert(1)'), false);
});

test('githubAvatarUrl builds the default avatar for a login, empty without one', () => {
  assert.equal(githubAvatarUrl('atwellpub'), 'https://github.com/atwellpub.png?size=128');
  assert.equal(githubAvatarUrl(''), '');
  assert.equal(githubAvatarUrl(null), '');
});
