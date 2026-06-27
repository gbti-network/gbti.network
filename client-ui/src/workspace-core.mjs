// SOW-033: pure classifier for the member workspace PR tab. Maps a pull request + its gate status to a
// member-facing label, reusing the SOW-005 gate vocabulary (interpretGateState: success=mergeable,
// pending=checking, failure=held, error). Node-free so it unit-tests without a DOM.
//
// pr: { number, title, html_url, state?, merged? } (state/merged come from the SOW-033 P4 my-pulls extension;
//   today's open-only list omits them, so an open PR with no status is "Proposed, checking").
// status: { state, meaning, description } from client.prStatus(), or null if not loaded / unreachable.

// SOW-036: the workspace deep-link tab hint. The avatar menu opens workspace.html#tab=<id>; <gbti-workspace>
// reads the hash on connect to open directly on that management tab. Returns a valid tab id, or null when the hash
// carries no/unknown tab (the caller defaults to 'post'). Kept in lockstep with the TABS list in gbti-workspace.
const WORKSPACE_TABS = new Set(['overview', 'post', 'prompt', 'product', 'drafts', 'prs', 'inbox', 'saved', 'subs', 'earnings']);
export function parseWorkspaceTab(hash) {
  const m = String(hash || '').replace(/^#/, '').match(/(?:^|&)tab=([a-z]+)(?:&|$)/);
  return m && WORKSPACE_TABS.has(m[1]) ? m[1] : null;
}

// SOW-064: the quick-create deep-link. The "+" menu opens workspace.html#new=<type>; <gbti-workspace> reads it on
// connect to open a BLANK content editor for that type (start a new article/prompt/product). Returns a valid
// content type, or null when the hash carries no/unknown new-target.
const WORKSPACE_NEW_TYPES = new Set(['post', 'prompt', 'product']);
export function parseWorkspaceNew(hash) {
  const m = String(hash || '').replace(/^#/, '').match(/(?:^|&)new=([a-z]+)(?:&|$)/);
  return m && WORKSPACE_NEW_TYPES.has(m[1]) ? m[1] : null;
}

export function classifyPull(pr = {}, status = null) {
  if (pr.merged === true || pr.state === 'merged') return { label: 'Accepted', tone: 'ok' };
  if (pr.state === 'closed') return { label: 'Declined', tone: 'muted' };
  switch (status?.state) {
    case 'success': return { label: 'Proposed', tone: 'ok' };        // mergeable / auto-merging
    case 'failure': return { label: 'Needs changes', tone: 'bad' };  // held / rejected-not-paid / changes requested
    case 'error': return { label: 'Error', tone: 'bad' };
    default: return { label: 'Proposed', tone: '' };                 // open + pending/unknown (still checking)
  }
}

// SOW-072 P2: the ONE authoring-lifecycle model, layered on classifyPull so every surface (the composer ack, the
// workspace PR tab, the activity bell) speaks the same states AND surfaces a rejection with its reason — never
// silence. Maps a PR + its gate status to:
//   phase: 'pending' (open, checking / awaiting) | 'accepted' (merged, going live) | 'rejected' (closed, not merged)
//          | 'blocked' (open but the gate fails: needs changes / error).
//   label, tone: from classifyPull (the shared five-state vocabulary), with the tone raised to 'bad' whenever the
//          author must act, so a rejection is visibly flagged instead of muted.
//   needsAttention: true when the author should look (rejected/closed, needs-changes, error) -> drives the bell badge.
//   reason: the gate status description (why), or a plain-language fallback for the attention states so the author
//          is never left guessing. Empty for a clean pending/accepted PR. Pure; node-testable.
export function prLifecycle(pull = {}, status = null) {
  const c = classifyPull(pull, status);
  const merged = pull.merged === true || pull.state === 'merged';
  const closed = !merged && pull.state === 'closed';
  let phase;
  if (merged) phase = 'accepted';
  else if (closed) phase = 'rejected';
  else if (c.label === 'Needs changes' || c.label === 'Error') phase = 'blocked';
  else phase = 'pending';
  const needsAttention = phase === 'rejected' || phase === 'blocked';
  const desc = status && typeof status.description === 'string' ? status.description.trim() : '';
  const fallback = phase === 'rejected' ? 'This request was closed without merging.'
    : c.label === 'Error' ? 'The membership gate check errored; it will retry.'
    : c.label === 'Needs changes' ? 'The membership gate is holding this until it passes.'
    : '';
  return {
    label: c.label,
    tone: needsAttention ? 'bad' : c.tone,
    phase,
    needsAttention,
    reason: needsAttention ? (desc || fallback) : desc,
  };
}

// SOW-082: a fork-staged draft's lifecycle state. A draft is identified by its deterministic branch
// gbti/<type>-<slug> on the member's fork; its state joins "branch exists" with the PR (if any) for that branch.
// `pull` is the matched PR ({ state, merged }) or null (no PR yet = still staged on the fork). Reuses classifyPull
// for the PR half. Pure; node-testable.
export function classifyDraft({ pull = null, status = null } = {}) {
  if (!pull) return { state: 'staged', label: 'Staged', tone: '' }; // branch on the fork, no PR opened yet
  const c = classifyPull(pull, status);
  if (c.label === 'Accepted') return { state: 'published', label: 'Published', tone: 'ok' };
  if (c.label === 'Declined') return { state: 'declined', label: 'Declined', tone: 'muted' };
  // an open PR: it has been submitted to the network and is moving through the gate
  return { state: 'review', label: c.label === 'Proposed' ? 'Submitted' : c.label, tone: c.tone };
}
