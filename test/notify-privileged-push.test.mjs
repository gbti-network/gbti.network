// sow-298: the governance-push audit alert.
//
// The failure this file mostly guards against is NOISE, not a miss. An alert that fires on every push is read
// as noise within a day and then the real one is invisible too, which is worse than having no alert at all
// because it looks like coverage. So the negative cases here carry as much weight as the positive ones.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGovernancePath,
  governancePathsIn,
  parseChangedFiles,
  buildPrivilegedPushMessage,
  notifyPrivilegedPush,
  GITHUB_EVENTS_CHANNEL_ID,
} from '../scripts/notify-privileged-push.mjs';
import { rankForPath, ROLE_RANK } from '../membership/path-rank.mjs';
import { ROLE } from '../membership/overrides-core.mjs';

const ENV = {
  DISCORD_BOT_TOKEN: 'test-token',
  GITHUB_REPOSITORY: 'gbti-network/gbti.network',
  GITHUB_ACTOR: 'gbtilabs',
  GITHUB_SHA: 'abcdef1234567890',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REF_NAME: 'main',
};

function spyClient(calls, { throws = false } = {}) {
  return ({ botToken }) => ({
    async postChannelMessage(channelId, content) {
      calls.push({ botToken, channelId, content });
      if (throws) throw new Error('discord 403');
      return { id: 'm1' };
    },
  });
}

test('the explicitly pinned governance paths are recognised', () => {
  for (const p of [
    'house/roles.yml',
    'house/content-channels.yml',
    'house/moderation-flags.yml',
    'house/site-settings.yml',
    'house/syndication-config.yml',
    'house/applets/hue/index.md',
    'CODEOWNERS',
    '.github/workflows/tests.yml',
  ]) {
    assert.equal(isGovernancePath(p), true, `${p} is CODEOWNERS-pinned and must alert`);
  }
});

test('ORDINARY PUSHES MUST NOT ALERT, which is the design decision this whole file protects', () => {
  for (const p of [
    'src/pages/index.astro',
    'scripts/reconcile.mjs',
    'workers/signup/index.mjs',
    'membership/classify-pr.mjs',
    'package.json',
    'astro.config.mjs',
    'members/alice/posts/x/index.md',
    'house/taxonomy.yml',
    'house/quotes.yml',
    'house/news-sources.yml',
    '',
  ]) {
    assert.equal(isGovernancePath(p), false, `${p} must NOT alert: alerting on it would make the channel noise`);
  }
});

test('DELIBERATELY DIVERGES FROM rankForPath, and this test exists so nobody "fixes" it', () => {
  // rankForPath fails CLOSED: anything outside members/ and house/ ranks superadmin. That is right for a
  // merge gate and wrong for an alert. If someone later simplifies isGovernancePath to
  // `rankForPath(p) === superadmin`, this test reds and tells them why.
  const SUPERADMIN = ROLE_RANK[ROLE.superadmin];
  for (const p of ['src/pages/index.astro', 'scripts/reconcile.mjs', 'package.json']) {
    assert.equal(rankForPath(p), SUPERADMIN, `precondition: rankForPath ranks ${p} superadmin`);
    assert.equal(isGovernancePath(p), false, `${p} ranks superadmin but is NOT governance for alerting`);
  }
  // And they agree where it matters: an explicitly pinned file is both.
  assert.equal(rankForPath('house/roles.yml'), SUPERADMIN);
  assert.equal(isGovernancePath('house/roles.yml'), true);
});

test('parseChangedFiles handles the space-separated CHANGED_FILES convention and newlines', () => {
  assert.deepEqual(parseChangedFiles('CODEOWNERS src/a.astro'), ['CODEOWNERS', 'src/a.astro']);
  assert.deepEqual(parseChangedFiles('CODEOWNERS\nsrc/a.astro\n'), ['CODEOWNERS', 'src/a.astro']);
  assert.deepEqual(parseChangedFiles(''), []);
  assert.deepEqual(parseChangedFiles(undefined), []);
});

test('governancePathsIn de-duplicates and keeps only the governance subset', () => {
  assert.deepEqual(
    governancePathsIn(['src/a.astro', 'CODEOWNERS', 'CODEOWNERS', 'house/roles.yml', 'members/a/p.md']),
    ['CODEOWNERS', 'house/roles.yml'],
  );
});

test('no message at all when the push touched nothing privileged', () => {
  assert.equal(buildPrivilegedPushMessage(ENV, ['src/a.astro', 'members/a/p.md']), null);
  assert.equal(buildPrivilegedPushMessage(ENV, []), null);
});

test('the message names the actor, the paths, and says plainly that nothing was blocked', () => {
  const msg = buildPrivilegedPushMessage(ENV, ['CODEOWNERS', 'src/a.astro']);
  assert.match(msg, /gbtilabs/);
  assert.match(msg, /CODEOWNERS/);
  assert.ok(!msg.includes('src/a.astro'), 'a non-governance path must not be listed');
  // Without this the reader cannot tell an audit notice from a control that refused something.
  assert.match(msg, /nothing was blocked/i);
  assert.match(msg, /commit\/abcdef1234567890/);
});

test('POSTS to #github-events when a governance path changed', async () => {
  const calls = [];
  const status = await notifyPrivilegedPush({ env: ENV, createClient: spyClient(calls), paths: ['house/roles.yml'] });
  assert.match(status, /^posted: 1 governance/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channelId, GITHUB_EVENTS_CHANNEL_ID);
  assert.match(calls[0].content, /house\/roles\.yml/);
});

test('SILENT on an ordinary push, and it does not even need a token to stay silent', async () => {
  const calls = [];
  let constructed = 0;
  const status = await notifyPrivilegedPush({
    env: { ...ENV, DISCORD_BOT_TOKEN: '' },
    createClient: (...a) => { constructed += 1; return spyClient(calls)(...a); },
    paths: ['src/a.astro', 'members/a/p.md'],
  });
  assert.match(status, /^skipped: no governance paths/);
  assert.equal(calls.length, 0);
  assert.equal(constructed, 0);
});

test('skips without a token even when a governance path DID change', async () => {
  const calls = [];
  const status = await notifyPrivilegedPush({
    env: { ...ENV, DISCORD_BOT_TOKEN: '' },
    createClient: spyClient(calls),
    paths: ['CODEOWNERS'],
  });
  assert.match(status, /^skipped: DISCORD_BOT_TOKEN/);
  assert.equal(calls.length, 0);
});

test('NEVER rejects when Discord errors, because the push already succeeded', async () => {
  const status = await notifyPrivilegedPush({
    env: ENV,
    createClient: spyClient([], { throws: true }),
    paths: ['CODEOWNERS'],
  });
  assert.match(status, /^skipped: discord 403/);
});
