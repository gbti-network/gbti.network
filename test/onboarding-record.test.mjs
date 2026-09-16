// sow-343 Phase 1: onboarding progress is recorded per member, on the existing prefs record.
//
// The owner asked for progress to be recorded and for members to be reminded until they finish. Two things make
// that safe, and both are pinned here. Real account state always beats the record, so a member who did the work
// somewhere else is never told to do it again. And a read that failed is reported as unknown, never as "not
// done", because a reminder built on a failed read tells a member to redo finished work.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ONBOARDING_STEPS, ONBOARDING_STEP_KEYS, onboardingProgress, normalizeOnboarding, profileHasSocials, MAX_NETWORK_FOLLOWS } from '../membership/onboarding.mjs';
import { normalizePrefs, applyPrefs, PrefsError } from '../membership/member-prefs.mjs';
import { handlePrefs } from '../workers/signup/membership-prefs.mjs';
import { setPrefs } from '../client/src/operations-member.mjs';

const ALL_KNOWN = { discordLinked: false, follows: 0, topics: 0, profileSocials: false, record: null };
const stateOf = (p) => Object.fromEntries(p.steps.map((s) => [s.key, s.state]));

// ---- the view ----

test('the five welcome steps, in order, with stable stored keys', () => {
  assert.deepEqual(ONBOARDING_STEP_KEYS, ['discord', 'subreddit', 'socials', 'follow', 'topics']);
  for (const s of ONBOARDING_STEPS) for (const f of ['label', 'sub', 'heading', 'title']) assert.ok(s[f], `${s.key} has a ${f}`);
});

test('a member who did everything elsewhere reads as done, having never opened the wizard', () => {
  const p = onboardingProgress({ discordLinked: true, follows: 3, topics: ['ai'], profileSocials: true, record: { networkFollows: ['reddit'] } });
  assert.equal(p.known, true);
  assert.equal(p.complete, true);
  assert.equal(p.outstanding, 0);
});

test('a brand-new member has five steps to do, and that is known, not a failed read', () => {
  const p = onboardingProgress(ALL_KNOWN);
  assert.equal(p.known, true);
  assert.equal(p.complete, false);
  assert.equal(p.outstanding, 5);
  assert.deepEqual(Object.values(stateOf(p)), ['todo', 'todo', 'todo', 'todo', 'todo']);
});

test('a skip is remembered, and real state beats a stale skip', () => {
  const skipped = onboardingProgress({ ...ALL_KNOWN, record: { skipped: ['discord', 'topics'] } });
  assert.equal(stateOf(skipped).discord, 'skipped');
  assert.equal(stateOf(skipped).topics, 'skipped');
  assert.equal(stateOf(skipped).follow, 'todo');
  // The owner ruled that a skipped step still counts as outstanding: the reminder stays until the work is done.
  assert.equal(skipped.complete, false);
  assert.equal(skipped.outstanding, 5);

  // The case that decides it: everything done except one step the member chose to skip. Still not complete.
  const onlySkipLeft = onboardingProgress({ discordLinked: false, follows: 2, topics: 3, profileSocials: true, record: { skipped: ['discord'], networkFollows: ['x'] } });
  assert.deepEqual(Object.values(stateOf(onlySkipLeft)), ['skipped', 'done', 'done', 'done', 'done']);
  assert.equal(onlySkipLeft.complete, false, 'a skip must not end the reminder');
  assert.equal(onlySkipLeft.outstanding, 1);

  const later = onboardingProgress({ ...ALL_KNOWN, discordLinked: true, topics: 2, record: { skipped: ['discord', 'topics'] } });
  assert.equal(stateOf(later).discord, 'done');
  assert.equal(stateOf(later).topics, 'done');
});

test('the channel step and the socials step read the record, because no server can tell us', () => {
  const p = onboardingProgress({ ...ALL_KNOWN, record: { networkFollows: ['x'], socialsSaved: true } });
  assert.equal(stateOf(p).subreddit, 'done');
  assert.equal(stateOf(p).socials, 'done', 'a save that has not gone live yet still counts');
  const kept = onboardingProgress({ ...ALL_KNOWN, record: { socials: { x: '@me' } } });
  assert.equal(stateOf(kept).socials, 'todo', 'handles kept for later are not on the profile yet');
});

test('any failed read makes the whole view unknown, never a false to-do list', () => {
  for (const [field, value] of [['discordLinked', null], ['follows', null], ['topics', null], ['profileSocials', null], ['record', undefined]]) {
    const p = onboardingProgress({ ...ALL_KNOWN, [field]: value });
    assert.equal(p.known, false, `${field} unread should make the view unknown`);
  }
  assert.equal(onboardingProgress().known, false, 'no input at all is unknown');
});

test('profileHasSocials counts a non-empty handle, optionally within the offered keys', () => {
  assert.equal(profileHasSocials({ github: 'https://github.com/a' }), true);
  assert.equal(profileHasSocials({ github: '  ' }), false);
  assert.equal(profileHasSocials(null), false);
  assert.equal(profileHasSocials({ mastodon: 'x' }, ['github', 'x']), false);
});

// ---- the stored block ----

test('an untouched record keeps its exact shape: the block appears only once something is stored', () => {
  assert.deepEqual(normalizePrefs(null), { categories: [], followedChannels: [], followedTags: [], publicFavorites: false });
  assert.ok(!('onboarding' in normalizePrefs({ onboarding: { skipped: [] } })), 'an empty block is dropped');
  assert.ok(!('onboarding' in applyPrefs({}, { categories: ['ai'] })), 'an unrelated patch adds nothing');
});

