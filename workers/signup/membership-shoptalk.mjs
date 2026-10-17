// sow-314: the member-facing Shop Talk call endpoint.
//
//   GET  /membership/shoptalk                  -> { ok, eligible, enrolled, address, optedOut, nextCall }
//   POST /membership/shoptalk { action:'leave'  } -> off the guest list now, and stay off
//   POST /membership/shoptalk { action:'rejoin' } -> back on the guest list now
//
// ENROLLMENT IS AUTOMATIC AND THIS ROUTE IS NOT HOW IT HAPPENS (owner, 2026-09-04). The reconcile sweep adds
// every paid and trial member. This endpoint exists so a member can SEE where they stand and opt out, which
// matters because the sweep is otherwise invisible to them: they are added to a real calendar event by
// software they never interacted with.
//
// THE OPT-OUT MARKER IS THE POINT, AND IT OUTLIVES THE REMOVAL ON PURPOSE. Taking somebody off the guest list
// without recording that they asked would be undone by the next sweep, and they would get a fresh invitation
// within the hour. That is not a hypothetical: membership/mail-suppress.mjs exists because the digest
// backfill learned exactly this, and its marker is deliberately kept after the subscriber record is gone so
// the check has something to read. Same reasoning, same shape, one marker per member so it is erasable.
//
// Gated on authorizeMember: signed in and NOT BANNED. Deliberately not authorizePaid, because a free or
// lapsed member asking "am I on the call?" deserves a real answer plus the reason they are not, rather than a
// 403 that reads as breakage.

import { authorizeMember } from './membership-content.mjs';
import { rateLimit } from './abuse.mjs';
import { ELIGIBLE_STATUSES, normalizeAddress } from '../../scripts/lib/shoptalk-enroll.mjs';
import { seriesFromInstances, isSeriesProblem } from '../../membership/shoptalk-series.mjs';
import { isEmailShape } from '../../membership/sponsor-inquiry.mjs';

export const SHOPTALK_OPTOUT_KEY = (githubId) => `shoptalk:optout:${githubId}`;
/** sow-466: the address this member chose for their invitation. Mirrors shoptalk-state.mjs ADDR_PREFIX, and a
 *  test pins the two spellings together, because the Worker writes this key and the sweep reads it. */
export const SHOPTALK_ADDRESS_KEY = (githubId) => `shoptalk:addr:${githubId}`;
/** A few changes a day, per member. A typed address makes Google send an invitation from our calendar, so the
 *  limit is what stops the field being used as a mail relay. */
export const SHOPTALK_ADDRESS_LIMIT = Object.freeze({ limit: 5, windowSeconds: 86400, prefix: 'rl:shoptalk-addr:' });
export const SHOPTALK_QUERY = 'Shop TALK';
/** The sweep's seen record (scripts/lib/shoptalk-state.mjs SEEN_KEY): every member address ever invited. Read
 *  here so a member whose seat was removed is told so and offered Rejoin, rather than "your seat is being
 *  added", which under rule 5 (the invitation goes out once) would be untrue. A literal rather than an import
 *  because that module pulls node-only helpers; the route test pins the two spellings together. */
export const SHOPTALK_SEEN_KEY = 'shoptalk:seen';

/** Has the sweep ever invited this address? Unreadable reads as "no": the page then says "being added", which
 *  is the older, milder inaccuracy, and the sweep itself never trusts this read. */
async function everInvited(kv, address) {
  if (!address) return false;
  try {
    const raw = await kv.get(SHOPTALK_SEEN_KEY);
    if (!raw) return false;
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return !!(obj && typeof obj === 'object' && obj[address]);
  } catch { return false; }
}

/** The guest list as addresses plus, when the client can say, each guest's RSVP. */
async function readGuests(calendar, seriesId) {
  if (typeof calendar.attendeeDetails === 'function') {
    const details = await calendar.attendeeDetails(seriesId);
    if (details === null) return null;
    return { guests: details.map((d) => d.email).filter(Boolean), declined: new Set(details.filter((d) => d.responseStatus === 'declined').map((d) => d.email)) };
  }
  const guests = await calendar.listAttendees(seriesId);
  return guests === null ? null : { guests, declined: new Set() };
}

/**
 * Resolve the member's calendar address, and say where it came from.
 *
 * sow-466: the address the MEMBER chose wins over the billing address on their Stripe customer. The billing
 * address is a fine default and a poor assumption: it is where their card lives, not necessarily where their
 * calendar lives, and a member whose invitation goes to an address they never open cannot tell the difference
 * between that and the call ignoring them.
 *
 * Still one resolver, so the GET, the POST and the sweep cannot drift apart about which address is theirs.
 */
