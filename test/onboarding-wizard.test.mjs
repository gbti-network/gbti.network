// sow-343 Phase 2: the welcome wizard writes onboarding progress, and its socials step finally saves.
//
// Two behaviours matter to the member and both are driven here on a real wizard instance (node has no DOM, so
// rendering is stubbed; the decisions are not). Moving on from an unfinished step is remembered as a skip, which
// is what the WorkBench card reads. And Continue on the socials step puts the handles on the profile, without
// ever writing a bare new profile over a real one when the read failed.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { wizardProfileLinks, mergeChannelFollows, requestedStep } from '../client-ui/src/welcome-core.mjs';
import { saveWizardSocials } from '../client-ui/src/welcome-socials.mjs';
import { ONBOARDING_STEPS } from '../membership/onboarding.mjs';
import { setClient } from '../client-ui/src/base.mjs';
import { GbtiWelcome } from '../client-ui/src/elements/gbti-welcome.mjs';
import { getContentItem } from '../client/src/operations-read.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** A client that records what it was asked to do. */
function fakeClient({ publishError = null } = {}) {
  const calls = { prefs: [], publish: [] };
  return {
    calls,
    setPrefs: async (patch) => { calls.prefs.push(patch); return {}; },
    publish: async (payload) => { calls.publish.push(payload); if (publishError) throw publishError; return { prNumber: 1 }; },
  };
}

// ---- the pure helpers ----

test('the links a save writes: typed values win, untouched saved links stay, nothing is removed', () => {
  const saved = { github: 'https://github.com/a', x: '@old' };
  assert.deepEqual(wizardProfileLinks(saved, { github: 'https://github.com/a', x: '@old' }), { links: saved, changed: false }, 'prefilled and untouched: no save');
  assert.deepEqual(wizardProfileLinks(saved, { x: '@new' }), { links: { github: 'https://github.com/a', x: '@new' }, changed: true });
  assert.deepEqual(wizardProfileLinks(saved, {}).links, saved, 'an emptied field removes nothing');
  assert.deepEqual(wizardProfileLinks(null, { x: ' @me ', junk: 5 }, ['x']), { links: { x: '@me' }, changed: true });
  assert.equal(wizardProfileLinks(null, { mastodon: '@me' }, ['x']).changed, false, 'a key that is not offered never lands');
});

test('channel follows merge from the browser and the account, and only the browser-only ones are sent up', () => {
  assert.deepEqual(mergeChannelFollows(['x', 'reddit'], ['reddit', 'github']), { all: ['reddit', 'github', 'x'], missing: ['x'] });
  assert.deepEqual(mergeChannelFollows(null, undefined), { all: [], missing: [] });
});

test('a link to a step opens that step, and an unknown key opens nothing in particular', () => {
  assert.equal(requestedStep('socials', ONBOARDING_STEPS), 2);
  assert.equal(requestedStep('nope', ONBOARDING_STEPS), -1);
  assert.equal(requestedStep(null, ONBOARDING_STEPS), -1);
});

// ---- the socials save ----

test('nothing typed, or nothing changed: no save and no record write', async () => {
  const c = fakeClient();
  const r = await saveWizardSocials({ client: c, profile: { path: 'members/a/profile.md', frontmatter: { links: { x: '@a' } } }, profileRead: true, draft: { x: '@a' }, membership: 'paid' });
  assert.equal(r.outcome, 'nothing');
  assert.deepEqual(c.calls, { prefs: [], publish: [] });
});

test('a trial member cannot publish a profile, so the handles are kept on the account instead', async () => {
  const c = fakeClient();
  const r = await saveWizardSocials({ client: c, profile: null, profileRead: true, draft: { x: '@me' }, membership: 'trialing' });
  assert.equal(r.outcome, 'kept');
  assert.equal(r.error, undefined, 'keeping is not a failure; the member moves on');
  assert.deepEqual(c.calls.publish, []);
  assert.deepEqual(c.calls.prefs, [{ onboardingSocials: { x: '@me' } }]);
});

