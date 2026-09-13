// sow-202: the OAuth helpers hand signup VERIFIED email addresses only. The address lands on the member's Stripe
// Customer, where the digest mails members and the digest join hashes it, so an unverified one would let an account
// point its mail and the join's answer at a mailbox it does not control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubFetchPrimaryEmail, discordFetchUser } from '../workers/signup/oauth.mjs';

const respond = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body) });

test('github: the primary verified address wins', async () => {
  const email = await githubFetchPrimaryEmail('t', respond([
    { email: 'other@example.com', primary: false, verified: true },
    { email: 'primary@example.com', primary: true, verified: true },
  ]));
  assert.equal(email, 'primary@example.com');
});

test('github: an unverified primary falls back to another VERIFIED address', async () => {
  const email = await githubFetchPrimaryEmail('t', respond([
    { email: 'primary@example.com', primary: true, verified: false },
    { email: 'checked@example.com', primary: false, verified: true },
  ]));
  assert.equal(email, 'checked@example.com');
});

test('github: with no verified address at all there is no email, never an unverified one', async () => {
  const email = await githubFetchPrimaryEmail('t', respond([
    { email: 'victim@example.com', primary: true, verified: false },
    { email: 'also-unverified@example.com', primary: false },
  ]));
  assert.equal(email, '');
});

test('github: a failed or malformed response is no email', async () => {
  assert.equal(await githubFetchPrimaryEmail('t', respond([], false)), '');
  assert.equal(await githubFetchPrimaryEmail('t', respond({ not: 'a list' })), '');
});

test('discord: a verified address is returned', async () => {
  const u = await discordFetchUser('t', respond({ id: '123', email: 'me@example.com', verified: true }));
  assert.equal(u.discordUserId, '123');
  assert.equal(u.email, 'me@example.com');
});

test('discord: an unverified or unflagged address reads as no email', async () => {
  for (const verified of [false, undefined, 'true']) {
    const u = await discordFetchUser('t', respond({ id: '123', email: 'victim@example.com', verified }));
    assert.equal(u.email, '', String(verified));
    assert.equal(u.discordUserId, '123', 'the link itself still works');
  }
});
