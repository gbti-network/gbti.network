// A GitHub App bot account has no avatar at github.com/<login>.png (GitHub 404s it). Every change the network
// publishes is committed by our app, so the article history showed a broken image per bot commit, which a site
// crawl reported on 2026-09-21. The history now shows those commits as the network itself, and the avatar helper
// never builds a URL for a bot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isBotLogin } from '../src/lib/bot-login.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a bot login is recognised, a member login is not', () => {
  assert.equal(isBotLogin('gbti-network-publisher[bot]'), true);
  assert.equal(isBotLogin('dependabot[bot]'), true);
  assert.equal(isBotLogin(' GitHub-Actions[Bot] '), true);
  for (const l of ['atwellpub', 'gbtilabs', 'bot', 'robot-maker', '', null, undefined]) assert.equal(isBotLogin(l), false, String(l));
});

test('the avatar helper refuses a bot before it builds a github.com avatar URL', () => {
  const src = read('src/lib/avatars.ts');
  const fn = src.slice(src.indexOf('export function githubAvatarUrl'), src.indexOf('export function githubLogin'));
  assert.ok(fn.length > 0, 'the helper must be found, or this checks nothing');
  assert.ok(fn.indexOf('if (isBotLogin(login)) return undefined;') > -1, 'the bot guard is present');
  assert.ok(fn.indexOf('isBotLogin(login)') < fn.indexOf('https://github.com/'), 'and runs before the URL is built');
});

test('the article history shows a bot commit as the network, not as the bot handle', () => {
  const src = read('src/components/blog/OpenHistory.astro');
  const fn = src.slice(src.indexOf('function who('), src.indexOf('// Distinct ACCEPTED contributors'));
  assert.ok(fn.length > 0, 'who() must be found, or this checks nothing');
  assert.match(fn, /if \(isBotLogin\(login\)\) return index\.byUsername\.get\('gbtilabs'\) \?\? \{ name: 'GBTI Network', avatar: GBTI_AVATAR \};/);
  assert.ok(fn.indexOf('isBotLogin(login)') < fn.indexOf('githubAvatarUrl(login)'), 'before any avatar URL is built');
});
