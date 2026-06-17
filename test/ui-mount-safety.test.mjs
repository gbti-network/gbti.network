// SOW-031/033 regression: a component whose connectedCallback overrides the base must not let the base's
// synchronous render() (base.mjs connectedCallback -> this.render()) throw before the subclass initializes the
// state render() reads. gbti-browse + gbti-workspace previously called super.connectedCallback() BEFORE setting
// this._cache/_tab, so the first render dereferenced undefined[undefined] and threw, aborting the whole mount
// (and the deep-link auto-open). These instantiate the elements in a DOM-free node env (base.mjs HAS_DOM=false,
// so set()/$$ are inert) and assert render()/_body() on a freshly-constructed instance never throw and return a
// string — the exact path the node suite could not previously reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GbtiBrowse } from '../client-ui/src/elements/gbti-browse.mjs';
import { GbtiWorkspace } from '../client-ui/src/elements/gbti-workspace.mjs';

test('gbti-browse: render()/_renderBody() on a fresh (un-init) instance do not throw', () => {
  const el = new GbtiBrowse();
  // SOW-041: the content body now MOUNTS a <gbti-card-list> (no string-returning _body); both paths must stay
  // safe before connectedCallback sets this._cache/_tab (the bug this regression guards).
  assert.doesNotThrow(() => el.render());      // previously threw: this._cache[this._tab]
  assert.doesNotThrow(() => el._renderBody());
});

test('gbti-workspace: render()/_body() on a fresh (un-init) instance do not throw, return a string', () => {
  const el = new GbtiWorkspace();
  assert.equal(typeof el._body(), 'string'); // previously threw: this._cache[tab.type] with tab undefined
  assert.doesNotThrow(() => el.render());
});
