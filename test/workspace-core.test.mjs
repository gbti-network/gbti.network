// SOW-033: the pure PR classifier behind the member workspace PR tab. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPull, parseWorkspaceTab } from '../client-ui/src/workspace-core.mjs';

test('merged PR -> Accepted (regardless of gate status)', () => {
  assert.deepEqual(classifyPull({ merged: true }, null), { label: 'Accepted', tone: 'ok' });
  assert.deepEqual(classifyPull({ state: 'merged' }, { state: 'failure' }), { label: 'Accepted', tone: 'ok' });
});

test('closed-unmerged PR -> Declined', () => {
  assert.deepEqual(classifyPull({ state: 'closed' }, null), { label: 'Declined', tone: 'muted' });
  assert.deepEqual(classifyPull({ state: 'closed', merged: false }, { state: 'success' }), { label: 'Declined', tone: 'muted' });
});

test('open PR maps the gate status to Proposed / Needs changes / Error', () => {
  assert.deepEqual(classifyPull({ state: 'open' }, { state: 'success' }), { label: 'Proposed', tone: 'ok' });
  assert.deepEqual(classifyPull({ state: 'open' }, { state: 'failure' }), { label: 'Needs changes', tone: 'bad' });
  assert.deepEqual(classifyPull({ state: 'open' }, { state: 'error' }), { label: 'Error', tone: 'bad' });
  // pending / unknown / not-yet-loaded -> Proposed (still checking), never a crash
  assert.deepEqual(classifyPull({ state: 'open' }, { state: 'pending' }), { label: 'Proposed', tone: '' });
  assert.deepEqual(classifyPull({ state: 'open' }, null), { label: 'Proposed', tone: '' });
  assert.deepEqual(classifyPull({}, undefined), { label: 'Proposed', tone: '' });
});

test('merged takes precedence over a closed flag', () => {
  assert.deepEqual(classifyPull({ state: 'closed', merged: true }, null), { label: 'Accepted', tone: 'ok' });
});

// SOW-036 P4: the workspace deep-link tab hint.
test('parseWorkspaceTab reads a valid tab from the hash (leading # optional, extra params ignored)', () => {
  assert.equal(parseWorkspaceTab('#tab=prompt'), 'prompt');
  assert.equal(parseWorkspaceTab('tab=product'), 'product');
  assert.equal(parseWorkspaceTab('#tab=prs&foo=1'), 'prs');
  assert.equal(parseWorkspaceTab('#x=1&tab=inbox'), 'inbox');
  assert.equal(parseWorkspaceTab('#tab=post'), 'post');
  // SOW-037: the Saved + Subscriptions tabs are deep-linkable too.
  assert.equal(parseWorkspaceTab('#tab=saved'), 'saved');
  assert.equal(parseWorkspaceTab('#tab=subs'), 'subs');
});

test('parseWorkspaceTab returns null for an absent / unknown / malformed tab (caller defaults to post)', () => {
  for (const h of ['', '#', undefined, null, '#tab=', '#tab=bogus', '#tab=POST', '#read=x', '#tabbed=post']) {
    assert.equal(parseWorkspaceTab(h), null, `${JSON.stringify(h)} -> null`);
  }
});
