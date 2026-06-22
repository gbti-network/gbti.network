// Site-facing membership + revenue constants, single-sourced from the real systems so the marketing
// surfaces (homepage, /membership/, the CTA) never drift from the actual config or from each other.
// SOW-010 / SOW-011. The trial length, referral rate, and delegation caps are imported from the
// membership trust core + the referral/distribution config; the price mirrors the Stripe annual price.
import { TRIAL_DAYS } from '../../membership/derive-status.mjs';
import { DEFAULT_REFERRAL_CONFIG } from '../../membership/referral-config.mjs';
import { DEFAULT_DISTRIBUTION_CONFIG } from '../../membership/distribution.mjs';

/** Annual membership price in USD. Canonical money lives in Stripe (STRIPE_PRICE_ID, see
 *  membership-and-access.md / workers/signup/wrangler.toml); keep this equal to it. */
export const MEMBERSHIP_PRICE_USD = 150;
export const MEMBERSHIP_PRICE_LABEL = `$${MEMBERSHIP_PRICE_USD}`;
export const BILLING_PERIOD = 'year';

/** Trial length, from the membership trust core (the same constant the gate + reconcile use). */
export const TRIAL_DAYS_SITE: number = TRIAL_DAYS;

/** Revenue share, from the real referral + distribution config. */
export const REFERRAL_RATE: number = DEFAULT_REFERRAL_CONFIG.rate; // 0.30
export const CONTRIBUTION_CAP: number = DEFAULT_DISTRIBUTION_CONFIG.contributionCap; // 0.07
export const COMMENT_CAP: number = DEFAULT_DISTRIBUTION_CONFIG.commentCap; // 0.03
export const HOLD_DAYS: number = DEFAULT_REFERRAL_CONFIG.hold_days; // 90

/** Cloudflare Turnstile site key: PUBLIC, safe to ship. The signup CTA's widget renders with this and the
 *  Worker verifies the resulting token server-side with TURNSTILE_SECRET_KEY (which never leaves the Worker).
 *  The signup button stays "Coming soon" until the Worker is live; the live CTA + widget land at that point. */
export const TURNSTILE_SITE_KEY = '0x4AAAAAADg66MO1G3WyZDcL';

/** The signup Worker origin (SOW-002), where the Turnstile-gated `/signup/start` lives. Must equal the
 *  Worker `PUBLIC_BASE_URL`. The signup CTA navigates here with the Turnstile token + first-touch ref/via. */
export const SIGNUP_BASE = 'https://signup.gbti.network';

export const pct = (n: number): string => `${Math.round(n * 100)}%`;
// SOW-007/008 (superseded) constants — still consumed by the not-yet-migrated attribution code. Site COPY now
// uses the SOW-059 constants below.
export const REFERRAL_PCT = pct(REFERRAL_RATE); // "30%"
export const CONTRIBUTION_PCT = pct(CONTRIBUTION_CAP); // "7%"
export const COMMENT_PCT = pct(COMMENT_CAP); // "3%"

// SOW-059: the SIMPLIFIED revenue model (spec: .data/ops/revenue-ops/README.md). Touch-based + fixed + automatic:
// the first content that brought a member in earns its author 30%, the last content before they joined earns 10%,
// and a fixed 5% pool is shared automatically by members who commented on or contributed to those two items.
export const FIRST_TOUCH_PCT = '30%';
export const LAST_TOUCH_PCT = '10%';
export const COLLAB_POOL_PCT = '5%';
