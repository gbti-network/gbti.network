// sow-345 (2026-09-16): the welcome wizard's browser-local state is per ACCOUNT, and the socials step shows the
// SAVED profile first. Owner-reported: signed in as one member, the socials step prefilled another account's
// YouTube handle and none of the member's own. Two causes, both pinned here against the component source: the
// three local keys were bare (no account in the key, so one browser leaked between sign-ins), and on the website
// the profile was never read (its listing has no profile type, and the code only read by a listed path).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../client-ui/src/elements/gbti-welcome.mjs', import.meta.url), 'utf8');
const EDITOR = fs.readFileSync(new URL('../client-ui/src/elements/gbti-profile-editor.mjs', import.meta.url), 'utf8');

test('welcome storage (sow-345): the wizard never reads or writes a bare, account-less welcome key', () => {
  const bare = SRC.match(/localStorage\.(getItem|setItem)\((DISCORD_DONE_KEY|CHAN_FOLLOWED_KEY|SOCIALS_STAGE_KEY)\b/g) || [];
  assert.deepEqual(bare, [], `bare (account-less) key reads or writes remain: ${bare.join(', ')}`);
  for (const k of ['DISCORD_DONE_KEY', 'CHAN_FOLLOWED_KEY', 'SOCIALS_STAGE_KEY']) {
    assert.match(SRC, new RegExp(`accountKey\\(${k}, `), `${k} is scoped through accountKey`);
  }
  // The bare keys are purged on load so nothing else can read another account's state out of them.
  assert.match(SRC, /for \(const k of \[DISCORD_DONE_KEY, CHAN_FOLLOWED_KEY, SOCIALS_STAGE_KEY\]\) \{ try \{ localStorage\.removeItem\(k\);/, 'the legacy bare keys are removed on load');
});

test('welcome socials (sow-345): the member profile is read by path when the listing has nothing, and the saved profile wins', () => {
  assert.match(SRC, /path = `members\/\$\{who\}\/profile\.md`/, 'the own profile path is derived from the identity');
  assert.match(SRC, /socialPrefill\(recallProfileSocials\(full\?\.frontmatter\?\.links, SOCIAL_KEYS\), this\._socialDraft, SOCIAL_KEYS\)/, 'saved handles outrank the staged draft');
});

test('profile editor (sow-345): the consumer of the staged handles reads the same account-scoped key', () => {
  assert.ok(!/localStorage\.(getItem|removeItem)\('gbti-welcome-socials'\)/.test(EDITOR), 'no bare key left in the consumer');
  assert.match(EDITOR, /accountKey\('gbti-welcome-socials', status\?\.identity\)/, 'the consumer scopes by the same identity');
});
