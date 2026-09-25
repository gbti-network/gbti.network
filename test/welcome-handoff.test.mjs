// sow-387: the extension hands setup to the website.
//
// Owner rulings: the welcome belongs to the website (2026-09-22); it opens right after a member's FIRST extension
// sign-in, already signed in there, and not for anyone whose setup is handled; the toolbar icon opens the new tab;
// the Settings reset row goes (2026-09-23). These tests pin the decision, the record, the order in the background's
// login branch, that the wizard no longer ships in any extension bundle, and the website welcome's three session
// states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  HANDOFF_PREFIX, handoffKey, claimHandoff, shouldOpenWelcome, createDispatchClient, withTimeout, seedOnUpdate,
} from '../extension/src/welcome-handoff.mjs';
import { loadProgress } from '../client-ui/src/onboarding-card-core.mjs';
import { welcomeView } from '../src/lib/member-signal-core.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** A chrome.storage.local stand-in: async get(key) -> { key: value } and set(obj). */
function memStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (k) => (k in data ? { [k]: data[k] } : {}),
    set: async (o) => { Object.assign(data, o); },
  };
}

// ---- the record ----

test('the record is per account and lives outside the prefix sign-out clears', () => {
  assert.equal(handoffKey('123'), 'gbti:welcome-handoff:123');
  assert.equal(handoffKey(123), 'gbti:welcome-handoff:123');
  for (const bad of [null, undefined, '', '   ']) assert.equal(handoffKey(bad), null);
  assert.ok(!HANDOFF_PREFIX.startsWith('gbti:wb:'), 'sign-out removes gbti:wb:* keys; the record must survive it');
  // And the sign-out branch really does filter on that prefix, so the claim above is about the real code.
  assert.match(read('extension/src/background.mjs'), /k\.startsWith\('gbti:wb:'\) \|\| k === 'gbti:create-recent'/);
});

test('only the first claim for an account wins', async () => {
  const s = memStorage();
  assert.equal(await claimHandoff(s, '7', 1000), true);
  assert.deepEqual(s.data['gbti:welcome-handoff:7'], { at: 1000 });
  assert.equal(await claimHandoff(s, '7', 2000), false, 'a second sign-in is not a first sign-in');
  assert.deepEqual(s.data['gbti:welcome-handoff:7'], { at: 1000 }, 'and it does not rewrite the record');
  assert.equal(await claimHandoff(s, '8'), true, 'another account on the same browser is its own first sign-in');
});

test('no account, no storage, or a storage failure claims nothing', async () => {
  assert.equal(await claimHandoff(memStorage(), null), false);
  assert.equal(await claimHandoff(null, '7'), false);
  const broken = { get: async () => { throw new Error('quota'); }, set: async () => {} };
  assert.equal(await claimHandoff(broken, '7'), false);
  const unwritable = { get: async () => ({}), set: async () => { throw new Error('quota'); } };
  assert.equal(await claimHandoff(unwritable, '7'), false, 'a record that could not be written was not claimed');
});

test('an extension update seeds a signed-in member, and nothing else does', async () => {
  const s = memStorage();
  assert.equal(await seedOnUpdate(s, { reason: 'install', githubId: '7' }), false, 'install never seeds (nor opens)');
  assert.equal(await seedOnUpdate(s, { reason: 'chrome_update', githubId: '7' }), false);
  assert.equal(await seedOnUpdate(s, { reason: 'update', githubId: null }), false, 'a signed-out browser has no one to seed');
  assert.deepEqual(s.data, {});
  assert.equal(await seedOnUpdate(s, { reason: 'update', githubId: '7' }), true);
  assert.equal(await claimHandoff(s, '7'), false, 'so their next sign-in opens nothing');
});

// ---- the decision ----

const step = (key, state) => ({ key, state });

test('the welcome opens only for the claim, and only with a step still to do', () => {
  const todo = { known: true, steps: [step('follow', 'done'), step('topics', 'todo')] };
  assert.equal(shouldOpenWelcome({ claimed: true, progress: todo }), true);
  assert.equal(shouldOpenWelcome({ claimed: false, progress: todo }), false, 'a re-sign-in never opens it');
  assert.equal(shouldOpenWelcome(), false);
});

