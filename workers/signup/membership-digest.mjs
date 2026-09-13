// sow-202 (owner, 2026-09-13): the signed-in member's weekly digest switch, shown on /account/notifications/.
//
//   GET  /membership/digest              -> { ok, on, address, reason? }
//   POST /membership/digest { on: bool } -> { ok, on, address }
//
// Gated on authorizeMember with the cookie allowed: signed in and NOT banned, free accounts included (signing in is
// what creates a free account). A cookie POST passes the CSRF gate inside resolveIdentity, as /membership/prefs does.
//
// THE ADDRESS is the one on the member's Stripe Customer, the same place the mail drain reads a member's address
// from at send time. It is shown to the member (their own account email) and never stored here.
//
// FOUR RULES FROM THE sow-202 REVIEW (SowMaster, three adversarial rounds), each of which a simpler version broke:
//
//   1. `on` IS ABOUT THE CALLER'S OWN RECORD AND NOTHING ELSE. It is true only for a member record that carries the
//      caller's githubId and wants the digest. An anonymous record or a suppression marker under the same hash is
//      never reported: the account email is not proven to be the member's (a Customer can hold an address typed at
//      Checkout, or an unverified one from before the verified-email fix), and reporting on another person's
//      address would recreate the lookup /mail/subscribe deliberately hides.
//   2. NO RECORD EVER MOVES BETWEEN HASHES. Every digest already sent carries `h=<hash>` in its unsubscribe link, so
//      a moved record would keep receiving mail after its owner unsubscribed. A record is only ever rewritten under
//      its own key.
//   3. NO POINTER KEY. sow-186 dropped `mail:member-hash:<github_id>` on purpose (erasure and the notification fan-out
//      scan for githubId). The caller's record is looked for at the hash of their CURRENT account email, then by a
//      BOUNDED scan that runs on a POST only, never on a page view.
//   4. OFF IS THE `digestOff` FLAG, NEVER A SUPPRESSION MARKER. The drain's send-time suppression gate also stops
//      follow alerts, and the owner's rule is that switching the digest off stops the digest only.
//
// A SUBSCRIPTION FROM THE PUBLIC FORM under the account's address is NEVER CLAIMED, in either direction. The first
// version claimed it into the member's record (28d3493a) and SowMaster's review showed why that was wrong: the account
// email is not proven, so an account holding a stranger's address could take over that stranger's form subscription
// and switch it off, and the stranger could not get it back (the form treats an active record as already subscribed).
// claimForMember's own contract requires a GitHub-verified primary email, which this route does not have. So the
// switch acts only on the member's own record: ON leaves the form subscription sending (it resumes if a bounce
// stopped it), and OFF cannot stop it, which the page says, pointing at the unsubscribe link in any issue. Residual,
// accepted: after ON, the page reads "on" if the member's own record was created and "off" if a form subscription
// was already there, so an account holding a stranger's address learns whether that address had one. That account
// can already mail the address (the owner's trade-off), and learning it takes a payment and an account per address.
// Another member account's record under the address is never touched, its unsubscribe block included.
//
// SWITCHING ON LIFTS AN EARLIER UNSUBSCRIBE AT ONCE, with no confirmation email (owner, 2026-09-13, choosing it over
// a confirmation link with both costs shown): an account can hold an address its owner never verified, and a
// hard-bounced address is mailed again until it bounces again and the bounce webhook blocks it once more. The marker
// is deleted BEFORE the record is written, so a failure between the two can never leave a record reading "on" while
// the drain still refuses to send.

import { authorizeMember } from './membership-content.mjs';
import { rateLimit } from './abuse.mjs';
import { getSubscriber, putSubscriber } from './mail-store.mjs';
import { sendNewSubscriberAlert } from './subscriber-alert.mjs';
import { mailHash, normalizeEmail, suppressKey, MAIL_SUBSCRIBER_PREFIX } from '../../membership/mail-suppress.mjs';
import { buildSubscriber, normalizeSubscriber, markActive, wantsDigest } from '../../membership/mail-subscriber.mjs';

/** The most subscriber records one POST will read while looking for the caller's record under an older hash. */
export const DIGEST_SCAN_BUDGET = 500;
export const DIGEST_SWITCH_RATE = { limit: 10, windowSeconds: 600, prefix: 'rl:digestsw:' };

const unavailable = (message = 'The digest setting could not be reached just now. Try again in a few minutes.') =>
  ({ status: 503, body: { error: 'unavailable', message } });

/** The account's email and Customer id: the KV index first (consistent), Stripe search as the fallback. */
async function accountFor(kv, githubId, { stripe, lookupCustomer }) {
  let customer = null;
  if (lookupCustomer) customer = await lookupCustomer(githubId);
  else if (stripe) {
    const cached = await kv.get(`gh:${githubId}`);
    customer = cached ? await stripe.getCustomer(cached) : await stripe.searchCustomerByGithubId(githubId);
  }
  return { email: normalizeEmail(customer?.email || ''), customerId: customer?.id ? String(customer.id) : null };
}

const isOwn = (rec, githubId) => Boolean(rec) && rec.source === 'member' && rec.githubId === String(githubId);

