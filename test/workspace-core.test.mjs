// SOW-033: the pure PR classifier behind the member workspace PR tab. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPull, classifyDraft, prLifecycle, submitAck, failHint, shouldPollPr, parseWorkspaceTab, parseWorkspaceNew, parseWorkspaceEdit, parseWorkspaceDraft, typeForContentPath } from '../client-ui/src/workspace-core.mjs';

test('merged PR -> Accepted (regardless of gate status)', () => {
  assert.deepEqual(classifyPull({ merged: true }, null), { label: 'Accepted', tone: 'ok' });
  assert.deepEqual(classifyPull({ state: 'merged' }, { state: 'failure' }), { label: 'Accepted', tone: 'ok' });
});

test('closed-unmerged PR -> Declined', () => {
  assert.deepEqual(classifyPull({ state: 'closed' }, null), { label: 'Declined', tone: 'muted' });
  assert.deepEqual(classifyPull({ state: 'closed', merged: false }, { state: 'success' }), { label: 'Declined', tone: 'muted' });
});

// SOW-082: classifyDraft layers the fork-staged lifecycle on top of classifyPull.
test('classifyDraft: no PR -> Staged (the draft lives on the fork only)', () => {
  assert.deepEqual(classifyDraft({ pull: null }), { state: 'staged', label: 'Staged', tone: '' });
  assert.deepEqual(classifyDraft({}), { state: 'staged', label: 'Staged', tone: '' });
});