async function addressFor(env, githubId, { kv, stripe, lookupEmail } = {}) {
  if (kv) {
    let chosen = null;
    try { chosen = await kv.get(SHOPTALK_ADDRESS_KEY(githubId), { type: 'json' }); } catch { chosen = null; }
    const address = normalizeAddress(chosen?.address || '');
    if (address) return { address, source: 'member' };
  }
  if (lookupEmail) return { address: normalizeAddress(await lookupEmail(githubId)), source: 'billing' };
  if (!stripe) return { address: '', source: null };
  const customer = await stripe.searchCustomerByGithubId(githubId);
  return { address: normalizeAddress(customer?.email || ''), source: 'billing' };
}

export async function handleShoptalk(request, env, {
  kv = env?.SIGNUP_KV, authorize = authorizeMember, calendar = null, stripe = null, lookupEmail = null, ...authDeps
} = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the member store is not configured' } };

  const auth = await authorize(request, env, { ...authDeps, kv, allowCookie: true });
  if (!auth.ok) return { status: auth.status, body: auth.body };

  const eligible = ELIGIBLE_STATUSES.has(auth.status);
  const optKey = SHOPTALK_OPTOUT_KEY(auth.githubId);
  const optedOut = (await kv.get(optKey)) !== null;

  if (request.method === 'GET') {
    const { address, source } = await addressFor(env, auth.githubId, { kv, stripe, lookupEmail });
    // The calendar is optional on a READ. If it is unreachable the member still gets their eligibility and
    // opt-out state rather than an error page, and `enrolled` is reported as unknown rather than as false.
    // Reporting "not on the list" when we simply could not look would invite them to press a button they do
    // not need, and would be a lie told confidently.
    let enrolled = null;
    let nextCall = null;
    let declined = false; // on the list, and answered No on the calendar
    let dropped = false;  // invited once, no longer on the list: the sweep will not re-invite (rule 5)
    if (calendar) {
      const s = seriesFromInstances(await calendar.nextOccurrences(SHOPTALK_QUERY));
      if (!isSeriesProblem(s)) {
        nextCall = s.startsAt;
        const read = await readGuests(calendar, s.seriesId);
        if (read) {
          enrolled = address ? read.guests.includes(address) : false;
          declined = enrolled && read.declined.has(address);
        }
      }
    }
    if (enrolled === false && !optedOut) dropped = await everInvited(kv, address);
    return { status: 200, body: { ok: true, eligible, status: auth.status, enrolled, declined, dropped, address: address || null, addressSource: address ? source : null, optedOut, nextCall } };
  }

  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let action;
  let wanted;
  try {
    const payload = await request.json();
    action = payload?.action;
    wanted = payload?.address;
  } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  if (action !== 'leave' && action !== 'rejoin') {
    return { status: 400, body: { error: 'invalid', message: 'action must be "leave" or "rejoin"' } };
  }

  // sow-466: an address sent with a rejoin means "put me on the call at THIS address". It is stored before
  // the calendar is touched, for the same reason the opt-out marker is: if the calendar call fails, the next
  // sweep must already know which address is theirs, or it enrolls the billing one and the member is back
  // where they started.
  let movedFrom = '';
  if (wanted !== undefined && wanted !== null && wanted !== '') {
    if (action !== 'rejoin') {
      return { status: 400, body: { error: 'invalid', message: 'an address can only be set when joining the call list' } };
    }
    if (!eligible) {
      return { status: 403, body: { error: 'not_eligible', message: 'the Saturday call is for paid and trial members' } };
    }
    const next = normalizeAddress(wanted);
    if (!isEmailShape(next)) {
      return { status: 400, body: { error: 'invalid_address', message: 'That does not look like an email address.' } };
    }
    const rl = await rateLimit({ kv, id: auth.githubId, ...SHOPTALK_ADDRESS_LIMIT });
    if (!rl.allowed) {
      return { status: 429, body: { error: 'rate_limited', message: 'That is a lot of address changes. Try again tomorrow.' } };
    }
    const current = await addressFor(env, auth.githubId, { kv, stripe, lookupEmail });
    movedFrom = current.address && current.address !== next ? current.address : '';
    await kv.put(SHOPTALK_ADDRESS_KEY(auth.githubId), JSON.stringify({ address: next, at: new Date().toISOString() }));
  }

  // THE MARKER IS WRITTEN BEFORE THE CALENDAR IS TOUCHED, and the order is load-bearing. If the calendar call
  // fails after the marker is set, the member is still opted out and the next sweep completes the removal. The
  // other order leaves somebody removed from the call with nothing recording that they asked, so the sweep
  // puts them back and mails them an invitation they did not want.
  if (action === 'leave') {
    await kv.put(optKey, JSON.stringify({ optedOut: true, at: new Date().toISOString() }));
  } else {
    if (!eligible) {
      return { status: 403, body: { error: 'not_eligible', message: 'the Saturday call is for paid and trial members' } };
    }
    await kv.delete(optKey);
  }

  const { address } = await addressFor(env, auth.githubId, { kv, stripe, lookupEmail });
  if (!address) {
    return { status: 200, body: { ok: true, optedOut: action === 'leave', enrolled: null, address: null, applied: false,
      message: 'we have no email address for this account, so the guest list could not be changed' } };
  }
  // A LEAVE without a reachable calendar is still recorded: the marker is set and the sweep completes the
  // removal (rule 2's backstop). A REJOIN without one is an ERROR, not a promise: under rule 5 the sweep never
  // re-adds an address it has seen, so "the invitation goes out on the next sweep" would be a promise nothing
  // keeps. The member is told to try again instead.
  const unavailable = { status: 503, body: { error: 'calendar_unavailable', message: 'The calendar could not be reached just now. Try again in a few minutes.' } };
  const recorded = { status: 200, body: { ok: true, optedOut: true, enrolled: null, address, applied: false,
    message: 'recorded; the change reaches the calendar on the next sweep' } };
  if (!calendar) return action === 'leave' ? recorded : unavailable;

  const s = seriesFromInstances(await calendar.nextOccurrences(SHOPTALK_QUERY));
  if (isSeriesProblem(s)) return action === 'leave' ? recorded : unavailable;
  const read = (await readGuests(calendar, s.seriesId)) || { guests: [], declined: new Set() };
  // sow-466: a member who moved their seat has their OLD address taken off in the same request. Leaving it
  // holds two seats on one person, and the stale one keeps receiving the Meet link at the address they just
  // told us they do not read. The removal is silent: a cancellation notice for a seat they never saw is mail
  // about nothing, and `sendUpdates: 'all'` on the add below is the one message they asked for.
  const moved = movedFrom && read.guests.includes(movedFrom);
  if (moved) {
    await calendar.setAttendees(s.seriesId, read.guests.filter((g) => g !== movedFrom), { sendUpdates: 'none' });
  }
  const guests = moved ? read.guests.filter((g) => g !== movedFrom) : read.guests;
  const has = guests.includes(address);

  if (action === 'leave') {
    if (has) await calendar.setAttendees(s.seriesId, guests.filter((g) => g !== address), { sendUpdates: 'all' });
    return { status: 200, body: { ok: true, optedOut: true, enrolled: false, address, applied: has } };
  }

  // Rejoin. Three cases, each with exactly the mail the member asked for and no more:
  //   not on the list         -> added, one invitation (sendUpdates=all mails only the added guest)
  //   on the list, declined   -> taken off with NO mail, put back with one invitation: a fresh RSVP
  //   on the list, not declined -> nothing to do, and the page says so
  if (!has) {
    await calendar.setAttendees(s.seriesId, [...guests, address], { sendUpdates: 'all' });
    return { status: 200, body: { ok: true, optedOut: false, enrolled: true, address, applied: true, moved: !!moved } };
  }
  if (read.declined.has(address)) {
    await calendar.setAttendees(s.seriesId, guests.filter((g) => g !== address), { sendUpdates: 'none' });
    await calendar.setAttendees(s.seriesId, [...guests.filter((g) => g !== address), address], { sendUpdates: 'all' });
    return { status: 200, body: { ok: true, optedOut: false, enrolled: true, address, applied: true, resent: true, moved: !!moved } };
  }
  return { status: 200, body: { ok: true, optedOut: false, enrolled: true, address, applied: false, moved: !!moved,
    message: moved ? 'Your seat moved to this address.' : 'You are already on the guest list.' } };
}

/** SOW-024 right-to-erasure: drop the member's opt-out marker and the address they chose (sow-466). Both are
 *  per-person records keyed by account number. The calendar seat is removed separately. */
export async function eraseMemberShoptalk(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv || githubId == null) return { ok: false };
  await kv.delete(SHOPTALK_OPTOUT_KEY(String(githubId)));
  await kv.delete(SHOPTALK_ADDRESS_KEY(String(githubId)));
  return { ok: true };
}
