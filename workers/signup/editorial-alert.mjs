// sow-323 Phase 3: sending the editorial review queue's two emails. FAIL-SOFT BY CONTRACT, a direct sibling of
// creator-application-alert.mjs, and for the same reason: both of these run after the thing they describe has
// already happened, so a notice that fails (or is unprovisioned) must never undo it.
//
// THE ORDER THAT MAKES FAIL-SOFT SAFE HERE:
//   - the queue record is written to KV BEFORE the owner notice fires, so a lost notice costs the owner's
//     awareness of work waiting, never the record. The queue still lists it.
//   - the approval is COMMITTED and recorded before the author notice fires, so a lost notice costs the author
//     the news, never the publication. Their item still goes live.
//
// Inert until provisioned: with no recipient, no sender or no Resend key these are no-ops, matching how the
// rest of the mail path degrades. The owner notice falls back to COUPON_ALERT_EMAIL, already the owner's
// operational address, so the alarm is live the moment this ships.

import { createResendClient } from '../../clients/resend.mjs';
import { createStripeClient } from '../../clients/stripe.mjs';
import { editorialQueueNotice, editorialApprovedNotice } from '../../membership/editorial-notify.mjs';

const trimmed = (v) => String(v ?? '').trim();

/** The sender for this env, or null when mail is not provisioned. */
function resolveSend(env, sendEmail) {
  if (sendEmail) return sendEmail;
  const apiKey = trimmed(env?.RESEND_API_KEY);
  return apiKey ? createResendClient({ apiKey }).sendEmail : null;
}

/**
 * Tell the owner that items are waiting for review. Batched: one notice per publish, not per file.
 *
 * @param records  the NEWLY pending records (recordEditorialItems returns them as `fresh`).
 * @returns `{ sent, reason?, message? }`. Never throws.
 */
export async function sendEditorialQueueAlert(env, records, { sendEmail, selfTest = false } = {}) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!list.length && !selfTest) return { sent: false, reason: 'nothing_pending' };
  try {
    const to = trimmed(env?.EDITORIAL_REVIEW_EMAIL || env?.CREATOR_APPLICATION_EMAIL || env?.COUPON_ALERT_EMAIL);
    const from = trimmed(env?.MAIL_FROM || env?.RESEND_FROM);
    if (!to || !from) { warnUnconfigured(list, 'no recipient or no sender'); return { sent: false, reason: 'unconfigured' }; }
    const send = resolveSend(env, sendEmail);
    if (!send) { warnUnconfigured(list, 'no RESEND_API_KEY and no injected sender'); return { sent: false, reason: 'unconfigured' }; }
    // Both bodies go to the sender, for the reason coupon-alert.mjs records: the builder lives in another file,
    // so a correct-looking notice reveals nothing about whether the html actually left. The test asserts on what
    // reaches `send`, not on what the builder returned.
    const { subject, text, html } = editorialQueueNotice(list, { origin: trimmed(env?.SITE_ORIGIN) || undefined, selfTest });
    await send({ from, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    // SWALLOWING IS NOT SAYING NOTHING. Without this line a rejected send produces no email, no log and no
    // trace, which is indistinguishable from nobody having published anything.
    const message = err?.message ?? String(err);
    console.warn(`editorial-alert: review notice FAILED for ${describe(list)}: ${message}. `
      + 'The items ARE recorded and appear in the review queue, so this is recoverable, but nobody was told.');
    return { sent: false, reason: 'error', message };
  }
}

/**
 * Tell an author their item was approved. The address comes from their Stripe customer, because the platform
 * stores no member address of its own (the same resolution the mail drain uses, mailDrainDeps in index.mjs).
 *
 * @param record the approved record.
 * @returns `{ sent, reason?, message? }`. Never throws.
 */
export async function sendEditorialApprovedEmail(env, record, { sendEmail, fetchMemberEmail } = {}) {
  try {
    const githubId = trimmed(record?.githubId);
    const from = trimmed(env?.MAIL_FROM || env?.RESEND_FROM);
    if (!from) { warnAuthor(record, 'no sender'); return { sent: false, reason: 'unconfigured' }; }
    const send = resolveSend(env, sendEmail);
    if (!send) { warnAuthor(record, 'no RESEND_API_KEY and no injected sender'); return { sent: false, reason: 'unconfigured' }; }

    const lookup = fetchMemberEmail || (async (id) => {
      if (!env?.STRIPE_SECRET_KEY) return null;
      const customer = await createStripeClient({ apiKey: env.STRIPE_SECRET_KEY }).searchCustomerByGithubId(id);
      return customer?.email || null;
    });
    // A record with no github_id is a superadmin's own item approved without ever entering the queue; there is
    // nobody to write to, and that is not a failure.
    const to = githubId ? trimmed(await lookup(githubId)) : '';
    if (!to) { warnAuthor(record, 'no address for that member'); return { sent: false, reason: 'no_address' }; }

    const { subject, text, html } = editorialApprovedNotice(record, { origin: trimmed(env?.SITE_ORIGIN) || undefined });
    await send({ from, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    const message = err?.message ?? String(err);
    console.warn(`editorial-alert: approval notice FAILED for ${trimmed(record?.path) || '?'}: ${message}. `
      + 'The item IS approved and committed, so this is recoverable, but its author was not told.');
    return { sent: false, reason: 'error', message };
  }
}

function describe(list) {
  const first = list[0];
  return list.length > 1 ? `${list.length} items from github_id ${trimmed(first?.githubId) || '?'}` : (trimmed(first?.path) || '?');
}

function warnUnconfigured(list, why) {
  console.warn(`editorial-alert: review notice NOT SENT for ${describe(list)}: ${why}. `
    + 'Expected in sandbox; in production it means member work piles up in the queue with nobody notified.');
}

function warnAuthor(record, why) {
  console.warn(`editorial-alert: approval notice NOT SENT for ${trimmed(record?.path) || '?'}: ${why}. `
    + 'The item is approved and public either way; its author simply was not told.');
}
