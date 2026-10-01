// SOW-166 right-to-erasure for the weekly digest: find every member subscriber record that belongs to one
// person and erase their mail records. Split out of scripts/lib/erase-member.mjs at the 900-line cap
// (2026-09-30); the code below moved verbatim. runErasure (erase-member.mjs) still runs it as the `mail` step,
// and erase-member.mjs re-exports both functions. Must not import erase-member.mjs.

import { kvRestShim } from './kv-rest.mjs';
import { mailHash, MAIL_SUBSCRIBER_PREFIX } from '../../membership/mail-suppress.mjs'; // SOW-166: the keyed identity behind every mail key
import { normalizeSubscriber } from '../../membership/mail-subscriber.mjs'; // SOW-166: the record shape the scan matches on
import { eraseSubscriberMail } from '../../workers/signup/mail-store.mjs'; // SOW-166: the one shared mail eraser

/**
 * SOW-166 right-to-erasure: delete the member's weekly-digest records.
 *
 * THIS STEP MUST RUN BEFORE THE STRIPE CUSTOMER DELETE, and that is a correctness constraint rather than a
 * preference. Every mail key is derived from the ADDRESS via mailHash, while erasure is driven by github_id,
 * so nothing in the mail keyspace can be located from a github_id alone. The address lives in exactly one
 * place we can still read: the Stripe customer. Once step `stripe` deletes it, the hash can never be computed
 * again and the subscriber record is unreachable BY ANY FUTURE RUN, permanently. Each step looks correct on
 * its own, which is precisely why the ordering is written down here and asserted by a test rather than left to
 * whoever next edits runErasure.
 *
 * The suppression marker `mail:suppress:<hash>` deliberately SURVIVES (eraseSubscriberMail keeps it). Deleting
 * it would silently re-contact someone who asked not to be contacted, and it holds a bare keyed hash with no
 * address in it. Same shape the owner already ruled on for the coupon lock on 2026-08-11: the record that
 * prevents a future harm outlives erasure in a form that can answer "has this opted out" but never "who".
 *
 * Fails SOFT and says why. Every skip reason is reported rather than swallowed, because "no mail records were
 * deleted" and "we could not tell whether there were any" must never look the same in the audit record.
 */
/**
 * Find every MEMBER subscriber record belonging to one person, by SCANNING `mail:subscriber:*` and matching the
 * record's own identity fields. PURE over the injected kv.
 *
 * WHY A SCAN AND NOT AN INDEX. A `source: 'member'` record is REQUIRED to carry `githubId`
 * (mail-subscriber.mjs buildSubscriber), so the person is already findable from the records themselves. A
 * maintained `github_id -> hash` index would be a second thing to keep in sync, earning its place only for a hot
 * O(1) read, and erasure is not one: it runs rarely, per person, and a full scan is cheap at this size.
 *
 * MATCHES githubId OR customerId, and the second half is deliberate. normalizeSubscriber is intentionally more
 * permissive than buildSubscriber and still accepts a stored customerId-only member record, on the stated
 * reasoning that a normalizer returning null would leave such a record in KV "invisible to every reader
 * including any cleanup that might remove it". ERASURE IS THAT CLEANUP. Matching only githubId would preserve
 * visibility for a cleanup that then does not look, and the permissiveness would buy nothing. Honest limit: a
 * customerId-only record cannot be created today, and matching it needs a customerId we only have while Stripe
 * still holds the customer. Cheap insurance against a stray, not coverage.
 *
 * REPORTS FAILURE AND TRUNCATION EXPLICITLY. `{ ok: false }` on a list error, `truncated: true` if the page cap
 * is hit. A scan that failed must NEVER be reportable as "found none": for erasure those look identical from
 * outside and only one of them means the person's records are gone.
 */
export async function findMemberSubscriberHashes(kv, { githubId, customerId = null, maxPages = 200 } = {}) {
  const gid = String(githubId ?? '').trim();
  const cid = String(customerId ?? '').trim();
  const hashes = [];
  let scanned = 0;
  if (!kv?.list) return { ok: false, error: 'kv has no list capability', hashes, scanned, truncated: false };
  if (!gid && !cid) return { ok: false, error: 'no github_id or customer_id to match on', hashes, scanned, truncated: false };

  let cursor;
  for (let page = 0; page < maxPages; page++) {
    let res;
    try {
      res = await kv.list({ prefix: MAIL_SUBSCRIBER_PREFIX, cursor });
    } catch (e) {
      return { ok: false, error: `subscriber list failed: ${e?.message || e}`, hashes, scanned, truncated: true };
    }
    for (const k of res?.keys ?? []) {
      const name = String(k?.name ?? '');
      if (!name.startsWith(MAIL_SUBSCRIBER_PREFIX)) continue;
      scanned++;
      let raw = null;
      try {
        raw = await kv.get(name, 'json');
      } catch (e) {
        // A record we could not READ might be the one we must erase, so this cannot be shrugged off.
        return { ok: false, error: `subscriber read failed for ${name}: ${e?.message || e}`, hashes, scanned, truncated: true };
      }
      const rec = normalizeSubscriber(raw);
      if (!rec || rec.source !== 'member') continue;
      const mine = (gid && rec.githubId === gid) || (cid && rec.customerId === cid);
      if (mine) hashes.push(name.slice(MAIL_SUBSCRIBER_PREFIX.length));
    }
    cursor = res?.cursor;
    if (res?.list_complete || !cursor) return { ok: true, hashes, scanned, truncated: false };
  }
  // Ran out of pages with a cursor still open: we did NOT see the whole keyspace.
  return { ok: true, hashes, scanned, truncated: true };
}

