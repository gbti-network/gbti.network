// SOW-119 QA (2026-07-18): the coupon-expiry countdown decision. Pure (no DOM, no chrome APIs), so it
// unit-tests like splash.mjs. The shell popup calls this with the status oracle's couponUntil + the
// persisted dismissal instant and shows the popup only when it says so.
//
// Cadence (owner-approved): the popup first appears START_DAYS before the grant end; a dismissal snoozes
// it 7 days, collapsing to daily inside the final 7 days (the dismissal instant is stored, never a fixed
// unlock time, so the cooldown re-derives as expiry approaches). Never shown after the grant end (the
// lapse machinery + the SOW-077 upgrade banner own that state).

const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRY_POPUP_START_DAYS = 28; // the countdown window opens here
export const EXPIRY_SNOOZE_DAYS = 7; // a dismissal sleeps this long...
export const EXPIRY_FINAL_STRETCH_DAYS = 7; // ...until the final stretch, where it collapses to daily

/**
 * Decide whether the expiry popup shows.
 * @param {object} args
 * @param {string|number|Date|null} args.until        the grant end (ISO string from the status oracle)
 * @param {number|null}             args.dismissedAt  ms timestamp of the last dismissal (null = never)
 * @param {number}                  args.now          ms clock
 * @returns {{ show: boolean, daysLeft: number|null }} daysLeft is ceil(days to `until`) when the grant is
 *          live (even when show is false), null when there is no usable grant date.
 */
export function expiryPopupDecision({ until, dismissedAt = null, now = Date.now() } = {}) {
  if (!until) return { show: false, daysLeft: null };
  const end = until instanceof Date ? until.getTime() : new Date(until).getTime();
  if (!Number.isFinite(end) || Number.isNaN(end)) return { show: false, daysLeft: null };
  if (now >= end) return { show: false, daysLeft: null }; // the grant is over: the lapse surfaces own it

  const daysLeft = Math.ceil((end - now) / DAY_MS);
  if (daysLeft > EXPIRY_POPUP_START_DAYS) return { show: false, daysLeft };

  const cooldownDays = daysLeft <= EXPIRY_FINAL_STRETCH_DAYS ? 1 : EXPIRY_SNOOZE_DAYS;
  const dismissed = Number(dismissedAt);
  if (Number.isFinite(dismissed) && dismissed > 0 && now - dismissed < cooldownDays * DAY_MS) {
    return { show: false, daysLeft };
  }
  return { show: true, daysLeft };
}

/** The popup copy pieces, derived once so the shell stays markup-only. */
export function expiryPopupCopy(daysLeft, until) {
  const date = new Date(until);
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const headline = daysLeft === 1
    ? 'Your complimentary membership ends tomorrow'
    : `Your complimentary membership ends in ${daysLeft} days`;
  return { headline, dateLabel };
}
