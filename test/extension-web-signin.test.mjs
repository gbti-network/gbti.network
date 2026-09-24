// sow-393: the extension half of signing in through the website. The pure helpers are driven directly; the wiring in
// the sign-in page, the background worker and the sign-in screen is read from source, the way the sow-387 handoff
// tests read it, because it only runs inside Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePkce, startUrl, readRedirectResult, claimTokens, knownLoginFrom, fromExtensionPage, REDIRECT_PATH } from '../extension/src/web-signin.mjs';
import { s256, STORE_EXTENSION_ID } from '../workers/signup/extension-signin.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const inOrder = (src, needles, what) => {
  let at = -1;
  for (const n of needles) {
    const i = src.indexOf(n, at + 1);
    assert.ok(i > at, `"${n}" is missing or out of order in ${what}`);
    at = i;
  }
};
const REDIRECT = `https://${STORE_EXTENSION_ID}.chromiumapp.org/${REDIRECT_PATH}`;

// ---- the pure half ----

test('the extension\'s PKCE pair is one the Worker accepts: same challenge from the same verifier', async () => {
  const { verifier, challenge } = await makePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, await s256(verifier), 'the claim would fail if these two ever disagreed');
  assert.notEqual((await makePkce()).verifier, verifier, 'fresh randomness each time');
});

test('the start URL carries the challenge, the extension\'s own redirect, and a checked login hint', () => {
  const u = new URL(startUrl({ challenge: 'abc_-123', redirect: REDIRECT, login: 'octo' }));
  assert.equal(`${u.origin}${u.pathname}`, 'https://signup.gbti.network/auth/extension/start');
  assert.equal(u.searchParams.get('challenge'), 'abc_-123');
  assert.equal(u.searchParams.get('redirect'), REDIRECT);
  assert.equal(u.searchParams.get('login'), 'octo');
  assert.equal(new URL(startUrl({ challenge: 'c', redirect: REDIRECT, login: '<x>' })).searchParams.has('login'), false);
});

test('the sign-in window\'s result is read only from the exact redirect this extension asked for', () => {
  const code = 'A'.repeat(43);
  assert.deepEqual(readRedirectResult(`${REDIRECT}#code=${code}`, REDIRECT), { code });
  assert.deepEqual(readRedirectResult(`${REDIRECT}#error=declined`, REDIRECT), { error: 'declined' });
  for (const junk of [`https://${'b'.repeat(32)}.chromiumapp.org/${REDIRECT_PATH}#code=${code}`, `${REDIRECT}x#code=${code}`,
    `https://gbti.network/#code=${code}`, `${REDIRECT}?q=1#code=${code}`, `${REDIRECT}#code=short`, `${REDIRECT}#error=<b>`, `${REDIRECT}`, 'nonsense', undefined]) {
    assert.equal(readRedirectResult(junk, REDIRECT), null, `ignores ${junk}`);
  }
});

test('the claim posts the code and verifier, and refuses an answer without a token', async () => {
  let sent;
  const ok = async (url, init) => { sent = { url, init }; return { ok: true, status: 200, json: async () => ({ access_token: 'ghu', refresh_token: 'ghr', expires_in: 1 }) }; };
  const got = await claimTokens({ code: 'c', verifier: 'v' }, ok);
  assert.equal(sent.url, 'https://signup.gbti.network/auth/extension/claim');
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(JSON.parse(sent.init.body), { code: 'c', verifier: 'v' });
  assert.equal(got.access_token, 'ghu');
  await assert.rejects(claimTokens({ code: 'c', verifier: 'v' }, async () => ({ ok: false, status: 400, json: async () => ({}) })));
  await assert.rejects(claimTokens({ code: 'c', verifier: 'v' }, async () => ({ ok: true, status: 200, json: async () => ({ error: 'x' }) })));
});

test('only the extension\'s own pages count as its pages; a content script on a web page does not', () => {
  const origin = 'chrome-extension://iffjdmifgnjgkdjoodapjciddibmifka/';
  assert.equal(fromExtensionPage({ url: `${origin}newtab.html`, tab: { id: 3 } }, origin), true, 'the new tab page is a tab, and still ours');
  assert.equal(fromExtensionPage({ url: 'https://gbti.network/articles/x/', tab: { id: 4 } }, origin), false);
  assert.equal(fromExtensionPage({ url: 'chrome-extension://otherextensionidxxxxxxxxxxxxxxx/newtab.html' }, origin), false);
  assert.equal(fromExtensionPage({}, origin), false);
  assert.equal(fromExtensionPage({ url: `${origin}newtab.html` }, ''), false, 'no origin, no trust');
});

test('"Continue as" only ever shows a well-formed GitHub login', () => {
  assert.equal(knownLoginFrom({ login: 'octo-cat' }), 'octo-cat');
  for (const bad of [{}, null, { login: '' }, { login: '<img>' }, { login: '-lead' }, { login: 'x'.repeat(40) }]) assert.equal(knownLoginFrom(bad), null);
});

// ---- the wiring ----