test('a paid member with a profile: the handles are added, and everything else on the profile is kept', async () => {
  const c = fakeClient();
  const profile = { path: 'members/alice/profile.md', frontmatter: { displayName: 'Alice', headline: 'Builder', links: { github: 'g' } }, body: 'My bio.' };
  const r = await saveWizardSocials({ client: c, profile, profileRead: true, draft: { x: '@alice' }, membership: 'paid', login: 'alice' });
  assert.equal(r.outcome, 'saved');
  assert.deepEqual(c.calls.publish, [{ type: 'profile', input: { displayName: 'Alice', headline: 'Builder', links: { github: 'g', x: '@alice' } }, body: 'My bio.', path: 'members/alice/profile.md' }]);
  assert.deepEqual(c.calls.prefs, [{ onboardingSocialsSaved: true }], 'a save that landed clears the kept handles');
  assert.equal(r.profile.frontmatter.links.x, '@alice');
});

test('a paid member with no profile gets one, named after their GitHub login', async () => {
  const c = fakeClient();
  const r = await saveWizardSocials({ client: c, profile: null, profileRead: true, draft: { bluesky: '@me.bsky' }, membership: 'paid', login: 'newbie' });
  assert.equal(r.outcome, 'saved');
  assert.deepEqual(c.calls.publish, [{ type: 'profile', input: { displayName: 'newbie', links: { bluesky: '@me.bsky' } }, body: '' }]);
});

test('THE GUARD: when the profile read did not answer, nothing is written, least of all a new profile', async () => {
  const c = fakeClient();
  const r = await saveWizardSocials({ client: c, profile: null, profileRead: false, draft: { x: '@me' }, membership: 'paid', login: 'alice' });
  assert.equal(r.outcome, 'unread');
  assert.match(r.error, /nothing was saved/);
  assert.deepEqual(c.calls.publish, []);
});

test('a failed publish is reported, and the handles are kept rather than lost', async () => {
  const c = fakeClient({ publishError: new Error('the network is down') });
  const r = await saveWizardSocials({ client: c, profile: null, profileRead: true, draft: { x: '@me' }, membership: 'paid', login: 'a' });
  assert.equal(r.outcome, 'failed');
  assert.match(r.error, /were not saved \(the network is down\)/);
  assert.deepEqual(c.calls.prefs, [{ onboardingSocials: { x: '@me' } }]);
});

// ---- the wizard itself ----

function wizard(state = {}) {
  const c = fakeClient(state.publishError ? { publishError: state.publishError } : {});
  setClient(c);
  const el = new GbtiWelcome();
  el.render = () => {};
  Object.assign(el, {
    _step: 0, _done: false, _discordJoined: false, _chanFollowed: new Set(), _socialDraft: {},
    _follows: new Set(), _topicsCount: 0, _membership: 'paid', _profileRead: true, _profile: null, _login: 'alice',
  }, state);
  return { el, c };
}

test('moving on from an unfinished step records a skip; a finished one records nothing', async () => {
  const a = wizard();
  await a.el._next();
  assert.deepEqual(a.c.calls.prefs, [{ onboardingSkip: { step: 'discord' } }]);
  assert.equal(a.el._step, 1);

  const b = wizard({ _discordJoined: true });
  await b.el._next();
  assert.deepEqual(b.c.calls.prefs, []);
  assert.equal(b.el._step, 1);
});

const flush = () => new Promise((r) => setImmediate(r));

test('jumping around the rail is not a skip', async () => {
  const { el, c } = wizard();
  el._goto(3);
  el._goto(0);
  await flush(); // the record write is asynchronous; give a stray one the chance to land before asserting
  assert.deepEqual(c.calls.prefs, []);
});

