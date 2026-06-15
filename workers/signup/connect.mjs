// Stripe Connect Express onboarding for referral payouts (SOW-007). A referrer who wants to be paid
// completes Stripe-hosted Express onboarding (KYC + bank details); we store the resulting
// connect_account_id on their Stripe Customer so the payout job can transfer to it.
//
// Idempotent: if the customer already has connect_account_id, we reuse it and never create a second
// account. Account Links are single-use and short-lived, so we mint a fresh one each time the referrer
// enters onboarding (start) or Stripe bounces them back to refresh_url (an expired link).

/**
 * Ensure the customer has a Connect account, creating + persisting one on first call. Returns the id.
 * @param {object} a
 * @param {object} a.stripe    the Stripe client (createConnectAccount + updateCustomer).
 * @param {object} a.customer  the referrer's Stripe Customer (with metadata).
 * @param {string} [a.email]   optional email to seed onboarding.
 */
export async function ensureConnectAccount({ stripe, customer, email }) {
  const existing = customer?.metadata?.connect_account_id;
  if (existing) return existing;

  const account = await stripe.createConnectAccount({
    email: email || customer?.email || undefined,
    metadata: {
      github_id: customer?.metadata?.github_id ?? '',
      github_login: customer?.metadata?.github_login ?? '',
    },
  });

  // Persist on the customer (metadata is merged by Stripe; we resend known keys to be explicit).
  await stripe.updateCustomer(customer.id, {
    metadata: { ...(customer.metadata ?? {}), connect_account_id: account.id },
  });
  return account.id;
}

/**
 * Begin (or resume) Express onboarding: ensure the account exists, then mint a one-time Account Link.
 * Returns { accountId, url } where url is the Stripe-hosted onboarding page to redirect the referrer to.
 */
export async function startOnboarding({ stripe, customer, email, baseUrl }) {
  const accountId = await ensureConnectAccount({ stripe, customer, email });
  const link = await stripe.createAccountLink({
    account: accountId,
    refreshUrl: `${baseUrl}/referral/connect/refresh`,
    returnUrl: `${baseUrl}/referral/connect/return`,
  });
  return { accountId, url: link.url };
}
