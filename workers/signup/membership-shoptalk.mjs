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
import { ELIGIBLE_STATUSES, normalizeAddress } from '../../scripts/lib/shoptalk-enroll.mjs';
import { seriesFromInstances, isSeriesProblem } from '../../membership/shoptalk-series.mjs';

export const SHOPTALK_OPTOUT_KEY = (githubId) => `shoptalk:optout:${githubId}`;
export const SHOPTALK_QUERY = 'Shop TALK';

/** Resolve the member's calendar address. Same Stripe lookup the mail drain uses; no second source of truth. */
async function addressFor(env, githubId, { stripe, lookupEmail } = {}) {
  if (lookupEmail) return normalizeAddress(await lookupEmail(githubId));
  if (!stripe) return '';
  const customer = await stripe.searchCustomerByGithubId(githubId);
  return normalizeAddress(customer?.email || '');
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
    const address = await addressFor(env, auth.githubId, { stripe, lookupEmail });
    // The calendar is optional on a READ. If it is unreachable the member still gets their eligibility and
    // opt-out state rather than an error page, and `enrolled` is reported as unknown rather than as false.
    // Reporting "not on the list" when we simply could not look would invite them to press a button they do
    // not need, and would be a lie told confidently.
    let enrolled = null;
    let nextCall = null;
    if (calendar) {
      const s = seriesFromInstances(await calendar.nextOccurrences(SHOPTALK_QUERY));
      if (!isSeriesProblem(s)) {
        nextCall = s.startsAt;
        const guests = await calendar.listAttendees(s.seriesId);
        if (guests) enrolled = address ? guests.includes(address) : false;
      }
    }
    return { status: 200, body: { ok: true, eligible, status: auth.status, enrolled, address: address || null, optedOut, nextCall } };
  }

  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let action;
  try { action = (await request.json())?.action; } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  if (action !== 'leave' && action !== 'rejoin') {
    return { status: 400, body: { error: 'invalid', message: 'action must be "leave" or "rejoin"' } };
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

  const address = await addressFor(env, auth.githubId, { stripe, lookupEmail });
  if (!address) {
    return { status: 200, body: { ok: true, optedOut: action === 'leave', enrolled: null, address: null, applied: false,
      message: 'we have no email address for this account, so the guest list could not be changed' } };
  }
  if (!calendar) {
    return { status: 200, body: { ok: true, optedOut: action === 'leave', enrolled: null, address, applied: false,
      message: 'recorded; the change reaches the calendar on the next sweep' } };
  }

  const s = seriesFromInstances(await calendar.nextOccurrences(SHOPTALK_QUERY));
  if (isSeriesProblem(s)) {
    return { status: 200, body: { ok: true, optedOut: action === 'leave', enrolled: null, address, applied: false,
      message: 'recorded; the change reaches the calendar on the next sweep' } };
  }
  const guests = (await calendar.listAttendees(s.seriesId)) || [];
  const has = guests.includes(address);
  let next = guests;
  if (action === 'leave' && has) next = guests.filter((g) => g !== address);
  if (action === 'rejoin' && !has) next = [...guests, address];
  if (next !== guests) await calendar.setAttendees(s.seriesId, next, { sendUpdates: 'all' });

  return { status: 200, body: { ok: true, optedOut: action === 'leave', enrolled: action === 'rejoin', address, applied: next !== guests } };
}

/** SOW-024 right-to-erasure: drop the member's opt-out marker. The calendar seat is removed separately. */
export async function eraseMemberShoptalk(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv || githubId == null) return { ok: false };
  await kv.delete(SHOPTALK_OPTOUT_KEY(String(githubId)));
  return { ok: true };
}
