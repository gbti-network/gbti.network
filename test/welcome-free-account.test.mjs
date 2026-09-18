// sow-357: the welcome for an account that is not paying.
//
// Since the trial was retired (August), a new account is a FREE account, and the wizard still walked everyone
// through five steps built for a paying member: Discord, which it may not join (sow-356), and the handles step,
// which ends in a published profile it cannot publish. It then congratulated it for work it had not done and
// offered a button landing on a page reading "Your access is locked".
//
// Owner, 2026-09-17: the welcome sets up the FREE perks, and makes the membership case ONCE, at the end.
// Following, favorites and collections stay free (verified at the Worker before the decision was taken).
//
// What these pin, in the order a free account meets it: which steps it is offered, that the wizard and the
// WorkBench card agree on that list, what the finish card may claim, and that no copy sells a retired trial.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { onboardingStepsFor, onboardingProgress, ONBOARDING_STEPS, ONBOARDING_STEP_KEYS } from '../membership/onboarding.mjs';
import { GbtiWelcome } from '../client-ui/src/elements/gbti-welcome.mjs';

const KEYS = (steps) => steps.map((s) => s.key);
const PAID = ['discord', 'subreddit', 'socials', 'follow', 'topics'];
const FREE = ['subreddit', 'follow', 'topics'];

// A receiver for the wizard's own methods: load() derives the step list as soon as the membership is read, so a
// prototype-level caller has to do the same.
const wizard = (membership, over = {}) => {
  const el = Object.assign(Object.create(GbtiWelcome.prototype), { _membership: membership, _step: 0, _done: false }, over);
  el._deriveSteps();
  return el;
};

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

test('sow-357: the offered steps follow the two things that actually gate them', () => {
  // Two independent flags, because the two steps are gated differently: the community is paid OR trialing, and
  // publishing is paid only. A trial member therefore keeps Discord and loses the handles step.
  assert.deepEqual(KEYS(onboardingStepsFor({ discordAvailable: true, canPublish: true })), PAID);
  assert.deepEqual(KEYS(onboardingStepsFor({ discordAvailable: true, canPublish: false })), ['discord', 'subreddit', 'follow', 'topics']);
  assert.deepEqual(KEYS(onboardingStepsFor({ discordAvailable: false, canPublish: true })), ['subreddit', 'socials', 'follow', 'topics']);
  assert.deepEqual(KEYS(onboardingStepsFor({ discordAvailable: false, canPublish: false })), FREE);
  // Defaulting to the full list is what makes an unread membership safe: it offers a step too many, never one
  // too few, and losing a step a paying member has to do is the direction that costs them work.
  assert.deepEqual(KEYS(onboardingStepsFor()), PAID);
  assert.deepEqual(KEYS(onboardingStepsFor({})), PAID);
});

test('sow-357: a free account opens on the channels step, and every list keeps one order', () => {
  // Owner, 2026-09-18: the channels step comes first for a free registration. That is where the shared order
  // already puts it once the two paid steps are gone, so no list carries an order of its own.
  assert.deepEqual(KEYS(onboardingStepsFor({ discordAvailable: false, canPublish: false })), ['subreddit', 'follow', 'topics']);
  for (const flags of [{}, { canPublish: false }, { discordAvailable: false }, { discordAvailable: false, canPublish: false }]) {
    const keys = KEYS(onboardingStepsFor(flags));
    const positions = keys.map((k) => ONBOARDING_STEP_KEYS.indexOf(k));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), `${JSON.stringify(flags)} keeps the shared order`);
  }
});

test('sow-357: every offered step is a real step, whatever the list', () => {
  // The keys are STORED (a skip records one), so a derived list must never invent or rename one.
  for (const flags of [{}, { canPublish: false }, { discordAvailable: false }, { discordAvailable: false, canPublish: false }]) {
    for (const s of onboardingStepsFor(flags)) {
      assert.ok(ONBOARDING_STEP_KEYS.includes(s.key), `${s.key} is a known step`);
      assert.equal(s, ONBOARDING_STEPS.find((x) => x.key === s.key), 'and it is the same frozen object, not a copy');
    }
  }
});