test('the sign-in page runs the flow in Chrome\'s own sign-in window and hands the background the code and verifier', () => {
  const shell = read('extension/src/shell.mjs');
  const web = shell.slice(shell.indexOf('async function shellWebLogin('), shell.indexOf('function shellLogin('));
  inOrder(web, ['makePkce()', 'chrome.identity.getRedirectURL(REDIRECT_PATH)', 'chrome.identity.launchWebAuthFlow({ url: startUrl({ challenge, redirect, login }), interactive: true })',
    'readRedirectResult(finalUrl, redirect)', "chrome.runtime.sendMessage({ type: 'login', method: 'web', code: got.code, verifier })"], 'shellWebLogin');
  assert.doesNotMatch(web, /tabs\.create|window\.open/, 'never an ordinary tab or window, which pages and other extensions can read');
  assert.match(read('extension/manifest.json'), /"permissions": \["storage", "identity"\]/, 'the identity permission the sign-in window needs');
});

test('the gate starts the website sign-in by default, keeps the code as a fallback, and explains a failure as text', () => {
  const shell = read('extension/src/shell.mjs');
  const gate = shell.slice(shell.indexOf('function mountAuthGate('), shell.indexOf('function setTheme('));
  assert.match(gate, /const method = e\?\.detail\?\.method === 'code' \? 'code' : 'web';/, 'anything but an explicit code request is the website sign-in');
  assert.match(gate, /shellWebLogin\(el\.getAttribute\('known-login'\) \|\| ''\)/);
  assert.match(gate, /Object\.hasOwn\(why, err\?\.message\)/, 'an odd reason like "constructor" cannot pick a prototype member');
  assert.match(gate, /chrome\.runtime\.sendMessage\(\{ type: 'web-session-peek' \}\)/);
  assert.match(gate, /\.then\(\(\) => location\.reload\(\)\)/, 'whichever sign-in finishes, the page reloads signed in');
});

test('the background claims with the page\'s verifier, stores the same record as the device flow, in the pinned order', () => {
  const BG = read('extension/src/background.mjs');
  const web = BG.slice(BG.indexOf('async function handleWebLogin('), BG.indexOf('async function completeLogin('));
  inOrder(web, ['claimTokens({ code, verifier })', 'completeLogin(store, { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in })'], 'handleWebLogin');
  assert.match(BG, /return completeLogin\(store, \{ accessToken, refreshToken, expiresIn \}\);/, 'the device flow goes through the same completion');
  const branch = BG.slice(BG.indexOf("} else if (msg?.type === 'login') {"), BG.indexOf("} else if (msg?.type === 'signout') {"));
  inOrder(branch, ["msg.method === 'web' ? await handleWebLogin(store, msg) : await handleLogin(store)", 'broadcastAuthChanged()', 'await focusTab(', 'sendResponse(res)', 'afterSignIn(store, sender?.tab)'], 'the login branch');
  // The website sign-in and the "Continue as" read are refused before either branch runs unless an extension page sent
  // them, so a compromised web page's content script cannot plant tokens or read the website account.
  const guard = BG.indexOf("} else if ((msg?.type === 'web-session-peek' || (msg?.type === 'login' && msg.method === 'web')) && !fromExtensionPage(sender, chrome.runtime.getURL(''))) {");
  assert.ok(guard > 0, 'the sender guard exists');
  assert.ok(guard < BG.indexOf("} else if (msg?.type === 'web-session-peek') {") && guard < BG.indexOf("} else if (msg?.type === 'login') {"), 'and runs before both branches');
  assert.match(BG.slice(guard, BG.indexOf("} else if (msg?.type === 'web-session-peek') {")), /sendResponse\(\{ ok: false, error: 'forbidden' \}\);/);
  const peek = BG.slice(BG.indexOf("} else if (msg?.type === 'web-session-peek') {"), BG.indexOf("} else if (msg?.type === 'login') {"));
  assert.match(peek, /fetch\(`\$\{SIGNUP_BASE\}\/membership\/status`, \{ credentials: 'include'/);
  assert.match(peek, /sendResponse\(\{ ok: true, login \}\)/);
});

test('the sign-in screen offers the website sign-in, "Continue as", and the code; a shown code replaces the waiting box', () => {
  const splash = read('client-ui/src/elements/gbti-signin-splash.mjs');
  assert.match(splash, /this\.emit\('gbti:signin-start', \{ method: 'web' \}\)/);
  assert.match(splash, /this\.emit\('gbti:signin-start', \{ method: 'code' \}\)/);
  assert.match(splash, /Continue as @\$\{esc\(who\)\}/);
  const setCode = splash.slice(splash.indexOf('  setCode(userCode, verificationUri) {'), splash.indexOf('  setWaiting(on) {'));
  assert.match(setCode, /if \(this\._code\) this\._waiting = false;/, 'switching to the code must not leave the waiting box up');
});

test('the website sign-in says nothing about "Act on your behalf"; only the code, which still uses the GitHub App, explains it', () => {
  const splash = read('client-ui/src/elements/gbti-signin-splash.mjs');
  const waiting = splash.slice(splash.indexOf('const action = this._waiting'), splash.indexOf('      : code'));
  assert.ok(waiting.length > 0, 'found the waiting box');
  assert.doesNotMatch(waiting, /REASSURANCE|Act on your behalf/, 'the normal GitHub sign-in never shows that wording');
  const codeBox = splash.slice(splash.indexOf('      : code'), splash.indexOf('data-auth-signin type="button">${githubIco}'));
  assert.match(codeBox, /\$\{REASSURANCE\}/, 'the device code still goes through the GitHub App, whose page does');
});
