// sow-298: the scheduled-workflow failure notifier.
//
// The failure this guards against is silence. A notifier that quietly does nothing looks exactly like a
// month with no failures, so the tests assert BOTH directions: it skips cleanly with no token, and it really
// posts when it has one. Asserting only the skip would pass on a notifier that was broken outright, which is
// the vacuous shape this repository keeps getting bitten by.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFailureMessage,
  notifyWorkflowFailure,
  GITHUB_EVENTS_CHANNEL_ID,
} from '../scripts/notify-workflow-failure.mjs';

const ENV = {
  DISCORD_BOT_TOKEN: 'test-token',
  GITHUB_WORKFLOW: 'Reconcile membership',
  GITHUB_REPOSITORY: 'gbti-network/gbti.network',
  GITHUB_RUN_ID: '123456789',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_SHA: 'abcdef1234567890',
  GITHUB_JOB: 'reconcile',
  GITHUB_EVENT_NAME: 'schedule',
};

/** A client that records the call instead of reaching Discord. */
function spyClient(calls, { throws = false } = {}) {
  return ({ botToken }) => ({
    async postChannelMessage(channelId, content, opts) {
      calls.push({ botToken, channelId, content, opts });
      if (throws) throw new Error('discord 403');
      return { id: 'msg-1' };
    },
  });
}

test('the message names the workflow, the run URL and that a schedule has nobody watching', () => {
  const msg = buildFailureMessage(ENV);
  assert.match(msg, /Reconcile membership/);
  assert.match(msg, /https:\/\/github\.com\/gbti-network\/gbti\.network\/actions\/runs\/123456789/);
  assert.match(msg, /abcdef12/, 'the short SHA should be present');
  assert.match(msg, /nobody is watching this one/, 'a scheduled trigger must say so: that is the whole point');
});

test('a push-triggered failure does NOT claim nobody is watching', () => {
  // The negative half. Without it, hardcoding the phrase would pass the test above.
  const msg = buildFailureMessage({ ...ENV, GITHUB_EVENT_NAME: 'push' });
  assert.ok(!msg.includes('nobody is watching'), 'a push failure has an author watching it');
  assert.match(msg, /Trigger: `push`/);
});

test('no workflow name in the environment yields no message rather than a useless one', () => {
  assert.equal(buildFailureMessage({}), null);
  assert.equal(buildFailureMessage({ GITHUB_WORKFLOW: '   ' }), null);
});

test('POSTS to #github-events when the bot token is set', async () => {
  const calls = [];
  const status = await notifyWorkflowFailure({ env: ENV, createClient: spyClient(calls) });
  assert.equal(status, 'posted');
  assert.equal(calls.length, 1, 'exactly one message');
  assert.equal(calls[0].channelId, GITHUB_EVENTS_CHANNEL_ID);
  assert.equal(calls[0].botToken, 'test-token');
  assert.match(calls[0].content, /Reconcile membership/);
});

test('SKIPS without posting when DISCORD_BOT_TOKEN is unset, and does not construct a client', async () => {
  const calls = [];
  let constructed = 0;
  const status = await notifyWorkflowFailure({
    env: { ...ENV, DISCORD_BOT_TOKEN: '' },
    createClient: (...a) => { constructed += 1; return spyClient(calls)(...a); },
  });
  assert.match(status, /^skipped: DISCORD_BOT_TOKEN/);
  assert.equal(calls.length, 0, 'nothing may be posted without a token');
  assert.equal(constructed, 0, 'the client must not even be constructed');
});

test('NEVER rejects when Discord errors, because the job is already red', async () => {
  // A throwing notifier would add a second failed step and bury the original failure under its stack trace.
  const calls = [];
  const status = await notifyWorkflowFailure({ env: ENV, createClient: spyClient(calls, { throws: true }) });
  assert.match(status, /^skipped: discord 403/);
});

test('the channel id is the one the owner named, so a typo cannot silently misroute the alarm', () => {
  assert.equal(GITHUB_EVENTS_CHANNEL_ID, '1544443628678815846');
});
