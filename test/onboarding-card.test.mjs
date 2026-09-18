// sow-343 Phase 3: the WorkBench card that keeps asking a member to finish setting up.
//
// Owner decisions this pins: the card stays while any step is outstanding, a skipped step included; it has no
// dismiss control; it links straight to the step. And the rule that makes a nag safe: when anything could not be
// read, the card says nothing rather than listing finished work as unfinished.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadOnboardingState, loadProgress, onboardingCardHtml, cachedProgress, rememberProgress, forgetProgress, CARD_TTL_MS, WELCOME_SITE_URL } from '../client-ui/src/onboarding-card-core.mjs';
import { onboardingProgress, ONBOARDING_STEPS } from '../membership/onboarding.mjs';
import { requestedStep } from '../client-ui/src/welcome-core.mjs';
import { setClient } from '../client-ui/src/base.mjs';
import { GbtiOnboardingProgress } from '../client-ui/src/elements/gbti-onboarding-progress.mjs';

const notFound = () => { const e = new Error('no such item'); e.code = 'not-found'; return e; };

/** A host client. Each read can be replaced; `calls` counts what was asked. */
function host(over = {}) {
  const calls = { status: 0, getContentItem: [] };
  const c = {
    calls,
    status: async () => { calls.status++; return { authenticated: true, identity: { login: 'alice', username: 'alice' } }; },
    getPrefs: async () => ({ categories: ['ai'], onboarding: { skipped: ['discord'] } }),
    getFollows: async () => ({ following: [{ username: 'bob' }] }),
    discordLinkStatus: async () => ({ linked: false }),
    listContent: async () => ({ items: [] }),
    getContentItem: async ({ path }) => { calls.getContentItem.push(path); throw notFound(); },
    ...over,
  };
  return c;
}

// ---- reading ----

test('the state is read from every host shape, and a missing profile reads as "no handles"', async () => {
  const website = host();
  const s = await loadOnboardingState(website);
  assert.equal(website.calls.status, 1, 'the identity is read once and passed to the profile read');
  assert.deepEqual(s, { discordAvailable: true, canPublish: true, discordLinked: false, follows: [{ username: 'bob' }], topics: ['ai'], profileSocials: false, record: { skipped: ['discord'] } });
  const ext = await loadOnboardingState(host({ getFollows: async () => [{ username: 'bob' }] }));
  assert.equal(ext.follows.length, 1, 'the extension returns a bare list');
});

test('sow-356/357: a step is listed only for an account that can actually finish it', async () => {
  // A step nobody can finish makes the card permanent and its count a lie. Discord is paid or trialing
  // (sow-356); the handles step ends in a published profile, which is paid only (sow-357). An UNREAD or unknown
  // membership keeps everything, because dropping a step on a failed read shows a paying member a short list.
  const withMembership = (m) => host({ status: async () => ({ authenticated: true, membership: m, identity: { login: 'alice', username: 'alice' } }) });
  const matrix = [
    ['paid', ['discord', 'subreddit', 'socials', 'follow', 'topics']],
    ['trialing', ['discord', 'subreddit', 'follow', 'topics']],
    ['unknown', ['discord', 'subreddit', 'socials', 'follow', 'topics']],
    ['none', ['subreddit', 'follow', 'topics']],
    ['expired', ['subreddit', 'follow', 'topics']],
    ['banned', ['subreddit', 'follow', 'topics']],
  ];
  for (const [m, keys] of matrix) {
    const s = await loadOnboardingState(withMembership(m));
    assert.deepEqual(onboardingProgress(s).steps.map((x) => x.key), keys, `the step list for ${m}`);
  }
  // And the count follows: the denominator is 3, not 5, so a free account's card can actually be finished. (This
  // fixture already follows a member and holds a topic, hence two done.)
  const free = onboardingProgress(await loadOnboardingState(withMembership('none')));
  assert.equal(free.known, true, 'a dropped step does not make the view unknown');
  assert.match(onboardingCardHtml(free), /2 of 3 done/);
  for (const gone of ['Connect Discord', 'Add your social handles']) {
    assert.ok(!onboardingCardHtml(free).includes(gone), `${gone} is not listed`);
  }
});

test('the profile is read by the member\'s own path when the host lists none, or by the listed path', async () => {
  const website = host();
  await loadOnboardingState(website);
  assert.deepEqual(website.calls.getContentItem, ['members/alice/profile.md']);

  const ext = host({ listContent: async () => ({ items: [{ path: 'members/alice/profile.md' }] }), getContentItem: async () => ({ frontmatter: { links: { x: '@alice' } } }) });
  assert.equal((await loadOnboardingState(ext)).profileSocials, true);
});

