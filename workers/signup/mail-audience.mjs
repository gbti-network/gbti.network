// Which closing a digest recipient reads (owner, 2026-09-29): a paying member is told how to contribute, everybody
// else is invited to join. See membership/mail-closing.mjs for why this is decided per recipient rather than by
// the members edition.
//
// THE PREDICATE IS NOT RESTATED HERE. The entitlement list reconcile publishes daily (digest:entitled) is the
// answer the members edition already uses, built from the ban > staff > grandfather > Stripe status through
// canReadMemberStream. Reading it once per drain costs one KV read for the whole run, and a member sorted into
// the members edition therefore always reads the member closing too.
//
// An unreadable or missing list is an empty set: everybody reads the invitation, which is the harmless side.
import { entitledIdsFrom, subscriberIsEntitled, DIGEST_ENTITLED_KV_KEY } from '../../membership/digest-entitlement.mjs';

/** Read the entitlement list once and return subscriber -> 'member' | 'guest'. */
export async function readDigestAudience(env) {
  let ids = new Set();
  try {
    ids = entitledIdsFrom(await env?.SIGNUP_KV?.get(DIGEST_ENTITLED_KV_KEY, 'json'));
  } catch {
    ids = new Set();
  }
  return (subscriber) => (subscriberIsEntitled(subscriber, ids) ? 'member' : 'guest');
}
