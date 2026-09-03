// sow-293: the owner-facing CREATOR APPLICATION notice. One pure helper, node-free (no fetch, no KV), so
// what the owner reads is unit-tested without a network. Sibling of membership/coupon-notify.mjs and
// deliberately shaped like it.
//
// WHY THIS EXISTS. Content Creator is granted by application now, not bought, so an application is a piece
// of work waiting on a human. Without a notification it sits in a KV store nobody has a reason to open, and
// the applicant hears nothing. The review lane is where a decision is RECORDED; this is what makes the owner
// aware there is one to make.
//
// THE APPLICANT'S PROSE IS RENDERED AS A PRE BLOCK, not as a field row. It is multi-paragraph free text they
// wrote, and `pre` is the one section kind that preserves the line breaks while still escaping the content.
// The core already bounded and stripped control characters before storage; the escaping here is the second
// layer, because this text reaches an HTML email and the applicant is an untrusted author.

import { opsEmail } from './mail-ops.mjs';

/**
 * Render the notice for one application.
 *
 * @param record   a record from newApplication: `{ githubId, login, why, links, topics, submittedAt }`.
 * @param selfTest marks the mail as a reachability probe rather than a real application, matching how the
 *                 coupon alarm distinguishes its weekly self-test. Synthetic values, no application exists.
 * @returns `{ subject, text, html }`. Never throws: a missing field renders as an explicit placeholder
 *          rather than blank, because a blank row reads as "they left it empty" and that is a claim.
 */
export function creatorApplicationNotice(record, { selfTest = false } = {}) {
  const login = record?.login ? String(record.login) : '(unknown github login)';
  const githubId = record?.githubId ? String(record.githubId) : '?';
  const why = record?.why ? String(record.why) : '';
  const links = record?.links ? String(record.links) : '';
  const topics = record?.topics ? String(record.topics) : '';
  const submittedAt = record?.submittedAt ? String(record.submittedAt) : '';

  const subject = selfTest
    ? '[alarm self-test] Creator application alarm is reachable'
    : `Creator application from ${login}`;

  // The optional fields say "not provided" rather than rendering empty. The applicant was told both were
  // optional, so an empty one is a legitimate choice and the owner should be able to tell it apart from a
  // field that failed to store.
  const NONE = '(not provided)';

  const lines = [
    selfTest
      ? 'THIS IS NOT AN APPLICATION. It is the scheduled self-test of the creator-application alarm, and the'
      : 'Someone applied for the Content Creator plan.',
    selfTest ? 'values below are synthetic. No application was stored and no tier was granted.' : null,
    '',
    `Applicant: ${login} (github_id ${githubId})`,
    submittedAt ? `Submitted: ${submittedAt}` : null,
    '',
    'Why they want to contribute:',
    why || NONE,
    '',
    'Links to prior writing:',
    links || NONE,
    '',
    'Topics they would cover:',
    topics || NONE,
    '',
    selfTest
      ? 'Receiving this means the alarm can still reach you: the key, the sender domain and the address all'
      : 'Approve or decline this in the applications lane of the superadmin dashboard. Approving grants the',
    selfTest
      ? 'work. Its ABSENCE is the signal, not its arrival, so a silent week is worth checking.'
      : 'Content Creator tier immediately; there is no payment step.',
  ].filter((line) => line !== null);

  const { html } = opsEmail({
    title: selfTest ? 'Creator application alarm self-test' : 'Creator application',
    lead: selfTest ? '' : 'Someone applied for the Content Creator plan.',
    sections: [
      ...(selfTest
        ? [{
          kind: 'alert',
          text: 'THIS IS NOT AN APPLICATION. It is the scheduled self-test of the creator-application alarm, '
            + 'and the values below are synthetic. No application was stored and no tier was granted.',
        }]
        : []),
      { kind: 'fields', rows: [
        ['Applicant', `${login} (github_id ${githubId})`],
        ...(submittedAt ? [['Submitted', submittedAt]] : []),
      ] },
      { kind: 'paragraph', text: 'Why they want to contribute' },
      { kind: 'pre', text: why || NONE },
      { kind: 'paragraph', text: 'Links to prior writing' },
      { kind: 'pre', text: links || NONE },
      { kind: 'paragraph', text: 'Topics they would cover' },
      { kind: 'pre', text: topics || NONE },
      { kind: 'note', text: selfTest
        ? 'Receiving this means the alarm can still reach you: the key, the sender domain and the address all '
          + 'work. Its ABSENCE is the signal, not its arrival, so a silent week is worth checking.'
        : 'Approve or decline this in the applications lane of the superadmin dashboard. Approving grants the '
          + 'Content Creator tier immediately; there is no payment step.' },
    ],
    footer: selfTest
      ? 'Sent by the weekly credential-health check, not by an application.'
      : 'Sent by the creator-application alarm on the GBTI Network signup Worker.',
  });

  return { subject, text: lines.join('\n'), html };
}
