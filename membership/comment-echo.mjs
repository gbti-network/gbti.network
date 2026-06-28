// SOW-076 (instant-feel actions): the PURE consistency core for the comments fast path. A comment is written to KV
// the MOMENT a member submits it (an "echo"), so it appears in <1s, while its SOW-072 PR auto-merges + the site
// rebuilds behind it (the durable, encrypted git record, eventual consistency). This module merges the optimistic
// echoes with the deployed (git/static) comments for read-your-writes, and decides which echoes to REAP:
//   - git is the source of truth: once a comment is in the DEPLOYED build, its echo is redundant -> reap.
//   - an echo persists until it is deployed OR its PR is CLOSED/declined (a phantom that never lands) -> reap.
//   - a merged-but-not-yet-deployed echo is KEPT (so the comment never blinks out during the ~2-min deploy gap).
// Node-free + side-effect-free (the KV read/write, the PR-status lookup, and the reconcile KV->git sync wrap it), so
// it unit-tests with no IO. Tying the echo lifetime to the PR outcome is what prevents a phantom comment.

const byTime = (a, b) => String(a?.createdAt || a?.postedAt || '').localeCompare(String(b?.createdAt || b?.postedAt || ''));

/**
 * Merge optimistic comment echoes with the deployed comments for one target thread.
 * @param {object} a
 * @param {Array}  [a.deployed]   comments from the deployed build (authoritative), each `{ id, createdAt, ... }`.
 * @param {Array}  [a.echoes]     optimistic KV echoes, each `{ id, prNumber, postedAt, ...comment }`.
 * @param {(prNumber:any)=>('open'|'merged'|'closed'|'unknown')} [a.prState]  the echo's PR outcome (default 'unknown' = still in flight).
 * @returns {{ comments: object[], reap: any[], pending: Set }} `comments` to render (deployed + still-pending echoes,
 *   deduped by id, oldest-first; each pending echo tagged `_pending: true`), `reap` = echo ids to DELETE from KV,
 *   `pending` = the set of echo ids still in flight (render them with a "posting" indicator).
 */
export function mergeCommentEchoes({ deployed = [], echoes = [], prState = () => 'unknown' } = {}) {
  const deployedIds = new Set((Array.isArray(deployed) ? deployed : []).map((c) => c && c.id).filter(Boolean));
  const reap = [];
  const pending = new Set();
  const kept = [];
  const seenEcho = new Set();
  for (const e of Array.isArray(echoes) ? echoes : []) {
    if (!e || !e.id || seenEcho.has(e.id)) continue;
    seenEcho.add(e.id);
    if (deployedIds.has(e.id)) { reap.push(e.id); continue; }          // now in the deployed build -> echo is redundant
    if (prState(e.prNumber) === 'closed') { reap.push(e.id); continue; } // PR rejected/declined -> phantom, reap
    kept.push({ ...e, _pending: true });                               // open OR merged-not-yet-deployed -> keep
    pending.add(e.id);
  }
  const comments = [...(Array.isArray(deployed) ? deployed : []), ...kept].sort(byTime);
  return { comments, reap, pending };
}