test('sow-357: the wizard walks the list this account is offered', () => {
  for (const [m, keys] of [['paid', PAID], ['trialing', ['discord', 'subreddit', 'follow', 'topics']], ['none', FREE], ['expired', FREE], ['banned', FREE], ['unknown', PAID]]) {
    assert.deepEqual(KEYS(wizard(m)._steps), keys, `the wizard's list for ${m}`);
  }
  // Before the membership is read at all, the full list stands in: the wizard renders before load() resolves.
  const fresh = Object.create(GbtiWelcome.prototype);
  assert.deepEqual(KEYS(fresh._steps), PAID, 'the fallback is the full list, not an empty one');
});

test('sow-357: the wizard and the WorkBench card offer the same steps', () => {
  // They disagreed before: the card listed five while the wizard walked three, so a free account could tick
  // everything the wizard offered and still read "2 of 5 done" on the card, for ever.
  const state = { discordLinked: false, follows: [], topics: [], profileSocials: false, record: null };
  for (const [m, flags] of [['paid', {}], ['trialing', { canPublish: false }], ['none', { discordAvailable: false, canPublish: false }]]) {
    const card = onboardingProgress({ ...state, ...flags }).steps.map((s) => s.key);
    assert.deepEqual(card, KEYS(wizard(m)._steps), `${m}: the card and the wizard list the same steps`);
  }
});

test('sow-357: a read that only feeds a step this account was not offered cannot blank the card', () => {
  // The card says nothing when anything it needs could not be read, because a false to-do list tells a member to
  // redo finished work. What it NEEDS now depends on the steps offered: a free account's card does not list
  // Discord or the handles, so a failed Discord or profile read must not silence it. Caught by a surviving
  // mutant: demanding both regardless left a free account with no card whenever either read failed.
  const free = { discordAvailable: false, canPublish: false, follows: [], topics: [], record: null };
  assert.equal(onboardingProgress({ ...free, discordLinked: null, profileSocials: null }).known, true);
  assert.equal(onboardingProgress({ ...free, discordLinked: null, profileSocials: null, follows: null }).known, false,
    'but a read it does need still silences it');
  // For a paying member both are load-bearing again, because both steps are on their list.
  const paid = { discordAvailable: true, canPublish: true, follows: [], topics: [], record: null };
  assert.equal(onboardingProgress({ ...paid, discordLinked: null, profileSocials: false }).known, false);
  assert.equal(onboardingProgress({ ...paid, discordLinked: false, profileSocials: null }).known, false);
  assert.equal(onboardingProgress({ ...paid, discordLinked: false, profileSocials: false }).known, true);
});

test('sow-357: Skip is offered on neither the first step nor the last, whatever the length', () => {
  const skips = (m) => wizard(m)._steps.map((_, i) => GbtiWelcome.prototype._showSkip.call(wizard(m, { _step: i })));
  assert.deepEqual(skips('paid'), [false, true, true, true, false], 'five steps: the old fixed rule, unchanged');
  assert.deepEqual(skips('none'), [false, true, false], 'three steps: still never the first nor the last');
  assert.equal(GbtiWelcome.prototype._showSkip.call(wizard('none', { _step: 1, _done: true })), false, 'and never on the finish');
});

// ---------------------------------------------------------------------------
// What each step counts as done
// ---------------------------------------------------------------------------

test('sow-357: the handles step counts done when it is SAVED, the same rule the card uses', () => {
  // The wizard used to tick as soon as a handle was typed, while the card waited for a published profile. The
  // wizard was the wrong one: the handles are only kept until a paid publish carries them (welcome-socials.mjs).
  const done = (over) => GbtiWelcome.prototype._stepDone.call(wizard('paid', over)).socials;
  assert.equal(done({ _socialDraft: { x: '@alice' } }), false, 'typed is not saved');
  assert.equal(done({ _record: { socialsSaved: true } }), true, 'the save succeeded');
  assert.equal(done({ _profile: { frontmatter: { links: { x: 'https://x.com/alice' } } } }), true, 'or the profile carries one');
  assert.equal(done({ _profile: { frontmatter: { links: {} } }, _record: { socialsSaved: false } }), false);
  assert.equal(done({}), false, 'and an unread profile is not a tick');
});

