// sow-293: send the owner the creator-application notice. FAIL-SOFT BY CONTRACT, and a direct sibling of
// coupon-alert.mjs. This runs on the application submit path, so it must never throw and never gate: a notice
// failing (or being unprovisioned) leaves the application fully stored. The caller fires it through
// ctx.waitUntil, so it also does not delay the response the applicant is waiting on.
//
// THE ORDER THAT MAKES FAIL-SOFT SAFE HERE: the application is written to KV FIRST, then this fires. So a lost
// notice costs the owner's awareness of a pending application, never the application itself, and the review
// lane still lists it. That is the whole reason this is allowed to be soft when the rest of the signup path
// fails closed.
//
// Inert until provisioned: with CREATOR_APPLICATION_EMAIL unset (or the Resend send unconfigured) this is a
// no-op, matching how the rest of the mail path degrades. It falls back to COUPON_ALERT_EMAIL, which is
// already the owner's operational address, so the alarm is live the moment this ships rather than waiting on
// a provisioning step nobody is blocked on.

import { createResendClient } from '../../clients/resend.mjs';
import { creatorApplicationNotice } from '../../membership/creator-application-notify.mjs';

/**
 * @param env        the Worker env: reads CREATOR_APPLICATION_EMAIL (falling back to COUPON_ALERT_EMAIL),
 *                   MAIL_FROM/RESEND_FROM (sender, already on the Resend-verified domain), RESEND_API_KEY.
 * @param record     the stored application record from newApplication.
 * @param sendEmail  optional injected sender for tests; defaults to the real Resend client.
 * @param selfTest   marks the email as a reachability probe rather than a real application.
 * @returns `{ sent, reason?, message? }`. Never throws.
 */
export async function sendCreatorApplicationAlert(env, record, { sendEmail, selfTest = false } = {}) {
  try {
    const to = String(env?.CREATOR_APPLICATION_EMAIL || env?.COUPON_ALERT_EMAIL || '').trim();
    const from = String(env?.MAIL_FROM || env?.RESEND_FROM || '').trim();
    const apiKey = String(env?.RESEND_API_KEY || '').trim();
    if (!to || !from) { warnUnconfigured(record, 'no recipient or no sender'); return { sent: false, reason: 'unconfigured' }; }
    const send = sendEmail || (apiKey ? createResendClient({ apiKey }).sendEmail : null);
    if (!send) { warnUnconfigured(record, 'no RESEND_API_KEY and no injected sender'); return { sent: false, reason: 'unconfigured' }; }
    // BOTH bodies go to the sender, for the reason coupon-alert.mjs records: the builder lives in another
    // file, so a correct-looking notice reveals nothing about whether the html actually left. The test asserts
    // on what reaches `send`, not on what the builder returned.
    const { subject, text, html } = creatorApplicationNotice(record, { selfTest });
    await send({ from, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    // Swallow: the application is already stored and the applicant already got their confirmation. A failed
    // notice is recoverable (the record persists in KV and the review lane lists it); failing the submission
    // to report it is not.
    //
    // SWALLOWING IS NOT SAYING NOTHING. Without this line a send Resend rejects produces no email, no log and
    // no trace, which is indistinguishable from nobody having applied. Logged here rather than at the call
    // site so every caller inherits it.
    const message = err?.message ?? String(err);
    console.warn(`creator-application-alert: notice FAILED for github_id ${idOf(record)}: ${message}. `
      + 'The application IS stored and appears in the review lane, so this is recoverable, but nobody was told.');
    return { sent: false, reason: 'error', message };
  }
}

function idOf(record) { return record?.githubId ? String(record.githubId) : '?'; }

function warnUnconfigured(record, why) {
  console.warn(`creator-application-alert: notice NOT SENT for github_id ${idOf(record)}: ${why}. `
    + 'Expected in sandbox; in production it means applications pile up in the lane with nobody notified.');
}
