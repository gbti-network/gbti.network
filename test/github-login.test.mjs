// sow-369: the header's member handle can only ever be a GitHub login.
//
// The defect this pins, reproduced on production before the fix: `gbti.network/?u=<anything>` stored that
// string forever and printed it as "@<string>". The owner met it as a YouTube url in the avatar control, and
// the same path would print another member's name and avatar to anyone who opened a crafted link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isGithubLogin } from '../src/lib/github-login.mjs';

test('sow-369: a GitHub login is accepted and anything else is refused', () => {
  for (const ok of ['atwellpub', 'gbtilabs', 'Hudson-Atwell', 'a', 'a1', '0', 'a'.repeat(39)]) {
    assert.equal(isGithubLogin(ok), true, ok);
  }
  for (const no of [
    'https://www.youtube.com/watch?v=N_GfH09iP9c&list=RDN_GfH09iP9c&start_radio=1', // the reported value
    'a'.repeat(40), '-lead', 'trail-', 'a--b', 'has space', 'semi;colon', '../etc', 'a/b', '<script>',
    'user@example.com', '', ' ', null, undefined, 42, {}, [],
  ]) {
    assert.equal(isGithubLogin(no), false, JSON.stringify(no));
  }
});

test('sow-369: the header refuses a hint that is not a login, and deletes a stored one that is not', () => {
  const src = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
  assert.match(src, /import \{ isGithubLogin \} from '\.\.\/lib\/github-login\.mjs'/);
  const hint = /function readHint\(\)[\s\S]*?\n  \}/.exec(src);
  assert.ok(hint, 'readHint is still there');
  assert.match(hint[0], /if \(u && isGithubLogin\(u\)\)/, 'the url hint is validated before it is stored');
  assert.match(hint[0], /removeItem\('gbti_hello'\)/, 'a stored value that is not a login heals itself away');
  // The unvalidated form must not come back.
  assert.equal(/setItem\('gbti_hello', u\);\s*login = u;\s*\}\s*else login = localStorage/.test(src), false);
});

test('sow-369: the member signal drops a login or username that is not login-shaped', () => {
  const src = readFileSync(new URL('../src/lib/member-signal.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ isGithubLogin \} from '\.\/github-login\.mjs'/);
  const coerce = /function coerce\([\s\S]*?\n\}/.exec(src);
  assert.ok(coerce, 'coerce is still there');
  assert.match(coerce[0], /login: name\(r\.login\)/);
  assert.match(coerce[0], /username: name\(r\.username\)/);
});
