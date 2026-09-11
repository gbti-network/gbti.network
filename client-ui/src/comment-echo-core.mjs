// The author's own pending comments (SOW-076 echoes) as the site shows them, pure and node-tested: which rows of
// a merged thread are still in flight, what a pending row's status note says, and how a pull-request list
// answers "did it merge". The website's <gbti-comment-echoes> and the reader's <gbti-discussion> both read
// these, so the two hosts word a pending comment the same way.
//
// Owner, 2026-09-11: a comment took "several minutes" to appear because the website never showed the echo the
// npm and extension hosts had shown since SOW-076; the author should see their own comment as if it had landed,
// with a note about its merge status. The merge itself is fast (auto-merge in seconds); the wait is the site
// rebuild, which is why the note names the rebuild rather than the merge.

/** The rows a merged thread marks as still in flight (mergeCommentEchoes tags them _pending). */
export function pendingRows(items) {
  return (Array.isArray(items) ? items : []).filter((c) => c && c._pending);
}

/** 'merged' | 'closed' | 'open' | 'unknown' for one PR number, from a my-pulls style list ({ number, state, merged }). */
export function pullOutcome(pulls, number) {
  const n = Number(number);
  const pr = (Array.isArray(pulls) ? pulls : []).find((p) => p && Number(p.number) === n);
  if (!pr) return 'unknown';
  if (pr.merged === true || pr.state === 'merged') return 'merged';
  if (pr.state === 'closed') return 'closed';
  return 'open';
}

/**
 * The status note under a pending row. `terminal` says polling can stop. The copy states what actually
 * happens: the merge is automatic and quick, the rebuild is the wait.
 */
export function echoNote({ outcome = 'unknown', prNumber = null } = {}) {
  const pr = prNumber ? `Pull request #${prNumber}` : 'Its pull request';
  if (outcome === 'merged') return { text: 'Merged. Everyone sees this after the next site rebuild, in about 2 to 3 minutes.', tone: 'ok', terminal: true };
  if (outcome === 'closed') return { text: 'This comment was declined. Track it in your WorkBench.', tone: 'bad', terminal: true };
  return { text: `Posting. ${pr} merges automatically; everyone sees this after the site rebuilds, in about 2 to 3 minutes.`, tone: 'pending', terminal: false };
}

/** The pull list shapes the two hosts return ({ prs } on the extension client, { items } on the website Worker read). */
export function pullsOf(res) {
  if (Array.isArray(res?.prs)) return res.prs;
  if (Array.isArray(res?.items)) return res.items;
  return Array.isArray(res) ? res : [];
}
