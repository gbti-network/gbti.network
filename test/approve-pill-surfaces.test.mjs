// sow-323 follow-up: a superadmin can approve a members-only item FROM THE ITEM'S OWN PAGE.
//
// Owner, 2026-10-16, looking at a live project listing that offered only Edit: "Superadmin should be able to
// approve from the listing page itself." Two separate things were wrong, and these tests pin both plus the
// gap found while fixing them.
//
//   1. THE PILL HID ITSELF WITHOUT A WEBSITE SESSION. It required the gbti_csrf cookie, which an identity
//      stamped by the EXTENSION does not carry. Hiding was the safe answer and the wrong one: the control
//      vanished with no way to tell a missing session from a missing feature, which is exactly how it was
//      reported. It now shows and says what is needed. This is UX only. The Worker re-checks superadmin on
//      every call, so showing the button to the wrong person grants nothing, and that is why the looser
//      reveal is safe.
//
//   2. TWO OF THE THREE LIVE PAGE SHAPES NEVER MOUNTED IT AT ALL. Projects and prompts had it; the two
//      article layouts a post can actually declare, Journal and Card, had an Edit link and nothing else. So
//      a members-only ARTICLE could only be approved from the admin queue. A layout added later would
//      inherit that gap silently, which is what the mount test below exists to stop.
//
// Placement is measured in a browser rather than asserted here: a class name proves nothing about where a
// pill lands. What is pinned here is that each surface mounts the component and routes its render decision
// through ONE predicate, so the row holding the pill and the pill itself cannot disagree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ARTICLE_LAYOUTS } from '../src/lib/article-page.mjs';
import { isApprovable } from '../src/lib/content-gating.mjs';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

/** Where each declarable article layout lives, so a new entry in ARTICLE_LAYOUTS reds this file. */
const LAYOUT_COMPONENT = {
  journal: 'src/components/blog/ArticleJournal.astro',
  card: 'src/components/blog/ArticleCard.astro',
};

test('only an explicitly members-only item has anything to approve', () => {
  assert.equal(isApprovable('members'), true);
  assert.equal(isApprovable('public'), false);
  // Silence is public (the schema default), so an item with no visibility must not offer the control.
  assert.equal(isApprovable(undefined), false);
  assert.equal(isApprovable(''), false);
});

test('every declarable article layout mounts the Approve pill', () => {
  for (const layout of ARTICLE_LAYOUTS) {
    const rel = LAYOUT_COMPONENT[layout];
    assert.ok(rel, `${layout} is declarable but this test does not know its component; add it`);
    const s = src(rel);
    assert.match(s, /<ApprovePill\b/, `${rel} must mount ApprovePill, or a members-only article can only be approved from the admin queue`);
    assert.match(s, /type="post"/, `${rel} must pass the post type`);
  }
});

test('the other two detail surfaces mount it too', () => {
  assert.match(src('src/pages/projects/[slug].astro'), /<ApprovePill[^>]*type="project"/);
  assert.match(src('src/pages/prompts/[slug].astro'), /<ApprovePill[^>]*type="prompt"/);
});

test('a layout that holds the pill decides the row with isApprovable, not its own copy of the test', () => {
  for (const rel of Object.values(LAYOUT_COMPONENT)) {
    const s = src(rel);
    assert.match(s, /isApprovable\(/, `${rel} must gate its tools row on the shared predicate`);
    assert.ok(
      !/visibility === 'members'/.test(s),
      `${rel} re-implements the members-only test; the row and the pill would be free to disagree`,
    );
  }
});

test('the pill itself routes through the same predicate', () => {
  const s = src('src/components/ApprovePill.astro');
  assert.match(s, /isApprovable\(visibility\)/);
  assert.ok(!/visibility === 'members'/.test(s), 'ApprovePill must not keep a second copy of the test');
});

test('a superadmin without a website session is offered the control, not hidden from it', () => {
  const s = src('src/components/ApprovePill.astro');
  // The reveal turns on being a superadmin ALONE. A cookie read in that expression is the old bug.
  assert.match(s, /btn\.hidden = !superadmin;/, 'the reveal must not depend on a cookie');
  // ... and the session is still what decides what the button says and does.
  assert.match(s, /needsSignin/, 'the missing-session state must be named on the element');
  assert.match(s, /Sign in here to approve/, 'and it must say what is needed');
});
