// sow-293: the superadmin "make this public" control.
//
// The control is an affordance and the Worker is the boundary, so a wrong answer here shows the wrong button
// rather than granting anything. That makes the ROLE clause the one worth being strict about, and the
// asymmetry with the visibility clause worth pinning: an unknown role must deny, an unknown visibility must
// not, and a future reader who "makes them consistent" should fail here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oneClickPublicView, makePublicRequest, makePublicPrompt, ONE_CLICK_STATES } from '../client-ui/src/one-click-public-core.mjs';

const view = (o) => oneClickPublicView(o);
const PATH = 'members/ada/posts/hello/index.md';

test('only a superadmin sees the control, and an UNRESOLVED role is not a superadmin', () => {
  // The editor establishes this by probing client.authorTargets(), which throws or returns nothing for a
  // plain member and for a host that has not wired the capability. Every one of those is "not a superadmin".
  assert.equal(view({ isSuperadmin: true, visibility: 'members', itemPath: PATH }), 'available');
  for (const role of [false, null, undefined, 0, '', 'yes', 'true', 1, {}, []]) {
    assert.equal(
      view({ isSuperadmin: role, visibility: 'members', itemPath: PATH }), 'hidden',
      `isSuperadmin ${JSON.stringify(role)} must not see the control`,
    );
  }
  // Strictly true, not truthy: a probe that returns a non-empty object must not read as a role.
  assert.equal(view({ isSuperadmin: 'superadmin', visibility: 'members', itemPath: PATH }), 'hidden');
});

test('an item with no path has nothing to flip', () => {
  // A new item that was never saved has no frontmatter to rewrite and no path to open a PR against. The
  // author sets visibility in the form instead.
  for (const p of [null, undefined, '', '   ', 42, {}]) {
    assert.equal(view({ isSuperadmin: true, visibility: 'members', itemPath: p }), 'hidden', `path ${JSON.stringify(p)}`);
  }
});

test('an already-public item REPORTS that, rather than hiding the control', () => {
  // A silently absent control reads as a bug. Reporting lets a superadmin tell "does not apply here" apart
  // from "did not load".
  assert.equal(view({ isSuperadmin: true, visibility: 'public', itemPath: PATH }), 'already-public');
});

test('an UNKNOWN visibility still offers the control, and that asymmetry is deliberate', () => {
  // This is the clause a future reader is most likely to "fix" into a fail-closed one to match the role
  // check. It should not be: an unknown role is a permission question and must deny; an unknown visibility
  // is not, and the worst case is a no-op diff on something already public.
  for (const v of [null, undefined, '', 'members', 'nonsense', 'PUBLIC', 'Public', 0]) {
    assert.equal(
      view({ isSuperadmin: true, visibility: v, itemPath: PATH }), 'available',
      `visibility ${JSON.stringify(v)} must still offer the control`,
    );
  }
  // Only the exact stored value counts as public, so a near-miss offers the control rather than suppressing
  // it. That is the same fail-closed-on-the-real-question rule the content guards use.
});

test('sow-323: the control asks the WORKER to approve, and names the item by path', () => {
  // It stopped editing the open document. The editor holds a members-only item whose body is a teaser, so
  // submitting what is on screen with `visibility: public` published the teaser and orphaned the real body.
  // What travels now is the item's path, and the Worker rebuilds the file from what is on main.
  assert.deepEqual(makePublicRequest('members/ada/posts/hello/index.md'),
    { path: 'members/ada/posts/hello/index.md', decision: 'approve' });
  assert.deepEqual(Object.keys(makePublicRequest('members/ada/posts/hello/index.md')), ['path', 'decision'],
    'exactly two fields, or this control carries something the route did not ask for');
  for (const bad of [null, undefined, '', '   ', 42]) {
    assert.equal(makePublicRequest(bad), null, `an unsaved item has no path to approve: ${JSON.stringify(bad)}`);
  }
});

test('the confirmation names the item and says what actually happens', () => {
  const withTitle = makePublicPrompt('My Article');
  assert.match(withTitle, /"My Article"/);
  assert.match(withTitle, /within a few minutes/, 'the reader must know it is not live the instant they click');
  assert.match(withTitle, /author is told/, 'and that this sends the author an email');
  // A missing or blank title degrades to a generic noun rather than rendering "" or "undefined".
  for (const t of [null, undefined, '', '   ', 42]) {
    const p = makePublicPrompt(t);
    assert.match(p, /this item/, `title ${JSON.stringify(t)} must degrade to a generic noun`);
    assert.ok(!/undefined|null|""/.test(p), `title ${JSON.stringify(t)} leaked into the prompt: ${p}`);
  }
});

test('every returned state is a declared one', () => {
  const seen = new Set();
  for (const role of [true, false]) {
    for (const v of ['public', 'members', null]) {
      for (const p of [PATH, null]) seen.add(view({ isSuperadmin: role, visibility: v, itemPath: p }));
    }
  }
  for (const s of seen) assert.ok(ONE_CLICK_STATES.includes(s), `undeclared state ${s}`);
  assert.deepEqual([...seen].sort(), ['already-public', 'available', 'hidden'], 'all three states must be reachable, or one is dead');
});

// The two integration invariants. These are SOURCE assertions, which is weaker than driving the element, and
// they are here because the alternative is nothing: the editor is 1800 lines of DOM and its decisions are
// unreachable from node --test, which is exactly why the decision core above was extracted in the first place.
// They pin the two things that would silently undo the design.
test('the control renders ONLY inside the superadmin-gated Author section', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-content-editor.mjs', import.meta.url), 'utf8');

  // `authorMembers` is the superadmin signal: client.authorTargets() only ever resolves for one. The control
  // sits inside that branch so there is no SECOND, weaker role test that could drift away from this one.
  const branch = /const ownerFieldHtml = authorMembers \? \(\(\) => \{([\s\S]*?)\n    \}\)\(\)/.exec(src);
  assert.ok(branch, 'the authorMembers branch was not found: this check is broken, not the subject');
  assert.match(branch[1], /id="makepublic"/, 'the control must render inside the superadmin-gated branch');

  // And nowhere else. One render site, one click wiring, and nothing outside the branch.
  const renders = [...src.matchAll(/id="makepublic"/g)].length;
  assert.equal(renders, 1, `the control renders in ${renders} places; it must render in exactly one`);
});

test('sow-323: one-click public APPROVES, and never republishes the open document', async () => {
  // THIS ASSERTION WAS REVERSED ON 2026-09-15, and the reversal is the point. It used to require that
  // _makePublic delegate to doPublish, on the reasoning that one publish path is better than two. That was
  // right about paths and wrong about this one: the editor is holding a members-only item whose body is a
  // TEASER, and the real body is encrypted where only the Worker can read it. Publishing what is on screen
  // therefore published the teaser as the whole article, left the ciphertext orphaned, kept `publicStub`
  // beside `public` (which the content check refuses) and restamped the dates. Approval is a Worker job now.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-content-editor.mjs', import.meta.url), 'utf8');
  const fn = /async _makePublic\(\) \{([\s\S]*?)\n  \}/.exec(src);
  assert.ok(fn, '_makePublic was not found: this check is broken, not the subject');

  assert.match(fn[1], /decideEditorial/, '_makePublic must call the editorial approval route');
  assert.ok(!/this\.doPublish\(\)/.test(fn[1]),
    'publishing the open document here publishes the teaser and orphans the encrypted body');
  assert.ok(!/data-key="visibility"/.test(fn[1]),
    'it must not write the visibility field either: the Worker decides what the approved file says');
});
