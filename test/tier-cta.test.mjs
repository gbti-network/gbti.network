// sow-293: the membership card's call to action.
//
// ONE RULE MATTERS MORE THAN THE REST: Content Creator must never reach checkout. It became apply-only on
// 2026-08-29 and has no price to check out against, so a checkout hand-off would send a member to Stripe for
// a product that does not exist. This decision used to live inside a component script, where no test could
// reach it, which is the same reason share-post-core.mjs exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tierCta, TIER_RANK, CREATOR_APPLICATION_PATH } from '../src/lib/tier-cta.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const STATES = [
  { signedIn: false, myTier: 'none' },
  { signedIn: true, myTier: 'none' },
  { signedIn: true, myTier: 'member' },
  // Unresolved / junk tiers: the card still renders for these, so they are part of the space.
  { signedIn: true, myTier: null },
  { signedIn: true, myTier: '' },
  { signedIn: true, myTier: 'nonsense' },
  { signedIn: false, myTier: 'creator' },
];

// sow-323: the two cases that pinned the apply-only branch are GONE, with the branch. sow-293 made the Curator
// card route to an application page and never to a checkout; the owner then collapsed the two paid plans on
// 2026-09-12, so no pricing surface offers that tier at all and offeredTiers filters it out before render.
// What replaces them is the assertion that matters now: no reachable card can send a viewer to the retired
// application page, whatever their state.
test('no OFFERED card routes a viewer to the retired application page, in any viewer state', () => {
  for (const key of ['none', 'member']) {
    for (const st of [...STATES, { signedIn: true, myTier: 'creator' }]) {
      const cta = tierCta({ key, label: 'Network Supporter', ...st });
      assert.notEqual(cta.href, CREATOR_APPLICATION_PATH, `${key} in state ${JSON.stringify(st)}`);
      assert.doesNotMatch(String(cta.text), /^Apply to become a/, `${key} in state ${JSON.stringify(st)}`);
    }
  }
  // and the branch itself is gone from the source, not merely unreachable by these inputs
  assert.doesNotMatch(read('src/lib/tier-cta.mjs'), /if \(key === 'creator'\)/);
});

test('somebody who already holds Content Creator is not invited to apply for it', () => {
  const cta = tierCta({ key: 'creator', label: 'Content Creator', signedIn: true, myTier: 'creator' });
  assert.equal(cta.text, 'Your current plan');
  assert.equal(cta.disabled, true);
  assert.equal(cta.href, null);
  assert.notEqual(cta.href, CREATOR_APPLICATION_PATH, 'holding the tier must outrank the apply-only branch');
});

test('the Network Member card keeps its checkout, so this change did not disable paying', () => {
  // The other half. It would be easy to close the creator route and take the member route with it.
  const signedOut = tierCta({ key: 'member', label: 'Network Member', signedIn: false, myTier: 'none' });
  assert.equal(signedOut.checkout, false, 'signed out, the member CTA creates an account first');
  assert.match(signedOut.href, /^\/login\/\?return_to=/);
  assert.match(decodeURIComponent(signedOut.href), /plan=member/);

  const signedIn = tierCta({ key: 'member', label: 'Network Member', signedIn: true, myTier: 'none' });
  assert.equal(signedIn.checkout, true, 'a signed-in visitor below member tier still reaches checkout');
  assert.equal(signedIn.href, null, 'checkout and href are mutually exclusive');

  const holder = tierCta({ key: 'member', label: 'Network Member', signedIn: true, myTier: 'member' });
  assert.equal(holder.disabled, true);
  // sow-316: the wording names the VIEWER's tier from the label the caller passes (the registry's), never a
  // literal here, so the rename to Curator reached this line without an edit to it. With no label it falls
  // back to "your plan" rather than inventing a name.
  const above = tierCta({ key: 'member', label: 'Network Member', signedIn: true, myTier: 'creator', myTierLabel: 'Curator' });
  assert.equal(above.disabled, true);
  assert.match(above.text, /Included in Curator/);
  assert.doesNotMatch(above.text, /Network Member/, 'the card label is not the viewer\'s tier');
  const unnamed = tierCta({ key: 'member', label: 'Network Member', signedIn: true, myTier: 'creator' });
  assert.equal(unnamed.text, 'Included in your plan');
});

test('the free card is a static account link at every state, and never checks out', () => {
  for (const st of [...STATES, { signedIn: true, myTier: 'creator' }]) {
    const cta = tierCta({ key: 'none', label: 'Free', ...st });
    assert.equal(cta.checkout, false);
    assert.equal(cta.href, '/login/');
  }
});

test('checkout and href are never both set, whatever the tier or state', () => {
  // The renderer picks one or the other; a result carrying both would make which one wins depend on the
  // call site rather than on this function.
  for (const key of ['none', 'member', 'creator', 'nonsense']) {
    for (const st of [...STATES, { signedIn: true, myTier: 'creator' }]) {
      const cta = tierCta({ key, label: key, ...st });
      assert.ok(!(cta.checkout && cta.href), `both set for ${key} in ${JSON.stringify(st)}`);
      if (cta.disabled) assert.equal(cta.href, null, 'a disabled CTA must carry no link');
    }
  }
  assert.deepEqual(TIER_RANK, { none: 0, member: 1, creator: 2 });
});
