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
import { GbtiActivityBell } from '../client-ui/src/elements/gbti-activity-bell.mjs';
import { GbtiAccount } from '../client-ui/src/elements/gbti-account.mjs';
import { GbtiNews } from '../client-ui/src/elements/gbti-news.mjs';

// SOW-043: the news element renders the inert (no-client) + loading/locked paths without throwing.
test('gbti-news: render() on a fresh (un-init) instance does not throw', () => {
  const el = new GbtiNews();
  assert.doesNotThrow(() => el.render());          // no client -> open-in-client notice
  el._state = 'locked'; assert.doesNotThrow(() => el.render());
  el._state = 'ready'; el._items = []; assert.doesNotThrow(() => el.render());
});

// SOW-040: the account element renders the inert (no-client) + loading paths without throwing.
test('gbti-account: render() on a fresh (un-init) instance does not throw', () => {
  const el = new GbtiAccount();
  assert.doesNotThrow(() => el.render());            // no client -> sign-in nudge
  el._loaded = true; el._status = { authenticated: false };
  assert.doesNotThrow(() => el.render());            // loaded, signed out
});

// SOW-042: the bell auto-mounts in the shell bar on every extension page, so a render throw before its state is
// initialized would blank the whole top bar. Assert a fresh instance renders (loading + gated paths) safely.
test('gbti-activity-bell: render() on a fresh (un-init) instance does not throw', () => {
  const el = new GbtiActivityBell();
  assert.doesNotThrow(() => el.render());                 // loading: this._bell/_gated undefined
  el._gated = true; assert.doesNotThrow(() => el.render()); // gated -> hidden, empty shadow
  el._gated = false; el._bell = { total: 0, groups: [] }; el._open = true;
  assert.doesNotThrow(() => el.render());                  // open panel with no items
});

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
