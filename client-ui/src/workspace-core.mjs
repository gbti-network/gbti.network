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
const WORKSPACE_TABS = new Set(['overview', 'post', 'prompt', 'product', 'prs', 'inbox', 'saved', 'subs', 'earnings']);
export function parseWorkspaceTab(hash) {
  const m = String(hash || '').replace(/^#/, '').match(/(?:^|&)tab=([a-z]+)(?:&|$)/);
  return m && WORKSPACE_TABS.has(m[1]) ? m[1] : null;
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