test('a skipped step counts as handled', () => {
  const handled = { known: true, steps: [step('follow', 'done'), step('topics', 'skipped'), step('subreddit', 'skipped')] };
  assert.equal(shouldOpenWelcome({ claimed: true, progress: handled }), false);
  const allDone = { known: true, steps: [step('follow', 'done'), step('topics', 'done')] };
  assert.equal(shouldOpenWelcome({ claimed: true, progress: allDone }), false);
});

test('progress that could not be read still opens it', () => {
  assert.equal(shouldOpenWelcome({ claimed: true, progress: null }), true);
  assert.equal(shouldOpenWelcome({ claimed: true, progress: { known: false, steps: [step('follow', 'done')] } }), true);
  assert.equal(shouldOpenWelcome({ claimed: true, progress: { known: true } }), true, 'a malformed view is not a finished one');
});

// ---- the progress read, through the background's own dispatcher ----

/** A dispatcher answering the reads loadProgress makes, for a free (non-paying) account. */
function freeAccount({ prefs = { categories: [] }, following = [], failStatus = false } = {}) {
  const asked = [];
  const dispatch = async (req) => {
    asked.push(`${req.method} ${req.pathname}`);
    switch (req.pathname) {
      case '/api/status':
        return failStatus ? { status: 502, json: { error: 'upstream' } }
          : { status: 200, json: { authenticated: true, identity: { login: 'alice', username: 'alice', githubId: '7' }, membership: 'none' } };
      case '/api/prefs': return { status: 200, json: prefs };
      case '/api/follows': return { status: 200, json: { following } };
      case '/api/discord-link/status': return { status: 200, json: { linked: false } };
      case '/api/content': return { status: 200, json: { items: [] } };
      case '/api/content/item': return { status: 404, json: { error: 'not-found' } };
      default: return { status: 404, json: { error: 'unknown_route' } };
    }
  };
  return { dispatch, asked };
}

test('the dispatch client sends the method, path, query and body the dispatcher expects', async () => {
  const seen = [];
  const client = createDispatchClient(async (req) => { seen.push(req); return { status: 200, json: { ok: true } }; });
  await client.listContent({ type: 'profile' });
  await client.setPrefs({ categories: ['ai'] });
  assert.deepEqual(seen[0], { method: 'GET', pathname: '/api/content', query: { type: 'profile' }, body: undefined });
  assert.deepEqual(seen[1], { method: 'POST', pathname: '/api/prefs', query: {}, body: { categories: ['ai'] } });
  const failing = createDispatchClient(async () => ({ status: 503, json: { error: 'unavailable' } }));
  await assert.rejects(failing.status(), /unavailable/);
  const silent = createDispatchClient(async () => undefined);
  await assert.rejects(silent.status(), /no_response/, 'a dispatcher that answers nothing is a failure, not a success');
});

test('a brand-new free account has steps to do, so the welcome opens', async () => {
  const { dispatch, asked } = freeAccount();
  const progress = await loadProgress(createDispatchClient(dispatch));
  assert.equal(progress.known, true);
  assert.ok(progress.steps.some((s) => s.state === 'todo'));
  assert.equal(shouldOpenWelcome({ claimed: true, progress }), true);
  assert.ok(asked.includes('GET /api/prefs') && asked.includes('GET /api/follows'), asked.join(', '));
});

test('an account whose steps are done or skipped gets no welcome tab', async () => {
  const done = freeAccount({
    prefs: { categories: ['ai'], onboarding: { skipped: [], networkFollows: ['reddit'], socials: {}, socialsSaved: false } },
    following: [{ username: 'bob' }],
  });
  const p1 = await loadProgress(createDispatchClient(done.dispatch));
  assert.equal(p1.known, true);
  assert.equal(shouldOpenWelcome({ claimed: true, progress: p1 }), false, JSON.stringify(p1.steps));
  const skipped = freeAccount({ prefs: { categories: [], onboarding: { skipped: ['subreddit', 'follow', 'topics'], networkFollows: [], socials: {}, socialsSaved: false } } });
  const p2 = await loadProgress(createDispatchClient(skipped.dispatch));
  assert.equal(shouldOpenWelcome({ claimed: true, progress: p2 }), false, JSON.stringify(p2.steps));
});

