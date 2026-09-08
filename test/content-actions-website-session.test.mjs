// sow-316: a signed-in WEBSITE member can favourite and collect on a content page without the extension.
//
// Source guard. The behaviour lives in inline page script that node --test cannot execute, so what is pinned
// here is the WIRING: that the website-session upgrade exists, that it is gated the way FeedList's is, and
// that the extension path it sits beside was not broken. Each assertion targets the CODE, never the comment
// above it: an earlier guard in this repo was satisfied by prose describing the guard it was meant to prove.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/components/ContentActions.astro', import.meta.url), 'utf8');
const FEED = readFileSync(new URL('../src/components/feeds/FeedList.astro', import.meta.url), 'utf8');

/** Only the executable part. The comments are where a prose match would hide. */
const code = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const CA = code(SRC);

test('the content page subscribes to the member signal and upgrades on it', () => {
  assert.match(CA, /import \{ onMemberSignal \} from '\.\.\/lib\/member-signal'/, 'the signal import is missing');
  assert.match(CA, /^\s*onMemberSignal\(upgradeForWebsiteSession\);/m,
    'the upgrade must be SUBSCRIBED, not merely defined; a defined-but-unsubscribed function is the bug wearing a fix');
});

test('the upgrade is gated on BOTH a login and the CSRF cookie, like FeedList', () => {
  // A stale signal with no cookie would upgrade the heart into a control that fails on every press.
  assert.match(CA, /if \(!signal \|\| !signal\.login \|\| !readCookie\('gbti_csrf'\)\) return;/,
    'the guard must read the cookie by CALL, and require the login');
  assert.match(code(FEED), /if \(!signal \|\| !signal\.login \|\| !readCookie\('gbti_csrf'\)\) return;/,
    'FeedList is the reference; if it changes shape this test must be revisited rather than loosened');
});

test('it steps aside when the extension is present, so the two paths never stack', () => {
  const fn = CA.slice(CA.indexOf('async function upgradeForWebsiteSession'), CA.indexOf('onMemberSignal(upgradeForWebsiteSession)'));
  assert.match(fn, /if \(document\.documentElement\.dataset\.gbtiExtension\) return;/,
    'without this an extension member gets two competing behaviours on one click');
});

test('it upgrades BOTH controls and sets the client FIRST', () => {
  const fn = CA.slice(CA.indexOf('async function upgradeForWebsiteSession'), CA.indexOf('onMemberSignal(upgradeForWebsiteSession)'));
  const setAt = fn.indexOf('setClient(client)');
  const favAt = fn.indexOf("gbti-favorite.mjs");
  const colAt = fn.indexOf("gbti-collection.mjs");
  assert.ok(setAt > 0 && favAt > 0 && colAt > 0, 'client set + both element imports must all be present');
  assert.ok(setAt < favAt && setAt < colAt,
    'the client must be injected BEFORE the elements upgrade, or their one-shot connectedCallback runs clientless');
});

test('the extension deep-link path is untouched', () => {
  // The fix must not become "hide the heart when the extension is absent". These three lines are the
  // existing SOW-114 behaviour and they must survive verbatim.
  assert.match(CA, /if \(!installed\(\)\) return;/, 'the capture-phase handler still yields without the extension');
  assert.match(CA, /openInExtension\(signin\.closest\('gbti-collection'\) \? 'collect' : 'favorite'\)/,
    'the deep-link into the extension reader is gone');
  assert.match(CA, /document\.addEventListener\('click', \(e\) => \{/, 'the capture listener itself is gone');
});

test('the upgrade runs at most once', () => {
  const fn = CA.slice(CA.indexOf('async function upgradeForWebsiteSession'), CA.indexOf('onMemberSignal(upgradeForWebsiteSession)'));
  assert.match(fn, /if \(websiteWired\) return;\s*websiteWired = true;/,
    'the signal fires more than once per page; without a latch the elements would be imported repeatedly');
});
