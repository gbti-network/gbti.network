// sow-435 (owner, 2026-09-30): the "Join the GBTI Network" panel comes off articles, and the header loses its "Get
// Extension" item. The owner kept the panel's hidden job: an article still credits its author when a reader joins later
// (the first-touch referral cookie), so the credit moved into its own component that every page renders. The built
// pages are guarded by scripts/check-article-closing-slot.mjs (the panel must not render on an article) and
// scripts/check-extension-cta.mjs (the retired header item must render nowhere); these pins hold the wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('articles drop the panel; projects and prompts keep it', () => {
  assert.match(read('src/pages/articles/[slug].astro'), /<ContentFooter slot="closing" type="post"[^>]*invite=\{false\} \/>/);
  for (const page of ['src/pages/projects/[slug].astro', 'src/pages/prompts/[slug].astro']) {
    const s = read(page);
    if (/<ContentFooter/.test(s)) assert.doesNotMatch(s, /invite=\{false\}/, `${page} keeps the panel`);
  }
});

test('the content footer renders the credit alone when there is no panel', () => {
  const s = read('src/components/ContentFooter.astro');
  assert.match(s, /invite = true \} = Astro\.props;/, 'the panel stays the default');
  assert.match(s, /\{invite \? <CommunityInvite author=\{author\} via=\{viaTag\} \/> : <ReferralCredit author=\{author\} via=\{viaTag\} \/>\}/);
});

test('the credit is one component, and the panel delegates to it', () => {
  const credit = read('src/components/ReferralCredit.astro');
  const invite = read('src/components/CommunityInvite.astro');
  assert.match(credit, /const refCode = refCodeForAuthor\(author\);/);
  assert.match(credit, /define:vars=\{\{ refCode, via: via \?\? '', cookie: REF_COOKIE, viaCookie: REF_VIA_COOKIE, days: REF_COOKIE_DAYS \}\}/);
  assert.match(credit, /if \(has\) return;/, 'first touch wins: an existing credit is never overwritten');
  assert.match(invite, /<ReferralCredit author=\{author\} via=\{via\} \/>/);
  assert.doesNotMatch(invite, /document\.cookie/, 'one copy of the cookie logic, not two');
});

test('the header has no extension nav item; the account-menu nudge stays behind the switch', () => {
  const s = read('src/components/Header.astro');
  const markup = s.split('---')[2] || '';
  assert.doesNotMatch(markup, /Get Extension/);
  assert.doesNotMatch(s, /signedOutExtra/);
  assert.match(markup, /\{extensionCtaShown && <a class="hm-item hm-download"/);
});