test('a failed read on a finished account still opens the welcome (unknown is not finished)', async () => {
  const { dispatch } = freeAccount({ failStatus: true, prefs: null });
  const bad = async (req) => (req.pathname === '/api/prefs' ? { status: 502, json: { error: 'upstream' } } : dispatch(req));
  const progress = await loadProgress(createDispatchClient(bad));
  assert.equal(progress.known, false);
  assert.equal(shouldOpenWelcome({ claimed: true, progress }), true);
});

test('withTimeout gives up with the fallback, and a rejection becomes the fallback', async () => {
  assert.equal(await withTimeout(new Promise(() => {}), 10, 'late'), 'late');
  assert.equal(await withTimeout(Promise.reject(new Error('x')), 1000, null), null);
  assert.equal(await withTimeout(Promise.resolve(5), 1000, null), 5);
});

// ---- the background worker ----

const BG = read('extension/src/background.mjs');

test('the login branch answers the sign-in page first and starts the handoff last', () => {
  const branch = BG.slice(BG.indexOf("} else if (msg?.type === 'login') {"), BG.indexOf("} else if (msg?.type === 'signout') {"));
  const order = ['await handleLogin(store)', 'broadcastAuthChanged()', 'await focusTab(', 'sendResponse(res)', 'afterSignIn(store, sender?.tab)'];
  let at = -1;
  for (const needle of order) {
    const i = branch.indexOf(needle);
    assert.ok(i > at, `"${needle}" is out of order in the login branch`);
    at = i;
  }
  // handleLogin no longer mints: a slow Worker must never hold the sign-in screen.
  const login = BG.slice(BG.indexOf('async function handleLogin('), BG.indexOf('async function refreshViaWorker('));
  assert.doesNotMatch(login, /mintWebSession\(/);
  assert.doesNotMatch(login, /webSessionMinted: true/);
});

test('the handoff mints, claims before it reads, and opens the website welcome in front of the sign-in tab', () => {
  const fn = BG.slice(BG.indexOf('function afterSignIn('), BG.indexOf('async function broadcastAuthChanged('));
  assert.ok(fn.length > 0, 'afterSignIn exists');
  const order = ['mintWebSession(', 'claimHandoff(', 'loadProgress(', 'shouldOpenWelcome(', 'chrome.tabs.create(opts)'];
  let at = -1;
  for (const needle of order) {
    const i = fn.indexOf(needle);
    assert.ok(i > at, `"${needle}" is out of order in afterSignIn`);
    at = i;
  }
  assert.match(fn, /if \(_afterSignIn\) return _afterSignIn;/, 'single-flight');
  assert.match(fn, /if \(!minted\) \{ try \{ await chrome\.storage\?\.session\?\.remove\?\.\('webSessionMinted'\)/, 'a failed mint lets the opportunistic mint retry');
  assert.match(fn, /url: WELCOME_SITE_URL, active: true/);
  assert.match(fn, /opts\.openerTabId = tab\.id/);
  assert.match(BG, /signal: AbortSignal\.timeout\?\.\(MINT_TIMEOUT_MS\)/, 'the mint cannot hang the handoff');
  assert.match(BG, /return !!res\?\.ok;/, 'the mint reports whether it landed');
});

test('the toolbar icon opens the new tab, and nothing at install or update opens a tab', () => {
  assert.match(BG, /chrome\.action\?\.onClicked\?\.addListener\(\(\) => \{\n\s*chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\('newtab\.html'\) \}\)/);
  assert.doesNotMatch(BG, /['"]onboarding\.html['"]|ONBOARDING_PAGE|openOnboardingTab|onboardingTabId/);
  const installed = BG.slice(BG.indexOf('chrome.runtime.onInstalled'), BG.indexOf('const PROGRESS_TIMEOUT_MS'));
  assert.ok(installed.includes('seedOnUpdate('), 'the update seed is wired');
  assert.doesNotMatch(installed, /tabs\.create/);
  assert.match(read('extension/manifest.json'), /"default_title": "Open GBTI Network"/);
});

// ---- the wizard is the website's alone ----

test('no extension bundle carries the welcome wizard', () => {
  const dir = new URL('../extension/dist/', import.meta.url);
  const bundles = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(bundles.includes('newtab.js') && bundles.includes('content.js'), `read the real bundles: ${bundles.join(', ')}`);
  assert.ok(!bundles.includes('onboarding.js'), 'the retired toolbar page bundle is gone');
  for (const f of bundles) {
    const js = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!js.includes('define("gbti-welcome"'), `${f} defines <gbti-welcome>`);
    assert.ok(!js.includes('// client-ui/src/elements/gbti-welcome.mjs'), `${f} bundles the wizard source`);
  }
  // The sign-in screen does ship, in every page bundle that can show the wall.
  for (const f of ['newtab.js', 'shares.js', 'saved.js', 'admin.js', 'account.js']) { // sow-406: saved.js replaced workspace.js
    assert.ok(readFileSync(new URL(f, dir), 'utf8').includes('define("gbti-signin-splash"'), `${f} lacks the sign-in screen`);
  }
});

test('no extension source or client-ui barrel imports the wizard', () => {
  assert.doesNotMatch(read('client-ui/src/index.mjs'), /import ['"]\.\/elements\/gbti-(welcome|onboarding)\.mjs['"]/);
  const src = new URL('../extension/src/', import.meta.url);
  for (const f of readdirSync(src).filter((n) => n.endsWith('.mjs'))) {
    const code = readFileSync(new URL(f, src), 'utf8');
    assert.doesNotMatch(code, /elements\/gbti-welcome\.mjs['"]/, `${f} imports the wizard`);
    assert.doesNotMatch(code, /createElement\('gbti-welcome'\)/, `${f} mounts the wizard`);
  }
});

test('the sign-in wall mounts the sign-in screen, which cannot turn into the wizard', () => {
  const shell = read('extension/src/shell.mjs');
  const gate = shell.slice(shell.indexOf('function mountAuthGate('), shell.indexOf('function setTheme('));
  assert.match(gate, /document\.createElement\('gbti-signin-splash'\)/);
  assert.match(gate, /addEventListener\('gbti:signin-start'/);
  assert.doesNotMatch(gate, /auth-gate|gbti-welcome/);
  const splash = read('client-ui/src/elements/gbti-signin-splash.mjs');
  assert.doesNotMatch(splash, /this\.client|\.status\(\)/, 'the screen takes no client and reads no status');
});

// ---- the website welcome waits for a real session ----

test('the website welcome: loading while the session read is pending, then steps, sign-in, or reload', () => {
  assert.equal(welcomeView({ hasSessionCookie: true }), 'loading', 'a member is never shown "Sign in" mid-read');
  assert.equal(welcomeView({ hasSessionCookie: false }), 'signin', 'no session cookie: the answer is already known');
  assert.equal(welcomeView({ hasSessionCookie: true, cookie: { state: 'in' } }), 'wizard');
  assert.equal(welcomeView({ hasSessionCookie: true, cookie: { state: 'out' } }), 'signin');
  assert.equal(welcomeView({ hasSessionCookie: true, cookie: { state: 'error' } }), 'retry', 'a failed read is not a signed-out answer');
  assert.equal(welcomeView(), 'signin');
});

test('the website welcome mounts the steps only on a confirmed cookie session', () => {
  const page = read('src/pages/welcome.astro');
  assert.doesNotMatch(page, /onMemberSignal|readMemberSignal/, 'the display-only extension signal mounts nothing here');
  assert.match(page, /whenCookieState\(\)\.then\(/);
  assert.match(page, /if \(view === 'wizard' && s && s\.login\) mountWelcome\(s\);/);
  assert.match(page, /<div class="sec-head center" data-welcome-signedout hidden>/, 'the sign-in prompt starts hidden');
  assert.match(page, /<div data-welcome-signedin>/, 'the loading state is the first paint');
  const signal = read('src/lib/member-signal.ts');
  assert.match(signal, /settleCookieState\(\{ state: signal \? 'in' : failed \? 'error' : 'out', signal \}\);/);
  assert.match(signal, /else \{ signal = null; failed = true;/);
});
