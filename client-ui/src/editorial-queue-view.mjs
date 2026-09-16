// sow-323 Phase 4: what the editorial review queue SHOWS, as pure functions.
//
// Extracted from the element for the reason share-post-core.mjs records: a decision inside a component lives
// where `node --test` cannot reach it, so the rules that matter most end up being the only ones nobody checks.
// The rules here are which rows offer a decision, what a superadmin is asked before one, and how a row reads.

import { EDITORIAL_STATE } from '../../membership/editorial-queue.mjs';

/** The word a person reads for a content type. `project` covers the retired `products` folder too. */
export function typeLabel(type) {
  return { post: 'Article', project: 'Project', prompt: 'Prompt' }[String(type ?? '')] || 'Item';
}

/**
 * Can this row be decided?
 *
 * A CORRUPT row is shown and NOT decidable, which is the same answer the Worker gives (entryState fails to
 * `unknown`, never `pending`). Showing it matters: this screen is the only surface that could notice a broken
 * record at all, and dropping it would make the failure invisible rather than absent.
 */
export function rowDecidable(item) {
  return !!item && item.corrupt !== true && item.state === EDITORIAL_STATE.pending;
}

/** How long something has been waiting, in whole days, as a person would say it. */
export function waitedFor(item, now = new Date()) {
  const at = Date.parse(String(item?.requestedAt ?? ''));
  if (!Number.isFinite(at)) return '';
  const days = Math.floor((now.getTime() - at) / 86400000);
  if (days < 0) return 'just now';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * The one line that says what a row is. Kept here rather than inlined in the template so the wording of a
 * revision is assertable: a member who reworked something a superadmin set aside is NOT a new submission, and
 * a screen that reads the same for both invites the same decision twice.
 */
export function rowSummary(item, now = new Date()) {
  const kind = typeLabel(item?.type);
  const who = item?.login ? `by ${item.login}` : 'by an unknown member';
  const when = waitedFor(item, now);
  const revised = item?.editedSinceDecision === true ? ', revised since you set it aside' : '';
  return `${kind} ${who}${when ? `, published ${when}` : ''}${revised}`;
}

/**
 * The confirmation a superadmin reads. Approving publishes to the open web and emails the author, and setting
 * something aside is silent, so the two prompts have to say different things: a superadmin who believes a
 * dismissal notifies the author will avoid using it.
 */
export function decidePrompt(item, decision) {
  const name = item?.title ? `"${item.title}"` : 'this item';
  return decision === 'approve'
    ? `Approve ${name} for the public site? It goes live within a few minutes, and its author is told.`
    : `Set ${name} aside? It stays members-only and its author is not told. They can revise it and it comes back here.`;
}

/** What the screen says after a decision lands. */
export function decidedMessage(item, decision) {
  const name = item?.title || 'that item';
  return decision === 'approve'
    ? `${name} is public within a few minutes. Its author has been told.`
    : `${name} was set aside. It stays members-only.`;
}

/**
 * The heading line: how much is actually waiting, as opposed to how many rows there are.
 *
 * WAITING MEANS DECIDABLE, which is why this counts through rowDecidable rather than reading `state` itself.
 * A malformed record can carry `state: 'pending'` and still be refused by both this screen and the Worker, so
 * counting it as waiting gives a queue that never empties with nothing on screen that explains why. It is
 * counted separately instead, where it reads as something to repair rather than something to decide.
 */
export function queueSummary(items) {
  const list = Array.isArray(items) ? items : [];
  const waiting = list.filter((i) => rowDecidable(i)).length;
  const broken = list.filter((i) => i?.corrupt === true || i?.state === EDITORIAL_STATE.unknown).length;
  if (!list.length) return 'Nothing is waiting. Member articles, projects and prompts arrive here when they are published.';
  const head = waiting === 0 ? 'Nothing is waiting for a decision.'
    : waiting === 1 ? '1 item is waiting for a decision.'
      : `${waiting} items are waiting for a decision.`;
  return broken ? `${head} ${broken === 1 ? 'One record is' : `${broken} records are`} malformed and cannot be decided.` : head;
}