/**
 * Look for the caller's member record by scanning mail:subscriber:*, at most `budget` reads. Only a POST calls this.
 * Returns { rec } when found, { rec: null } when the scan finished or ran out of budget (logged), and { error }
 * when a read failed, because a record that could not be read might be the caller's.
 */
export async function scanForOwnRecord(kv, githubId, { budget = DIGEST_SCAN_BUDGET } = {}) {
  let cursor;
  let reads = 0;
  do {
    const page = await kv.list({ prefix: MAIL_SUBSCRIBER_PREFIX, cursor, limit: 1000 });
    for (const { name } of page.keys || []) {
      if (reads >= budget) {
        console.warn(`membership-digest: scan budget of ${budget} records reached without finding the caller's record`);
        return { rec: null, exhausted: true };
      }
      reads += 1;
      let rec;
      try { rec = normalizeSubscriber(await kv.get(name, 'json')); } catch { return { error: true }; }
      if (isOwn(rec, githubId)) return { rec };
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return { rec: null };
}

export async function handleDigestSwitch(request, env, {
  kv = env?.SIGNUP_KV, authorize = authorizeMember, stripe = null, lookupCustomer = null,
  limiter = rateLimit, notify = (info) => sendNewSubscriberAlert(env, info), now = Date.now, ...authDeps
} = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the member store is not configured' } };

  const auth = await authorize(request, env, { ...authDeps, kv, allowCookie: true });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const githubId = String(auth.githubId);

  if (request.method !== 'GET' && request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let on = null;
  if (request.method === 'POST') {
    try { on = (await request.json())?.on; } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
    if (on !== true && on !== false) return { status: 400, body: { error: 'invalid', message: 'on must be true or false' } };
    const rl = await limiter({ kv, id: githubId, ...DIGEST_SWITCH_RATE, now: now() });
    if (!rl.allowed) return { status: 429, body: { error: 'rate_limited', message: 'Too many changes. Try again in a few minutes.' } };
  }

  let account;
  try { account = await accountFor(kv, githubId, { stripe, lookupCustomer }); } catch { return unavailable(); }
  const { email, customerId } = account;
  if (!email) {
    if (request.method === 'GET') return { status: 200, body: { ok: true, on: false, address: null, reason: 'no_address' } };
    return { status: 409, body: { error: 'no_address', message: 'There is no email address on this account, so the digest cannot be sent.' } };
  }
  const hash = await mailHash(env?.MAIL_SUPPRESS_KEY, email);
  if (!hash) return unavailable();

  let own;
  try {
    const atHash = await getSubscriber(kv, hash);
    own = isOwn(atHash, githubId) ? atHash : null;
  } catch { return unavailable(); }

  if (request.method === 'GET') {
    return { status: 200, body: { ok: true, on: own ? wantsDigest(own) : false, address: email } };
  }

  // POST. The record may sit under an older hash if the account email changed since it was written; find it before
  // deciding to create one, or the member would end up with two records and two copies of every issue.
  if (!own) {
    const found = await scanForOwnRecord(kv, githubId);
    if (found.error) return unavailable();
    own = found.rec;
  }
  const t = Number(now());
  const answer = { status: 200, body: { ok: true, on, address: email } };

  // Every store write below is inside this try: a KV failure answers the same 503 as a failed read, with CORS
  // headers, rather than escaping to the router's bare 500 (which the page cannot even read).
  try {
    if (on) {
      if (own) {
        await kv.delete(suppressKey(own.hash));
        await putSubscriber(kv, { ...own, status: 'active', digestOff: false, updatedAt: t });
        return answer;
      }
      const existing = await getSubscriber(kv, hash);
      if (existing && existing.source === 'member') {
        // Another GBTI account's record already uses this address. Nothing of theirs is touched, its block included,
        // so this check comes before the delete below.
        return { status: 409, body: { error: 'unavailable', message: 'The digest could not be turned on for this account. Contact us and we will sort it out.' } };
      }
      await kv.delete(suppressKey(hash));
      if (existing) {
        // A subscription from the public form under this address. It is NOT claimed (see the header): the address
        // already gets the digest through it, and one stopped by a bounce resumes, which is the lift the owner chose.
        if (existing.status !== 'active') await putSubscriber(kv, markActive(existing, { now: () => t }));
        return answer;
      }
      await putSubscriber(kv, buildSubscriber({ hash, source: 'member', githubId, customerId }, { now: () => t }));
      await notify({ email, source: 'member', at: new Date(t).toISOString() }); // fail-soft by contract
      return answer;
    }

    // OFF: only the digest. The record stays active so any follow alerts the member chose keep arriving.
    if (own) {
      await putSubscriber(kv, { ...own, digestOff: true, updatedAt: t });
      return answer;
    }
    const existing = await getSubscriber(kv, hash);
    const blocked = await kv.get(suppressKey(hash));
    if (!existing && !blocked) {
      // Nothing under this address yet: record the choice, so a later enrollment backfill cannot quietly turn it on.
      await putSubscriber(kv, buildSubscriber({ hash, source: 'member', githubId, customerId, digestOff: true }, { now: () => t }));
    }
    // A form subscription, another account's record, or an unsubscribe: none of them is this member's to change.
    return answer;
  } catch (err) {
    console.warn(`membership-digest: the change could not be stored: ${err?.message || err}`);
    return unavailable();
  }
}