test('classifyDraft: a PR maps to Submitted / Needs changes / Published / Declined', () => {
  assert.deepEqual(classifyDraft({ pull: { state: 'open' }, status: { state: 'success' } }), { state: 'review', label: 'Submitted', tone: 'ok' });
  assert.deepEqual(classifyDraft({ pull: { state: 'open' }, status: { state: 'failure' } }), { state: 'review', label: 'Needs changes', tone: 'bad' });
  assert.deepEqual(classifyDraft({ pull: { state: 'open' }, status: null }), { state: 'review', label: 'Submitted', tone: '' });
  assert.deepEqual(classifyDraft({ pull: { merged: true } }), { state: 'published', label: 'Published', tone: 'ok' });
  assert.deepEqual(classifyDraft({ pull: { state: 'closed' } }), { state: 'declined', label: 'Declined', tone: 'muted' });
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

// SOW-072 P2: prLifecycle layers phase + needsAttention + the gate REASON on classifyPull, so a rejection is never
// silent. The label/tone come from classifyPull; the tone is raised to 'bad' for any state the author must act on.
test('prLifecycle: a merged PR is accepted, no attention, no reason', () => {
  const r = prLifecycle({ merged: true }, null);
  assert.equal(r.phase, 'accepted');
  assert.equal(r.label, 'Accepted');
  assert.equal(r.needsAttention, false);
  assert.equal(r.reason, '');
});

test('prLifecycle: a CLOSED PR is rejected + needs attention + carries the gate reason (or a fallback)', () => {
  const withReason = prLifecycle({ state: 'closed' }, { state: 'failure', description: 'rejected-not-paid: publishing is paid-only' });
  assert.equal(withReason.phase, 'rejected');
  assert.equal(withReason.label, 'Declined');
  assert.equal(withReason.tone, 'bad'); // surfaced, not muted
  assert.equal(withReason.needsAttention, true);
  assert.match(withReason.reason, /paid-only/);
  // closed with no status still gives a plain-language reason, never silence
  const noStatus = prLifecycle({ state: 'closed' }, null);
  assert.equal(noStatus.needsAttention, true);
  assert.match(noStatus.reason, /closed without merging/);
  // review fix: a manually-closed PASSING PR must NOT show the success gate message as the "why declined"
  const closedPassing = prLifecycle({ state: 'closed' }, { state: 'success', description: 'paid member own-folder content' });
  assert.equal(closedPassing.phase, 'rejected');
  assert.match(closedPassing.reason, /closed without merging/);
  assert.doesNotMatch(closedPassing.reason, /own-folder/);
});

test('prLifecycle: an open PR whose gate fails is blocked + needs attention with the reason', () => {
  const failed = prLifecycle({ state: 'open' }, { state: 'failure', description: 'changes requested' });
  assert.equal(failed.phase, 'blocked');
  assert.equal(failed.label, 'Needs changes');
  assert.equal(failed.tone, 'bad');
  assert.equal(failed.needsAttention, true);
  assert.equal(failed.reason, 'changes requested');
  // a fallback reason when the gate gives no description
  assert.match(prLifecycle({ state: 'open' }, { state: 'failure' }).reason, /holding this until it passes/);
  assert.match(prLifecycle({ state: 'open' }, { state: 'error' }).reason, /errored/);
});

test('prLifecycle: an open, passing/checking PR is pending — no attention, no nag', () => {
  for (const status of [{ state: 'success' }, { state: 'pending' }, null]) {
    const r = prLifecycle({ state: 'open' }, status);
    assert.equal(r.phase, 'pending');
    assert.equal(r.needsAttention, false);
    assert.equal(r.reason, '');
  }
});

// SOW-072 P2: submitAck is the one consistent submission confirmation.
test('submitAck: states the real auto-merge flow + the WorkBench, with the PR number when known', () => {
  const auto = submitAck({ prNumber: 42 });
  assert.match(auto, /PR #42/);
  assert.match(auto, /merges automatically/);
  assert.match(auto, /WorkBench/);
  assert.match(submitAck({ prNumber: 7, autoMerge: false }), /awaiting review/);
  // no PR number yet -> no dangling "#"
  assert.doesNotMatch(submitAck({}), /#/);
});

// SOW-072 P3: failHint maps an error to consistent guidance (message + upgrade pointer + retryable).
test('failHint: membership-required upgrades (not retryable); auth fails to sign-in; others retry', () => {
  const paid = failHint({ code: 'membership-required', message: 'Commenting requires a paid membership.' });
  assert.equal(paid.upgrade, true);
  assert.equal(paid.retryable, false);
  assert.match(paid.text, /paid membership/);
  assert.deepEqual(failHint({ code: 'no-identity' }), { text: 'Sign in with the GBTI client first.', upgrade: false, retryable: false });
  assert.equal(failHint({ code: 'invalid-content', message: 'Title is required.' }).retryable, true);
  const net = failHint({ message: 'network down' });
  assert.equal(net.retryable, true);
  assert.equal(net.upgrade, false);
  assert.match(failHint(null).text, /try again/); // no error object -> a safe default
});

// SOW-072 P3: shouldPollPr keeps polling only an open, still-checking PR.
test('shouldPollPr: poll a pending PR, stop on accepted/rejected/blocked', () => {
  assert.equal(shouldPollPr({ phase: 'pending' }), true);
  for (const phase of ['accepted', 'rejected', 'blocked']) assert.equal(shouldPollPr({ phase }), false, `${phase} stops polling`);
  assert.equal(shouldPollPr(null), false);
  // it composes with prLifecycle: an open+checking PR polls; a merged one does not
  assert.equal(shouldPollPr(prLifecycle({ state: 'open' }, { state: 'pending' })), true);
  assert.equal(shouldPollPr(prLifecycle({ merged: true }, null)), false);
  assert.equal(shouldPollPr(prLifecycle({ state: 'closed' }, null)), false);
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
  assert.equal(parseWorkspaceTab('#tab=drafts'), 'drafts'); // SOW-082: the fork-staged Drafts tab
});

test('SOW-064: parseWorkspaceNew reads a valid #new=<type>; null otherwise', () => {
  assert.equal(parseWorkspaceNew('#new=post'), 'post');
  assert.equal(parseWorkspaceNew('new=prompt'), 'prompt');
  assert.equal(parseWorkspaceNew('#new=product&x=1'), 'product');
  assert.equal(parseWorkspaceNew('#new=profile'), null); // profile is not a quick-create content type
  assert.equal(parseWorkspaceNew('#new=bogus'), null);
  assert.equal(parseWorkspaceNew('#tab=post'), null); // a tab hash is not a new-target
  assert.equal(parseWorkspaceNew(''), null);
});

test('parseWorkspaceTab returns null for an absent / unknown / malformed tab (caller defaults to post)', () => {
  for (const h of ['', '#', undefined, null, '#tab=', '#tab=bogus', '#tab=POST', '#read=x', '#tabbed=post']) {
    assert.equal(parseWorkspaceTab(h), null, `${JSON.stringify(h)} -> null`);
  }
});

// SOW-106 QA fix: the editor deep-link vocabulary (refresh restores the open editor).
test('parseWorkspaceEdit: accepts only canonical content paths (encoded); everything else is null', () => {
  const p = 'members/alice/prompts/scope-of-work-claude-code-skill/index.md';
  assert.equal(parseWorkspaceEdit(`#tab=prompt&edit=${encodeURIComponent(p)}`), p);
  assert.equal(parseWorkspaceEdit(`#edit=${encodeURIComponent('members/alice/profile.md')}`), 'members/alice/profile.md');
  assert.equal(parseWorkspaceEdit(`#edit=${encodeURIComponent('house/roles.yml')}`), null); // never an arbitrary file
  assert.equal(parseWorkspaceEdit(`#edit=${encodeURIComponent('members/alice/../../secrets')}`), null);
  assert.equal(parseWorkspaceEdit('#edit=%ZZ'), null); // malformed encoding never throws
  assert.equal(parseWorkspaceEdit('#tab=prompt'), null);
});

test('parseWorkspaceDraft: `draft=<type>:<slug>` with a valid type + kebab slug', () => {
  assert.deepEqual(parseWorkspaceDraft('#tab=drafts&draft=prompt:my-skill'), { type: 'prompt', slug: 'my-skill' });
  assert.equal(parseWorkspaceDraft('#draft=share:x'), null); // shares are not draftable
  assert.equal(parseWorkspaceDraft('#draft=prompt:Bad_Slug'), null);
  assert.equal(parseWorkspaceDraft(''), null);
});

test('typeForContentPath derives the content type from the path subtree', () => {
  assert.equal(typeForContentPath('members/alice/posts/x/index.md'), 'post');
  assert.equal(typeForContentPath('members/alice/products/y/index.md'), 'product');
  assert.equal(typeForContentPath('members/alice/profile.md'), null);
});
