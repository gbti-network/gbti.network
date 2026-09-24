// sow-394: signed-out readers can find "Submit content" (owner's design, 2026-09-24). A browser drive covers what a
// reader sees; these pin the wiring a drive cannot see break later: where each link sits, what it says and points
// at, and the gate that takes it away once someone signs in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const HEADER = src('src/components/Header.astro');
const INVITE = src('src/components/CommunityInvite.astro');
const PAGE = src('src/pages/submit-content/index.astro');

/** Fails unless each needle appears, in the order given. */
function inOrder(text, needles, what) {
  let at = -1;
  for (const n of needles) {
    const i = text.indexOf(n, at + 1);
    assert.ok(i > at, `${what}: "${n}" is missing or out of order`);
    at = i;
  }
}

test('the header button sits between the theme toggle and Sign in, and goes to the explainer', () => {
  inOrder(HEADER, [
    'data-theme-toggle',
    '<a href="/submit-content/" class="head-submit" data-submit-cta>',
    '<use href="#ico-pencil" /></svg> Submit content</a>',
    '<a href="/login/" class="btn-gh" data-signin>',
  ], 'header');
});

test('the header button leaves with Sign in once identity resolves, and comes back with it', () => {
  assert.match(HEADER, /const submitCta = document\.querySelector<HTMLElement>\('\[data-submit-cta\]'\);/);
  assert.match(HEADER, /signin\.style\.display = 'none';\n\s*if \(submitCta\) submitCta\.style\.display = 'none';/, 'hidden when signed in');
  assert.match(HEADER, /signin\.style\.display = '';\n\s*if \(submitCta\) submitCta\.style\.display = '';/, 'restored when signed out');
});

test('the header button shows only from 920px up, where the centred nav keeps room on both sides', () => {
  assert.match(HEADER, /\.head-submit \{ display: none;/, 'hidden by default');
  assert.match(HEADER, /@media \(min-width: 920px\) \{ \.head-submit \{ display: inline-flex; \} \}/, 'shown from 920px');
});

test('the phone menu carries it inside the signed-out set, before Sign in / Join', () => {
  const out = HEADER.slice(HEADER.indexOf('<div data-mnav-set="out">'), HEADER.indexOf('<div data-mnav-set="in"'));
  assert.ok(out.length > 0, 'the signed-out phone set was found');
  inOrder(out, ['<a href="/submit-content/" class="m-submit">', ' Submit content</a>', 'class="m-join">Sign in / Join</a>'], 'phone menu');
});

test('the end of every article has its own Submit content line, hidden for any signed-in account', () => {
  inOrder(INVITE, [
    'Become a member',
    '<p class="ci-submit">',
    '<span class="ci-submit-t">Publish your work on the network.</span>',
    '<a href="/submit-content/" class="ci-submit-a">Submit content ',
    '</section>',
  ], 'article invite');
  assert.match(INVITE, /html\.is-gbti-member \.community-invite \.ci-submit \{ display: none; \}/);
  // it is its own line, not a second button beside "Become a member"
  const buttons = INVITE.match(/class="btn /g) || [];
  assert.equal(buttons.length, 1, 'the invite keeps exactly one button');
});

test('the explainer shows the plans first to anyone who cannot publish, and the WorkBench to paid members', () => {
  inOrder(PAGE, [
    '<div class="sc-cta sc-cta-out">',
    '<a class="btn btn-primary" href="/membership/">See membership',
    '<a class="btn btn-ghost sc-signin" href="/login/?return_to=%2Fsubmit-content%2F">',
    '<div class="sc-cta sc-cta-paid">',
    '<a class="btn btn-primary" href="/workbench/">Open the WorkBench</a>',
  ], 'explainer');
  assert.match(PAGE, /\.sc-cta-paid \{ display: none; \}/, 'the signed-out set is the default, including without JavaScript');
  assert.match(PAGE, /:global\(html\.is-gbti-member\) \.sc-signin \{ display: none; \}/, 'a signed-in account loses Sign in');
  assert.match(PAGE, /:global\(html\.is-gbti-member-active\) \.sc-cta-out \{ display: none; \}/);
  assert.match(PAGE, /:global\(html\.is-gbti-member-active\) \.sc-cta-paid \{ display: flex; \}/);
});

test('every Submit content link points at the one explainer page', () => {
  for (const [name, text] of [['header', HEADER], ['article invite', INVITE]]) {
    // One icon at most between the tag and the words: the icon pattern may not cross its own </svg>, or a match
    // could run from one link's icon to a later link's words and report the wrong href.
    const hrefs = [...text.matchAll(/<a href="([^"]+)"[^>]*>(?:<svg(?:(?!<\/svg>)[^])*<\/svg>)?\s*Submit content/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 1, `${name}: found its link`);
    for (const h of hrefs) assert.equal(h, '/submit-content/', name);
  }
});
