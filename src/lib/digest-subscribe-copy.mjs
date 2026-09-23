// sow-202: the message the weekly-digest sign-up box shows after a successful subscribe
// (src/components/mail/DigestSubscribe.astro), kept pure so node --test can pin it.
//
// The Worker's POST /mail/subscribe answers the same way for a new, an existing and an opted-out address, so the
// form cannot be used to test whether an address is on the list. Its JSON carries `direct` (workers/signup/
// mail-subscribe.mjs): true when the Worker runs without a confirmation step (production since 2026-08-26), false
// when it sends a confirmation email first. Because one answer covers every address, the direct wording has to be
// true for all of them: a new address now gets the digest, an address already on the list keeps getting it, and an
// address that unsubscribed stays off (the opt-out is never undone). So it says "unless it unsubscribed before" and
// promises no welcome email, which an existing subscriber never receives. The Worker's no-script page says the same.
// A missing flag (an older Worker) keeps the confirmation wording.

// sow-383: the box's heading and blurb, shared by the site component and the digest's web edition (which the
// Worker renders and so cannot use the component itself). One definition, so the two boxes cannot drift apart.
export const SUBSCRIBE_HEADING = 'Get the weekly digest';
export const SUBSCRIBE_BLURB = 'One email a week: new member articles, projects and prompts, plus the developer news worth reading. Unsubscribe in one click, any time.';

export function subscribeSuccessMessage(body) {
  if (body && body.direct === true) {
    return 'Thanks. This address now gets the GBTI Network weekly digest, unless it unsubscribed before.';
  }
  return 'Check your inbox. If this address is new to the digest, a confirmation email is on its way. You are not subscribed until you click the link in it.';
}

// sow-388: the headline the full-screen invitation (src/components/mail/DigestInvite.astro) shows above
// subscribeSuccessMessage after a successful subscribe. It follows the same `direct` flag, for the same reason:
// "the next issue is Tuesday" is only true once the address is enrolled, and with a confirmation step the reader
// still has one thing to do. The day is pinned to the deployed cron by test/digest-send-day.test.mjs.
export function inviteSuccessHeading(body) {
  return body && body.direct === true ? 'The next issue is Tuesday.' : 'One more step.';
}
