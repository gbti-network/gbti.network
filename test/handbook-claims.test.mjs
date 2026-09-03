// sow-271 Phase 2: the handbook told readers things that stopped being true when the website became
// capable. This suite pins the corrections, because nothing else in the project can catch this class:
// no test, content check or dist guard reads a sentence and asks whether it is still true.
//
// Each RETIRED claim below was verified false against the code on 2026-09-03, not merely disliked:
//
//   "GBTI Network has no website login"     -> /login/ returns 200 and is the sign-in surface.
//   fork the repo + install the GitHub App  -> workbench-client.ts: "HOSTED-ONLY by construction: it never
//                                              forks, never installs, and never holds a GitHub token."
//   "drafts stay on your fork"              -> website drafts are KV records (membership-drafts.mjs).
//   "the extension upgrades it" (decrypt)   -> workbench-client.ts posts to /membership/decrypt itself.
//   "the extension account page" (profile)  -> /account/ and /workbench/ both return 200.
//   the "npm CMS (gbti-network)"            -> NEITHER `gbti-network` NOR `@gbti/client-ui` is published to
//                                              npm; both 404 at the registry. The handbook was telling
//                                              members to install something that does not exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const HANDBOOK = read('../src/pages/handbook/index.astro');
const LOGIN = read('../src/pages/login.astro');

const RETIRED = [
  ['no website login', 'the site has had a login since sow-158'],
  ['Fork the public content repository', 'the website path never forks'],
  ['npm CMS', 'gbti-network is not published to npm, so a member cannot install it'],
  ['drafts stay on your fork', 'website drafts live in the member account, not on a fork'],
  ['the extension upgrades it', 'the website decrypts member content itself'],
  ['from the extension account page', '/account/ and /workbench/ do this on the website'],
];

test('the handbook no longer carries any of the six retired claims', () => {
  for (const [needle, why] of RETIRED) {
    assert.ok(!HANDBOOK.includes(needle), `handbook reintroduced "${needle}": ${why}`);
  }
});

test('the handbook points at the website surfaces it used to omit', () => {
  // The failure this catches is subtractive: a rewrite that removes a false claim and forgets to say what
  // is true instead leaves the reader with nothing, which reads as correct because nothing is wrong.
  // Assert the HREF, not the substring. A first version of this test checked `includes('/workbench/')`
  // and SURVIVED a mutation that repointed every WorkBench link at /extension/, because the visible link
  // TEXT still reads "/workbench/". It was matching the label while the destination rotted.
  for (const href of ['/login/', '/workbench/', '/account/']) {
    assert.ok(HANDBOOK.includes(`href="${href}"`), `handbook no longer LINKS to ${href}`);
  }
});

test('the sign-in page does not send the reader to the extension for in-place editing', () => {
  // sow-271 Phase 1 made the website upgrade <gbti-edit-panel>, which turned this sentence false. It is
  // pinned here because the commit that broke it is the same commit that fixed the capability, so the
  // stale sentence and the working feature arrived together.
  assert.ok(!/To edit and publish\s+your own content in place, add the/.test(LOGIN),
    'login.astro again tells the reader in-place editing needs the extension');
  assert.match(LOGIN, /works here on the site/, 'login.astro should say editing works on the site');
});

test('the extension is described as optional, not as the way in', () => {
  assert.match(HANDBOOK, /browser extension<\/a> is optional/,
    'the owner ruled 2026-09-03 that the extension is an optional extra; the handbook must say so');
});