test('a stored block is cleaned on the way out: unknown steps, junk keys and bad handles are dropped', () => {
  const ob = normalizeOnboarding({
    skipped: ['discord', 'discord', 'nonsense', 7],
    networkFollows: ['reddit', 'Reddit', 'x', '<script>'],
    socials: { x: ' @me ', bad_key: 'y', website: '', linkedin: 'a\u0000b', youtube: 5 },
    socialsSaved: 'yes',
  });
  assert.deepEqual(ob, { skipped: ['discord'], networkFollows: ['reddit', 'x'], socials: { x: '@me' }, socialsSaved: false });
});

test('skipping: only a known step, and it can be undone', () => {
  let p = applyPrefs({}, { onboardingSkip: { step: 'socials' } });
  assert.deepEqual(p.onboarding.skipped, ['socials']);
  p = applyPrefs(p, { onboardingSkip: { step: 'socials' } });
  assert.deepEqual(p.onboarding.skipped, ['socials'], 'a second skip is a no-op');
  p = applyPrefs(p, { onboardingSkip: { step: 'socials', on: false } });
  assert.ok(!('onboarding' in p), 'undoing the only skip empties the block, which then goes');
  for (const step of ['nonsense', '', null, undefined]) {
    assert.throws(() => applyPrefs({}, { onboardingSkip: { step } }), PrefsError, `step ${step}`);
  }
});

test('channel follows only add, and are capped with a message rather than silently dropped', () => {
  let p = applyPrefs({}, { onboardingFollows: ['reddit'] });
  p = applyPrefs(p, { onboardingFollows: ['x', 'reddit'] });
  assert.deepEqual(p.onboarding.networkFollows, ['reddit', 'x']);
  p = applyPrefs(p, { onboardingFollows: [] });
  assert.deepEqual(p.onboarding.networkFollows, ['reddit', 'x'], 'an empty list removes nothing');
  assert.throws(() => applyPrefs({}, { onboardingFollows: 'reddit' }), PrefsError);
  assert.throws(() => applyPrefs({}, { onboardingFollows: ['Not A Key'] }), PrefsError);
  const many = Array.from({ length: MAX_NETWORK_FOLLOWS + 1 }, (_, i) => `c${i}`);
  assert.throws(() => applyPrefs({}, { onboardingFollows: many }), /the limit is/);
});

test('kept handles are replaced or cleared, and a save that landed clears them', () => {
  let p = applyPrefs({}, { onboardingSocials: { x: '@me', website: 'https://me.dev' } });
  assert.deepEqual(p.onboarding.socials, { x: '@me', website: 'https://me.dev' });
  p = applyPrefs(p, { onboardingSocials: { bluesky: '@me.bsky' } });
  assert.deepEqual(p.onboarding.socials, { bluesky: '@me.bsky' }, 'a write replaces the set');
  p = applyPrefs(p, { onboardingSocialsSaved: true });
  assert.equal(p.onboarding.socialsSaved, true);
  assert.deepEqual(p.onboarding.socials, {}, 'the handles went to the profile, so the kept copy goes');
  assert.throws(() => applyPrefs({}, { onboardingSocials: ['x'] }), PrefsError);
  assert.throws(() => applyPrefs({}, { onboardingSocials: { x: 'a'.repeat(201) } }), /too long/);
  assert.throws(() => applyPrefs({}, { onboardingSocialsSaved: 'true' }), PrefsError);
  const cleared = applyPrefs({ onboarding: { socials: { x: '@me' } } }, { onboardingSocials: null });
  assert.ok(!('onboarding' in cleared));
});

test('the reset clears everything, and nothing else can replace the block wholesale', () => {
  const stored = { categories: ['ai'], onboarding: { skipped: ['discord'], networkFollows: ['x'], socials: { x: '@me' } } };
  const p = applyPrefs(stored, { onboarding: null });
  assert.ok(!('onboarding' in p));
  assert.deepEqual(p.categories, ['ai'], 'the reset leaves the rest of the record alone');
  assert.throws(() => applyPrefs({}, { onboarding: { skipped: ['discord'], socialsSaved: true } }), /only be cleared/);
});

// ---- the route and the forwarders ----

const fakeKV = () => {
  const store = new Map();
  return { store, async get(k, t) { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); } };
};
const member = () => ({ ok: true, githubId: '9' });
const REQ = (method, body) => new Request('https://x/membership/prefs', { method, ...(body ? { body: JSON.stringify(body) } : {}) });

test('the prefs route stores and returns the block, and refuses a bad patch without writing', async () => {
  const kv = fakeKV();
  const r = await handlePrefs(REQ('POST', { onboardingSkip: { step: 'follow' } }), {}, { kv, authorize: member });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(kv.store.get('prefs:9')).onboarding.skipped, ['follow']);
  const g = await handlePrefs(REQ('GET'), {}, { kv, authorize: member });
  assert.deepEqual(g.body.prefs.onboarding.skipped, ['follow']);

  const before = kv.store.get('prefs:9');
  const bad = await handlePrefs(REQ('POST', { onboardingSkip: { step: 'nonsense' } }), {}, { kv, authorize: member });
  assert.equal(bad.status, 400);
  assert.equal(kv.store.get('prefs:9'), before);
});

test('the extension and command line forward every onboarding patch, including the reset', async () => {
  const sent = [];
  const ctx = {
    identity: () => ({ username: 'alice', login: 'alice', githubId: '9' }),
    store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
    fetch: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ prefs: {} }) }; },
  };
  const patches = [
    { onboardingSkip: { step: 'discord', on: true } },
    { onboardingFollows: ['reddit'] },
    { onboardingSocials: { x: '@me' } },
    { onboardingSocials: null },
    { onboardingSocialsSaved: true },
    { onboarding: null },
  ];
  for (const p of patches) await setPrefs(ctx, p);
  assert.deepEqual(sent, patches, 'a field missing from the allowlist would be dropped on these two hosts only');
});
