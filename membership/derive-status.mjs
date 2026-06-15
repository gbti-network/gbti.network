// Canonical membership status derivation (SOW-002 / SOW-005).
// Mirrors .data/specs/membership-and-access.md section 2. Fail closed: any missing customer or
// lookup error resolves to "none" (treated as unpaid). Shared by the PR-gate and the reconcile so
// the two can never diverge. No Stripe SDK is imported here; callers inject a thin client, which
// keeps every branch testable against fixtures.

export const TRIAL_DAYS = 90;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

const PAID_SUB_STATUSES = new Set(['active', 'past_due']); // past_due = dunning grace, keep access
const DEAD_SUB_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired']);

// Possible derived statuses (before git-native overrides are applied):
//   paid | trialing | expired | cancelled | none
export const STATUS = Object.freeze({
  paid: 'paid',
  trialing: 'trialing',
  expired: 'expired',
  cancelled: 'cancelled',
  none: 'none',
});

/** Normalize a customer's subscriptions whether they arrive as a Stripe list ({data:[...]}) or array. */
export function subscriptionsOf(customer) {
  if (!customer) return [];
  const s = customer.subscriptions;
  if (!s) return [];
  if (Array.isArray(s)) return s;
  if (Array.isArray(s.data)) return s.data;
  return [];
}

/** Pick the subscription that decides paid state: prefer an active/past_due one, else the newest. */
export function mostRelevantSubscription(subs) {
  if (!subs || subs.length === 0) return null;
  const ranked = [...subs].sort((a, b) => {
    const aPaid = PAID_SUB_STATUSES.has(a.status) ? 1 : 0;
    const bPaid = PAID_SUB_STATUSES.has(b.status) ? 1 : 0;
    if (aPaid !== bPaid) return bPaid - aPaid; // paid-ish first
    return (b.created ?? 0) - (a.created ?? 0); // then newest
  });
  return ranked[0];
}

/**
 * Pure status derivation from a fully-formed Stripe Customer object (subscriptions expanded).
 * Used directly by the reconcile, which already has each customer in hand.
 */
export function deriveStatusFromCustomer(customer, now = new Date()) {
  if (!customer) return STATUS.none;
  const sub = mostRelevantSubscription(subscriptionsOf(customer));
  if (sub) {
    if (PAID_SUB_STATUSES.has(sub.status)) return STATUS.paid;
    if (DEAD_SUB_STATUSES.has(sub.status)) return STATUS.cancelled;
    // 'incomplete' / 'trialing' (unused) fall through to the trial-clock check below.
  }
  const startedRaw = customer.metadata?.trial_started_at;
  if (startedRaw) {
    const started = new Date(startedRaw);
    if (!Number.isNaN(started.getTime()) && now.getTime() < started.getTime() + TRIAL_MS) {
      return STATUS.trialing;
    }
  }
  return STATUS.expired;
}

/**
 * Look up a customer by immutable github_id and derive status. Fail closed on null / error.
 * `client` must implement: findCustomerByGithubId(githubId) -> customer | null (may throw).
 */
export async function deriveStatus(githubId, client, now = new Date()) {
  let customer;
  try {
    customer = await client.findCustomerByGithubId(String(githubId));
  } catch {
    return STATUS.none; // fail closed
  }
  if (!customer) return STATUS.none;
  return deriveStatusFromCustomer(customer, now);
}
