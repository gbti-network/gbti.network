// sow-427 C3: send the owner the "prepared listing claimed" notice. FAIL-SOFT BY CONTRACT, a sibling of
// coupon-alert.mjs and subscriber-alert.mjs: it runs after the claim's pull request MERGED and the claim was
// recorded, so a notice that fails (or is unprovisioned) must never undo the claim, throw, or delay a response. The
// routes fire it through ctx.waitUntil, and the scheduled sweep awaits it inside its own waitUntil.
//
// WHO IS TOLD, AS BUILT (amendment 15). The SOW says "the issuing superadmin is told". Both superadmins are the
// owner's accounts and the Worker holds no per-superadmin address, so the notice goes to the owner alert address
// (ADMIN_ALERT_EMAIL, falling back to COUPON_ALERT_EMAIL, exactly as sow-279's notices do) and NAMES the superadmin
// who prepared the listing (membership/prepared-notify.mjs).
//
// WHAT IS NEVER LOGGED. The invitation code is a bearer secret and the title, the greeting name and the message are
// about a person, so the one warning here is a fixed sentence with nothing interpolated into it, not even the
// sender's error text (a provider's error can quote the subject line, which carries the title).
import { createResendClient } from '../../clients/resend.mjs';
import { listingClaimedNotice } from '../../membership/prepared-notify.mjs';

/**
 * @param env        the Worker env: ADMIN_ALERT_EMAIL || COUPON_ALERT_EMAIL (recipient), MAIL_FROM/RESEND_FROM
 *                   (sender, on the Resend-verified domain), RESEND_API_KEY.
 * @param record     a listingClaimedRecord (membership/prepared-notify.mjs), as finalizeIfMerged returns it in
 *                   `notify`. Null or absent sends nothing.
 * @param sendEmail  optional injected sender for tests; defaults to the real Resend client.
 * @returns `{ sent, reason? }`. Never throws.
 */
export async function sendListingClaimedAlert(env, record, { sendEmail } = {}) {
  if (!record || typeof record !== 'object') return { sent: false, reason: 'nothing_to_send' };
  try {
    const to = String(env?.ADMIN_ALERT_EMAIL || env?.COUPON_ALERT_EMAIL || '').trim();
    const from = String(env?.MAIL_FROM || env?.RESEND_FROM || '').trim();
    const apiKey = String(env?.RESEND_API_KEY || '').trim();
    // Unprovisioned is a no-op, not a failure: nothing to alert to, or no way to send (expected in sandbox).
    if (!to || !from) return { sent: false, reason: 'unconfigured' };
    const send = sendEmail || (apiKey ? createResendClient({ apiKey }).sendEmail : null);
    if (!send) return { sent: false, reason: 'unconfigured' };
    // BOTH bodies go to the sender, for the reason coupon-alert.mjs records: the builder lives in another file, so
    // a correct-looking notice says nothing about whether the html actually left. The test asserts on `send`.
    const { subject, text, html } = listingClaimedNotice(record);
    await send({ from, to, subject, text, html });
    return { sent: true };
  } catch {
    // Swallow: the claim is merged and recorded, and the invite manager shows it as claimed, so a lost notice costs
    // the owner the news, never the claim. But swallowing is not saying nothing, so one fixed line says it failed.
    console.warn('listing-claimed-alert: the claim notice FAILED to send. The claim IS recorded and the invite manager shows it, so this is recoverable, but nobody was emailed.');
    return { sent: false, reason: 'error' };
  }
}