/** Drive the real load() against a fake host. Timers are mocked: the profile read races a 6 second timeout. */
async function loaded({ startStep = null, prefs = {}, contentItem, discord = false } = {}) {
  const calls = { prefs: [] };
  const client = {
    status: async () => ({ authenticated: true, membership: 'paid', identity: { login: 'alice', username: 'alice' } }),
    getFollows: async () => ({ following: [] }),
    getPrefs: async () => prefs,
    setPrefs: async (patch) => { calls.prefs.push(patch); return {}; },
    discordLinkStatus: async () => ({ linked: discord }),
    listContent: async () => ({ items: [] }),
    getContentItem: contentItem,
  };
  setClient(client);
  const el = new GbtiWelcome();
  el.render = () => {};
  el.hasAttribute = () => false;
  el.getAttribute = (name) => (name === 'start-step' ? startStep : null);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ members: [] }) });
  mock.timers.enable({ apis: ['setTimeout'] });
  try { await el.load(); await flush(); } finally { mock.timers.reset(); globalThis.fetch = realFetch; }
  return { el, calls };
}

const missing = async () => { const e = new Error('no such item'); e.code = 'not-found'; throw e; };

test('on load: a requested step wins over resuming, and an unknown one falls back to resuming', async () => {
  assert.equal((await loaded({ startStep: 'topics', contentItem: missing })).el._step, 4);
  assert.equal((await loaded({ startStep: 'nope', contentItem: missing })).el._step, 0, 'resume lands on the first unfinished step');
  assert.equal((await loaded({ contentItem: missing, discord: true })).el._step, 1, 'with Discord linked, resume moves past it');
});

test('on load: a missing profile is an answer; a failed read is not', async () => {
  const absent = await loaded({ contentItem: missing });
  assert.equal(absent.el._profileRead, true);
  assert.equal(absent.el._profile, null);

  const broken = await loaded({ contentItem: async () => { const e = new Error('github error 502'); e.code = 'internal'; throw e; } });
  assert.notEqual(broken.el._profileRead, true, 'a failed read must leave the save refusing');

  const found = await loaded({ contentItem: async () => ({ frontmatter: { displayName: 'Alice', links: { x: '@alice' } }, body: 'Bio' }) });
  assert.equal(found.el._profileRead, true);
  assert.equal(found.el._profile.path, 'members/alice/profile.md');
  assert.equal(found.el._socialDraft.x, '@alice', 'the saved handle prefills the step');
});

test('on load: channels and kept handles on the account show up, and nothing is sent back needlessly', async () => {
  const { el, calls } = await loaded({ contentItem: missing, prefs: { categories: [], onboarding: { networkFollows: ['x'], socials: { bluesky: '@a.bsky' } } } });
  assert.deepEqual([...el._chanFollowed], ['x']);
  assert.equal(el._socialDraft.bluesky, '@a.bsky');
  assert.deepEqual(calls.prefs, [], 'the account already had everything this browser knew');
});

test('the last step: "I am all set" with no topics records that skip and finishes', async () => {
  const { el, c } = wizard({ _step: 4 });
  await el._next();
  assert.deepEqual(c.calls.prefs, [{ onboardingSkip: { step: 'topics' } }]);
  assert.equal(el._done, true);
});

test('Continue on socials saves the handles; Skip never does', async () => {
  const cont = wizard({ _step: 2, _socialDraft: { x: '@alice' } });
  await cont.el._next();
  assert.equal(cont.c.calls.publish.length, 1, 'Continue published the profile');
  assert.equal(cont.el._step, 3);

  const skip = wizard({ _step: 2, _socialDraft: { x: '@alice' } });
  await skip.el._next({ skip: true });
  assert.deepEqual(skip.c.calls.publish, [], 'Skip must not save');
  assert.equal(skip.el._step, 3);

  const empty = wizard({ _step: 2 });
  await empty.el._next({ skip: true });
  assert.deepEqual(empty.c.calls.prefs, [{ onboardingSkip: { step: 'socials' } }], 'skipping an empty socials step is a skip');
});

test('a failed save keeps the member on the socials step with the reason', async () => {
  const { el } = wizard({ _step: 2, _socialDraft: { x: '@alice' }, publishError: new Error('boom') });
  await el._next();
  assert.equal(el._step, 2);
  assert.match(el._socialError, /boom/);
  assert.equal(el._socialSaving, false);
});