test('sow-357: the rail ticks in THIS account\'s order', () => {
  // A positional array against the wrong list puts the ticks on the wrong rows, which is the whole reason the
  // done state is keyed and the array derived from the offered list.
  const free = wizard('none', { _follows: new Set(['bob']), _topicsCount: 0, _chanFollowed: new Set(['reddit']) });
  assert.deepEqual(GbtiWelcome.prototype._doneFlags.call(free), [true, true, false], 'channels done, members done, topics not');
  const paid = wizard('paid', { _follows: new Set(['bob']), _topicsCount: 0, _chanFollowed: new Set(['reddit']) });
  assert.deepEqual(GbtiWelcome.prototype._doneFlags.call(paid), [false, true, false, true, false]);
});

// ---------------------------------------------------------------------------
// The finish card
// ---------------------------------------------------------------------------

const finish = (m, over = {}) => GbtiWelcome.prototype._doneCard.call(wizard(m, { _follows: new Set(['a', 'b']), _topicsCount: 3, ...over }));

test('sow-357: the finish card claims only what a free account actually did', () => {
  const html = finish('none');
  for (const lie of ['handles are saved', 'Time to publish', 'Go to your profile']) {
    assert.ok(!html.includes(lie), `a free account is not told "${lie}"`);
  }
  assert.match(html, /Your feed is yours now/);
  assert.match(html, /<b>2<\/b><span>Following<\/span>/, 'and the counts are the real ones');
  assert.match(html, /<b>3<\/b><span>Topics<\/span>/);
});

test('sow-357: it sends a free account to the feed it just built, not to a locked page', () => {
  // "Go to your profile" routed to the account hub on the site and to the WorkBench in the extension, which for a
  // free account renders "Your access is locked". The finish now links somewhere it can actually use.
  const html = finish('none');
  assert.match(html, /<a class="pbtn" href="https:\/\/gbti\.network\/" target="_blank" rel="noopener">Go to my feed<\/a>/);
  assert.match(html, /new tab shows the same feed/);
});

test('sow-357: the membership case is made once, at the end, and names what it adds', () => {
  const html = finish('none');
  assert.match(html, /class="offer"/);
  assert.match(html, /Network Supporter membership/, 'the plan by the name the plans page uses');
  for (const adds of ['comments', 'Discord community', 'publishing', 'share of what the network earns']) {
    assert.ok(html.includes(adds), `the offer names ${adds}`);
  }
  assert.match(html, /href="https:\/\/gbti\.network\/membership\/"/);
});

test('sow-357: the finish footer does not send a free account somewhere it cannot go', () => {
  // "Go to your profile" fires gbti:welcome-done, which the site routes to the account hub and the extension to
  // the WorkBench, where a free account meets "Your access is locked". Its ending is the feed link in the card.
  // Caught by driving the finish: the card was right and the footer under it still carried the old button.
  const src = fs.readFileSync(new URL('../client-ui/src/elements/gbti-welcome.mjs', import.meta.url), 'utf8');
  assert.match(src, /\$\{canPublish\(this\._membership\) \? `<button class="pbtn" data-done type="button">Go to your profile<\/button>` : ''\}/);
  assert.match(src, /<button class="gbtn" data-review type="button">Review steps<\/button>/, 'the way back to the steps stays for everyone');
});

test('sow-357: a paying member\'s finish card is untouched', () => {
  const html = finish('paid');
  assert.match(html, /Welcome to the co-op\. Your channels are followed, your handles are saved, and your feed is tuned\. Time to publish\./);
  assert.ok(!html.includes('class="offer"'), 'no upgrade offer for someone who already pays');
  assert.ok(!html.includes('Go to my feed'), 'their primary stays the host-routed button');
  // A lapsed member gets the free version, because what they can do is what a free account can do.
  assert.ok(finish('expired').includes('class="offer"'));
  assert.ok(finish('unknown').includes('class="offer"'), 'and so does an unread membership, which cannot publish');
});

// ---------------------------------------------------------------------------
// Copy that was false
// ---------------------------------------------------------------------------

test('sow-357: nothing in the wizard still sells the retired trial', () => {
  // The 90-day trial was retired in August. The extension's signed-out splash went on offering it for a month.
  const src = fs.readFileSync(new URL('../client-ui/src/elements/gbti-welcome.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes('The trial is free'), 'the splash no longer promises a free trial');
  assert.match(src, /Reading is free, and an account costs nothing/);
});