test('every failed read comes back as unknown, never as "not done"', async () => {
  const boom = async () => { throw new Error('network down'); };
  const cases = {
    discordLinked: host({ discordLinkStatus: boom }),
    follows: host({ getFollows: boom }),
    topics: host({ getPrefs: boom }),
    profileSocials: host({ getContentItem: boom }),
  };
  for (const [field, client] of Object.entries(cases)) {
    const s = await loadOnboardingState(client);
    assert.equal(s[field], null, `${field} should be unknown`);
    assert.equal((await loadProgress(client)).known, false, `${field} failing must hide the card`);
  }
  assert.equal((await loadOnboardingState(host({ getPrefs: boom }))).record, undefined, 'an unread record is not an empty one');
  assert.equal((await loadProgress(host({ discordLinkStatus: undefined }))).known, false, 'a host without the method is unknown too');
  assert.equal((await loadProgress(null)).known, false);
  assert.equal((await loadProgress(host({ status: boom }))).known, false, 'no identity means no profile path, so unknown');
});

test('a fully read member produces a known view', async () => {
  const p = await loadProgress(host());
  assert.equal(p.known, true);
  assert.deepEqual(p.steps.map((s) => s.state), ['skipped', 'todo', 'todo', 'done', 'done']);
});

// ---- the markup ----

const view = (over = {}) => onboardingProgress({ discordLinked: false, follows: 1, topics: 0, profileSocials: false, record: { skipped: ['socials'] }, ...over });

test('nothing is rendered when setup is done, or when the view is unknown', () => {
  assert.equal(onboardingCardHtml(view({ discordLinked: true, topics: 2, profileSocials: true, record: { networkFollows: ['x'] } })), '');
  assert.equal(onboardingCardHtml(view({ discordLinked: null })), '');
  assert.equal(onboardingCardHtml(null), '');
});

test('the card lists every step: done ones plain, the rest linked to that step', () => {
  const html = onboardingCardHtml(view());
  assert.match(html, /1 of 5 done/);
  assert.equal((html.match(/<li /g) || []).length, 5);
  assert.match(html, /<li class="st done" data-state="done"><span class="mk" aria-hidden="true">&#10003;<\/span><span>Follow other members<\/span><\/li>/);
  assert.match(html, /<a href="\/welcome\/\?step=discord">Connect Discord<\/a>/);
  assert.doesNotMatch(html, /step=follow/, 'a done step has no link');
});

test('a skipped step is still listed, marked, and linked (owner ruling: it keeps the card showing)', () => {
  const html = onboardingCardHtml(view());
  assert.match(html, /<li class="st skipped" data-state="skipped">[^]*?step=socials[^]*?<span class="tag">Skipped<\/span><\/li>/);
});

test('there is no way to dismiss it', () => {
  const html = onboardingCardHtml(view());
  assert.doesNotMatch(html, /<button|dismiss|close|hide|later/i);
});

test('in the extension, the links open the site\'s welcome page in a new tab', () => {
  const html = onboardingCardHtml(view(), { welcomeUrl: WELCOME_SITE_URL, external: true });
  assert.match(html, /href="https:\/\/gbti\.network\/welcome\/\?step=discord" target="_blank" rel="noopener"/);
});

test('every link names a step the wizard will open', () => {
  const html = onboardingCardHtml(view());
  const keys = [...html.matchAll(/\?step=([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 3);
  for (const k of keys) assert.ok(requestedStep(k, ONBOARDING_STEPS) >= 0, `the wizard does not know step ${k}`);
});

test('titles are escaped', () => {
  const p = { known: true, complete: false, outstanding: 1, steps: [{ key: 'x"y', title: '<img src=x>', state: 'todo' }] };
  const html = onboardingCardHtml(p);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /step=x%22y/);
});

test('the copy follows the writing rules', () => {
  const text = onboardingCardHtml(view()).replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /[–—]/, 'no en or em dashes');
  assert.doesNotMatch(text, /\b\w+'(s|t|re|ll|ve|d)\b/i, 'no contractions');
});

// ---- the cache and the element ----

test('the view is remembered per account for a minute', () => {
  forgetProgress();
  assert.equal(cachedProgress(), null);
  rememberProgress('alice', { known: true }, 1000);
  assert.deepEqual(cachedProgress(undefined, 1000 + CARD_TTL_MS - 1), { progress: { known: true }, fresh: true });
  assert.equal(cachedProgress(undefined, 1000 + CARD_TTL_MS).fresh, false);
  assert.equal(cachedProgress('bob'), null, 'another account never reads it');
});

test('a recreated card paints from memory and does not read everything again', async () => {
  forgetProgress();
  const client = host();
  setClient(client);
  const first = new GbtiOnboardingProgress();
  first.render();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const reads = client.calls.getContentItem.length;
  assert.equal(reads, 1, 'the first card loaded once');
  assert.equal(cachedProgress().progress.known, true);

  const second = new GbtiOnboardingProgress(); // the overview replaced its HTML
  second.render();
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.getContentItem.length, reads, 'a fresh memory means no second load');
  forgetProgress();
});

test('the WorkBench overview carries the card in its banner slot', () => {
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-workspace.mjs', import.meta.url), 'utf8');
  assert.match(src, /import '\.\/gbti-onboarding-progress\.mjs';/);
  assert.match(src, /\$\{trialHtml\}<gbti-onboarding-progress><\/gbti-onboarding-progress>\n\s*<div class="ov-tiles">/);
});
