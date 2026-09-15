// sow-323 Phase 3: the two emails the editorial review queue sends. Pure and node-free (no fetch, no KV), so
// the copy is unit-tested without a network, exactly like coupon-notify.mjs and subscriber-notify.mjs.
//
// THERE ARE ONLY TWO, AND THE MISSING THIRD IS DELIBERATE. The owner is told when something arrives to review,
// and the author is told when their work is approved. A DISMISSAL SENDS NOTHING (owner, 2026-09-15): the item
// stays members-only, which is where every member item starts, so there is no bad news to deliver and no
// decision for the author to answer.
//
// A TITLE IS TEXT A MEMBER WROTE, so both notices escape it. The queue core already bounded it and stripped
// control characters before storage; this is the second layer, because these reach an HTML email.

import { opsEmail } from './mail-ops.mjs';
import { itemUrl } from './editorial-queue.mjs'; // ONE URL builder, shared with the queue listing

const str = (v) => (v == null ? '' : String(v));

/**
 * The owner-facing notice: one or more items are waiting for review.
 *
 * Batched rather than one email per item, because a publish can carry several items and the owner asked to be
 * told there is work, not to be mailed per file.
 *
 * @param records  the newly pending records (from newEntry), each `{ title, type, login, path, requestedAt }`.
 * @param origin   the site origin, for the link to the item.
 * @param selfTest marks the mail as a reachability probe rather than real work waiting.
 * @returns `{ subject, text, html }`. Never throws.
 */
export function editorialQueueNotice(records, { origin = 'https://gbti.network', selfTest = false } = {}) {
  const list = (Array.isArray(records) ? records : []).filter((r) => r && typeof r === 'object');
  const base = str(origin).replace(/\/$/, '');
  const author = str(list[0]?.login) || '(unknown member)';
  const one = list.length === 1;

  const subject = selfTest
    ? '[alarm self-test] Editorial review alarm is reachable'
    : one
      ? `Waiting for review: ${str(list[0]?.title) || str(list[0]?.slug)} by ${author}`
      : `${list.length} items waiting for review from ${author}`;

  const rows = list.flatMap((r) => [
    [typeLabel(r.type), `${str(r.title) || str(r.slug)} by ${str(r.login) || '(unknown member)'}`],
    ['Address', itemUrl(r.type, r.slug, base) || str(r.path)],
  ]);

  const lines = [
    selfTest
      ? 'THIS IS NOT A SUBMISSION. It is the scheduled self-test of the editorial review alarm, and the values'
      : one
        ? 'A member published something that is waiting for you to review it.'
        : `A member published ${list.length} items that are waiting for you to review them.`,
    selfTest ? 'below are synthetic. Nothing is waiting and nothing was published.' : null,
    '',
    ...list.flatMap((r) => [
      `${typeLabel(r.type)}: ${str(r.title) || str(r.slug)}`,
      `Author: ${str(r.login)}`,
      r.requestedAt ? `Published: ${str(r.requestedAt)}` : null,
      `Address: ${itemUrl(r.type, r.slug, base) || '(no page)'}`,
      `File: ${str(r.path)}`,
      '',
    ]).filter((line) => line !== null),
    'It is live for signed-in members already and is not public, not indexed and not in any public feed',
    'until you approve it. Approve or set it aside from the review queue in the admin area, or from the',
    'item\'s own page.',
  ].filter((line) => line !== null);

  const { html } = opsEmail({
    title: selfTest ? 'Editorial review alarm self-test' : one ? 'Waiting for review' : `${list.length} items waiting for review`,
    lead: selfTest ? '' : one
      ? 'A member published something that is waiting for you to review it.'
      : `A member published ${list.length} items that are waiting for you to review them.`,
    sections: [
      ...(selfTest
        ? [{
          kind: 'alert',
          text: 'THIS IS NOT A SUBMISSION. It is the scheduled self-test of the editorial review alarm, and the '
            + 'values below are synthetic. Nothing is waiting and nothing was published.',
        }]
        : []),
      { kind: 'fields', rows: rows.length ? rows : [['Nothing to show', '(no items)']] },
      { kind: 'note', text: 'It is live for signed-in members already and is not public, not indexed and not in '
        + 'any public feed until you approve it. Approve or set it aside from the review queue in the admin area, '
        + 'or from the item\'s own page.' },
    ],
    footer: selfTest
      ? 'Sent by the weekly credential-health check, not by a publish.'
      : 'Sent by the editorial review queue on the GBTI Network signup Worker.',
  });

  return { subject, text: lines.join('\n'), html };
}

/**
 * The AUTHOR-facing notice: their item was approved and is becoming public.
 *
 * @param record a decided record (state approved), `{ title, type, slug, login, decidedAt }`.
 * @param origin the site origin, for the link to the item.
 * @returns `{ subject, text, html }`. Never throws.
 */
export function editorialApprovedNotice(record, { origin = 'https://gbti.network' } = {}) {
  const title = str(record?.title) || str(record?.slug) || 'your submission';
  const base = str(origin).replace(/\/$/, '');
  const url = itemUrl(record?.type, record?.slug, base) || base;

  const subject = `Approved for the public site: ${title}`;
  const lines = [
    `Your ${typeLabel(record?.type).toLowerCase()} "${title}" has been approved for the public site.`,
    '',
    'It goes live within a few minutes, at:',
    url,
    '',
    'Nothing else is needed from you. Later edits you make stay public: an approved item does not go back',
    'into review, and it keeps its original date.',
  ];

  const { html } = opsEmail({
    title: 'Approved for the public site',
    lead: `Your ${typeLabel(record?.type).toLowerCase()} "${title}" has been approved.`,
    sections: [
      { kind: 'fields', rows: [
        [typeLabel(record?.type), title],
        ['Address', url],
        ...(record?.decidedAt ? [['Approved', str(record.decidedAt)]] : []),
      ] },
      { kind: 'note', text: 'It goes live within a few minutes. Nothing else is needed from you: later edits you '
        + 'make stay public, because an approved item does not go back into review, and it keeps its original date.' },
    ],
    footer: 'Sent by the editorial review queue on the GBTI Network signup Worker.',
  });

  return { subject, text: lines.join('\n'), html };
}

/** The word a person reads for a content type. `project` covers the retired `products` folder too. */
function typeLabel(type) {
  return { post: 'Article', project: 'Project', prompt: 'Prompt' }[str(type)] || 'Item';
}