test('the rail ticks only finished steps, even when a link opened a later step', () => {
  const { el } = wizard({ _step: 3, _discordJoined: false, _chanFollowed: new Set(['x']) });
  const ticks = [...el._railHtml().matchAll(/<button class="rstep([^"]*)"/g)].map((m) => m[1].includes('done'));
  assert.deepEqual(ticks, [false, true, false, false, false], 'Discord was not done, so it must not show a tick');
  el._done = true;
  const atEnd = [...el._railHtml().matchAll(/<button class="rstep([^"]*)"/g)].map((m) => m[1].includes('done'));
  assert.deepEqual(atEnd, [false, true, false, false, false], 'finishing the wizard does not tick skipped steps');
});

// ---- wiring that only the source shows ----

const SRC = read('client-ui/src/elements/gbti-welcome.mjs');

test('the wizard takes its steps from the shared list, not a copy', () => {
  assert.match(SRC, /const STEPS = ONBOARDING_STEPS;/);
  assert.doesNotMatch(SRC, /\{ key: 'discord', label:/, 'a local step list is back');
});

test('the Skip button is its own action, and a channel Follow is written to the account', () => {
  assert.match(SRC, /class="skipbtn" data-step-skip /);
  assert.match(SRC, /this\.on\('\[data-step-skip\]', 'click', \(\) => this\._next\(\{ skip: true \}\)\)/);
  assert.match(SRC, /this\._prefs\(\{ onboardingFollows: \[key\] \}\)/);
  assert.match(SRC, /if \(chans\.missing\.length && this\._record !== undefined\) this\._prefs\(\{ onboardingFollows: chans\.missing \}\)/);
});

test('the profile read treats only "not found" as absence', () => {
  assert.match(SRC, /catch \(e\) \{ if \(e\?\.code !== 'not-found'\) throw e; \}/);
  // _profileRead is set after the read answers, never before it.
  const readAt = SRC.indexOf('full = await this.client?.getContentItem?.({ path })');
  const flagAt = SRC.indexOf('this._profileRead = true;');
  assert.ok(readAt > 0 && flagAt > readAt, 'the answered flag must follow the read');
});

test('the website page passes a requested step to the wizard', () => {
  assert.match(read('src/pages/welcome.astro'), /if \(step\) document\.querySelector\('gbti-welcome'\)\?\.setAttribute\('start-step', step\)/);
});

// ---- the extension's "not found" is confirmed before anyone acts on it ----

function readCtx({ readerItem = null, networkText, networkThrows = false } = {}) {
  const asked = [];
  return {
    asked,
    identity: () => ({ username: 'alice', login: 'alice' }),
    reader: { get: async () => readerItem },
    getRepoClient: () => ({
      getFileContent: async (path) => { asked.push(path); if (networkThrows) throw new Error('github error 502'); return networkText; },
    }),
  };
}

test('a reader miss is confirmed by the network: a file that exists is returned', async () => {
  const ctx = readCtx({ networkText: '---\ntype: profile\nusername: alice\ndisplayName: Alice\n---\nBio\n' });
  const item = await getContentItem(ctx, { path: 'members/alice/profile.md' });
  assert.equal(item.frontmatter.displayName, 'Alice');
  assert.equal(item.body.trim(), 'Bio');
});

test('only a network miss is "not found"; a network failure is a failure', async () => {
  await assert.rejects(getContentItem(readCtx({ networkText: null }), { path: 'members/alice/profile.md' }), (e) => e.code === 'not-found');
  await assert.rejects(getContentItem(readCtx({ networkThrows: true }), { path: 'members/alice/profile.md' }), (e) => e.code !== 'not-found' && /502/.test(e.message));
});

test('a path outside the caller\'s folder is never asked about', async () => {
  const ctx = readCtx({ networkText: 'x' });
  await assert.rejects(getContentItem(ctx, { path: 'members/bob/profile.md' }), (e) => e.code === 'not-found');
  assert.deepEqual(ctx.asked, []);
});
