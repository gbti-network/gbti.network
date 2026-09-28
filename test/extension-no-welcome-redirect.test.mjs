// sow-418 (owner, 2026-09-27): "We also want to completely remove the welcome redirect from the extension."
//
// Until then, a member's first extension sign-in on a browser opened gbti.network/welcome/ in a new tab in front
// (sow-387, extension/src/welcome-handoff.mjs). The owner removed it the same day they approved the first-run tour of the
// new tab (sow-401), which is now the first thing a new member meets. The website keeps its welcome page.
//
// What must survive the removal: one extension sign-in still signs the member in on the website (sow-158), and it
// still happens only after the sign-in page has its answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const BG = read('extension/src/background.mjs');
// Comments may name the retired redirect to explain it; only the code is held to the rule.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('sow-418: the background opens no welcome tab and imports nothing that could', () => {
  const bg = code(BG);
  assert.ok(bg.length > 1000 && bg.includes('chrome.runtime.onMessage'), 'the file this test reads has changed shape');
  assert.equal(/welcome/i.test(bg), false, 'no code in the background worker mentions the welcome');
  assert.equal(/WELCOME_SITE_URL|onboarding-card-core|welcome-handoff/.test(bg), false);
  assert.equal(/claimHandoff|shouldOpenWelcome|seedOnUpdate|loadProgress/.test(bg), false);
  assert.equal(existsSync(new URL('../extension/src/welcome-handoff.mjs', import.meta.url)), false, 'the hand-off module is gone');
});

test('sow-418: nothing runs on install or update to open a tab', () => {
  const bg = code(BG);
  assert.equal(/chrome\.runtime\.onInstalled/.test(bg), false, 'the update seed was the only install hook, and it is gone');
  // The only tabs the background opens are the extension's own pages, on a click or a relay.
  const opens = [...bg.matchAll(/chrome\.tabs\.create\(\{\s*url:\s*([^,}]+)/g)].map((m) => m[1].trim());
  for (const target of opens) assert.doesNotMatch(target, /gbti\.network|SITE|welcome/i, `a tab opened at ${target}`);
});

test('sow-418: the sign-in still signs the member in on the website, after answering the sign-in page', () => {
  const bg = code(BG);
  const start = bg.indexOf('function afterSignIn(');
  const fn = start >= 0 ? bg.slice(start, bg.indexOf('\n}\n', start)) : '';
  assert.ok(fn.includes('_afterSignIn = (async'), 'afterSignIn exists');
  assert.match(fn, /if \(_afterSignIn\) return _afterSignIn;/, 'single-flight');
  assert.match(fn, /mintWebSession\(store\.get\('githubToken'\)\)/, 'the website session is still minted');
  assert.equal(/chrome\.tabs\./.test(fn), false, 'and no tab is touched');
  const login = bg.slice(bg.indexOf("msg?.type === 'login'"), bg.indexOf("msg?.type === 'signout'"));
  const answered = login.indexOf('sendResponse(res)');
  const minted = login.indexOf('afterSignIn(store)');
  assert.ok(answered > 0 && minted > answered, 'the sign-in page is answered before the website session is minted');
});

test('sow-418: no extension page or module links to the welcome either', () => {
  const dir = new URL('../extension/src/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    assert.equal(/gbti\.network\/welcome|\/welcome\//.test(code(read(`extension/src/${f}`))), false, f);
  }
});