/**
 * Erase this person's mail records. SOW-166.
 *
 * THE SCAN IS THE PRIMARY PATH AND STRIPE IS ONLY A SUPPLEMENT. This previously derived the hash from
 * `customer.email` and did nothing else, which made erasure impossible for three real populations, all of them
 * reporting a clean skip rather than a failure:
 *   - a member whose Stripe customer was ALREADY DELETED (the 2026-08-21 ordering hazard, as an actual
 *     unerasable state rather than a procedural rule),
 *   - a customer with NO email, which `signup.mjs` can create when the GitHub account exposes none,
 *   - Stripe unconfigured or unreachable.
 * The scan needs neither Stripe nor MAIL_SUPPRESS_KEY, so it closes all three. It also retires the ordering
 * dependency rather than documenting around it: a rule that lives in a runbook is one an operator can violate
 * with no way to detect the violation afterwards.
 *
 * THE SUPPRESSION MARKER IS NEVER TOUCHED, here or in eraseSubscriberMail. It must OUTLIVE the record so a later
 * re-add cannot silently un-suppress someone who opted out. Deleting it would present as thoroughness AND as a
 * clean run, because a deleted marker leaves nothing behind to notice.
 */
export async function eraseMailRecords({ githubId, stripe = null, env = process.env, fetchImpl = globalThis.fetch, kv: injectedKv = null } = {}) {
  // kv is injectable so the erase PATH itself is testable, not just the scan helper. Production passes none.
  const kv = injectedKv || kvRestShim({ env, fetchImpl });
  if (!kv) return { skipped: true, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };
  const gid = String(githubId ?? '').trim();
  if (!gid) return { skipped: true, reason: 'no github_id given' };

  // Stripe is consulted OPPORTUNISTICALLY, for the customerId that lets the scan also match a stray
  // customerId-only record, and for the email fallback below. Its absence is not fatal any more.
  let customer = null;
  let stripeNote = 'not consulted';
  if (stripe) {
    try {
      customer = await stripe.findCustomerByGithubId(gid);
      stripeNote = customer?.id ? 'customer found' : 'no customer found';
    } catch (e) {
      stripeNote = `lookup failed: ${e?.message || e}`; // non-fatal: the scan does not need it
    }
  }

  const scan = await findMemberSubscriberHashes(kv, { githubId: gid, customerId: customer?.id ?? null });
  if (!scan.ok) return { error: scan.error, scanned: scan.scanned, stripe: stripeNote };

  const hashes = new Set(scan.hashes);

  // BELT AND BRACES, not the primary path. If Stripe still has an address, add the hash it derives to. This
  // catches a record the scan could not match on identity (none can be created today) and costs one hash.
  let emailFallback = 'not used';
  const secret = env.MAIL_SUPPRESS_KEY;
  if (secret && customer?.email) {
    const h = await mailHash(secret, customer.email);
    if (h) {
      emailFallback = hashes.has(h) ? 'agreed with the scan' : 'added a hash the scan did not match';
      hashes.add(h);
    }
  }

  const totals = { subscriber: 0, sends: 0, issues: 0 };
  const mailErrors = [];
  for (const h of hashes) {
    const c = await eraseSubscriberMail(kv, h);
    totals.subscriber += c.subscriber || 0;
    totals.sends += c.sends || 0;
    totals.issues += c.issues || 0;
    // eraseSubscriberMail now reports ok=false when it could not prove it erased everything (identity-record
    // delete threw, a list page was lost, a send record was unreadable/undeletable). That must surface as an
    // INCOMPLETE erasure, not be summed away into the success counts.
    if (!c.ok) mailErrors.push({ hash: h, errors: c.errors || ['unknown'] });
  }

  return {
    ...totals,
    matched: hashes.size,
    scanned: scan.scanned,
    // Proof of completeness needs BOTH a full scan AND every per-hash mail erasure succeeding. A truncated scan
    // means we did not see the whole keyspace; a mail-erasure error means a record may still be in KV. Either one
    // makes this run NOT proof of completeness, so the report must not read as done.
    incomplete: (scan.truncated || mailErrors.length > 0) || undefined,
    mailErrors: mailErrors.length ? mailErrors : undefined,
    stripe: stripeNote,
    emailFallback,
    suppressionMarkerKept: true,
  };
}
