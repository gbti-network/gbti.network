// sow-293: the CREATOR APPLICATION routes. Content Creator stopped being a tier anyone could buy and became
// one granted by application plus superadmin approval, so there are three surfaces here: a member submits,
// a superadmin lists, a superadmin decides.
//
// AUTHORIZATION, and why each is what it is:
//   submit  -> authorizeMemberCheap. Signed in and not banned is the whole bar: a free member applying to
//              become a creator is the ENTIRE point, so gating on paid would close the door this opens. It
//              is the `cheap` variant because the decision is identity plus the ban mirror and never reads
//              paid-vs-trial, so a live Stripe call would buy nothing and add a failure mode.
//   list    -> authorizeSuperadmin. An application is a person writing prose about themselves.
//   decide  -> authorizeSuperadmin. Approving GRANTS A REAL TIER, so it sits at the same bar as the other
//              governance writes rather than at the admin bar.
//
// THE APPLICATION IS PER-PERSON PRIVATE STATE, so it lives in KV keyed by github_id and never in the public
// repo (CLAUDE.md's storage boundary; the same rule that moved bans and grandfather grants out of git in
// sow-213). `application:` is registered in BACKED_UP_PREFIXES, because KV is its only copy.

import { authorizeMemberCheap } from './membership-content.mjs';
import { authorizeSuperadmin } from './membership-admin.mjs';
import { writeOverrideToKv } from './membership-override-kv.mjs';
import { TIER } from '../../membership/tiers.mjs';
import {
  APPLICATION_STATE,
  APPLICATION_KEY_PREFIX,
  MAX_APPLICATION_WHY,
  MAX_APPLICATION_LINKS,
  MAX_APPLICATION_TOPICS,
  applicationKey,
  newApplication,
  applicationState,
  canSubmit,
  decideApplication,
  sortApplications,
} from '../../membership/creator-applications.mjs';

/** The grant reason a creator application writes, so the origin of a tier is legible in the override entry. */
export const CREATOR_APPLICATION_REASON = 'creator-application';

const bad = (status, error, message) => ({ status, body: { ok: false, error, message } });

/** Read one application record, or null. A value that will not parse reads as null so nothing acts on junk. */
async function readApplication(kv, githubId) {
  try {
    const rec = await kv.get(applicationKey(githubId), 'json');
    return rec && typeof rec === 'object' ? rec : null;
  } catch { return null; }
}

/**
 * POST /membership/creator-application -> store (or replace) the caller's application.
 * Body: { why, links?, topics? }
 *
 * The record is written BEFORE the owner notice fires (the caller sends the notice through ctx.waitUntil),
 * which is what makes a fail-soft notice safe: a lost email costs awareness of a pending application, never
 * the application. See creator-application-alert.mjs.
 */
export async function creatorApplicationSubmit(request, env, { authorize = authorizeMemberCheap, now = new Date(), ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env?.SIGNUP_KV;
  if (!kv) return bad(503, 'unavailable', 'the edge store is not reachable right now');

  let body;
  try { body = await request.json(); } catch { body = null; }
  const why = typeof body?.why === 'string' ? body.why.trim() : '';
  if (!why) return bad(400, 'bad_request', 'tell us why you want to contribute as a writer');

  // Reject over-long input rather than silently truncating it. The core bounds what it STORES either way, but
  // an applicant who wrote 4000 characters and had half of it disappear with a success message would never
  // know, and would be judged on a truncated answer.
  const tooLong = [
    ['why', why, MAX_APPLICATION_WHY],
    ['links', typeof body?.links === 'string' ? body.links : '', MAX_APPLICATION_LINKS],
    ['topics', typeof body?.topics === 'string' ? body.topics : '', MAX_APPLICATION_TOPICS],
  ].find(([, value, max]) => value.length > max);
  if (tooLong) return bad(400, 'too_long', `${tooLong[0]} is too long (max ${tooLong[2]} characters)`);

  const existing = await readApplication(kv, auth.githubId);
  if (!canSubmit(existing)) {
    return bad(409, 'already_approved', 'your application was already approved; you hold the Content Creator plan');
  }

  const record = newApplication({
    githubId: auth.githubId,
    login: auth.login ?? null,
    why,
    links: typeof body?.links === 'string' ? body.links : '',
    topics: typeof body?.topics === 'string' ? body.topics : '',
    now,
  });
  try {
    await kv.put(applicationKey(auth.githubId), JSON.stringify(record));
  } catch {
    return bad(503, 'unavailable', 'your application could not be saved; please try again');
  }
  // The record is returned so the caller can fire the owner notice on exactly what was stored, rather than on
  // the request body it was built from.
  return { status: 200, body: { ok: true, application: record }, record };
}

/** GET /membership/admin/creator-applications -> every application, pending work first. */
export async function creatorApplicationList(request, env, { authorize = authorizeSuperadmin, ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env?.SIGNUP_KV;
  if (!kv) return bad(503, 'unavailable', 'the edge store is not reachable right now');

  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: APPLICATION_KEY_PREFIX, cursor });
    for (const k of page?.keys ?? []) names.push(k.name);
    cursor = page?.list_complete ? null : page?.cursor;
  } while (cursor);

  const applications = [];
  for (const name of names) {
    const id = name.slice(APPLICATION_KEY_PREFIX.length);
    const rec = await readApplication(kv, id);
    if (!rec) continue;
    const state = applicationState(rec);
    // A record that parses but is STRUCTURALLY BAD resolves to `unknown` and is kept deliberately, following
    // the invites lane: dropping it would make a corrupt application invisible to the only surface that could
    // notice. The KV key travels alongside so it can be found even when the record's own githubId disagrees
    // with where it is stored. It is NOT decidable, so it cannot be approved into a real tier grant.
    applications.push(state === APPLICATION_STATE.unknown
      ? { ...rec, githubId: rec.githubId || id, key: name, state, corrupt: true }
      : { ...rec, state });
  }
  return { status: 200, body: { ok: true, applications: sortApplications(applications) } };
}

/**
 * POST /membership/admin/creator-applications/decide -> approve or decline one application.
 * Body: { githubId, decision: 'approved'|'declined', note? }
 *
 * THE ORDER IS DELIBERATE AND IT IS THE ONLY INTERESTING THING IN THIS FUNCTION. On an approval the tier
 * GRANT is written first, and the application record is only marked approved once that succeeded.
 *
 * Both orders can be interrupted between the two writes, so the question is which half-done state is
 * survivable. Grant first, record second: a failure leaves the tier granted and the application still
 * pending, so it shows up in the lane again and a second approval re-writes the same grant idempotently.
 * Record first, grant second: a failure leaves an application marked approved with NO tier granted, which
 * nothing in the lane will ever show again, so the applicant is told yes and gets nothing.
 */
export async function creatorApplicationDecide(request, env, { authorize = authorizeSuperadmin, now = new Date(), writeGrant = null, ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env?.SIGNUP_KV;
  if (!kv) return bad(503, 'unavailable', 'the edge store is not reachable right now');

  let body;
  try { body = await request.json(); } catch { body = null; }
  const githubId = String(body?.githubId ?? '').trim();
  const decision = String(body?.decision ?? '').trim();
  if (!githubId) return bad(400, 'bad_request', 'githubId is required');
  if (decision !== APPLICATION_STATE.approved && decision !== APPLICATION_STATE.declined) {
    return bad(400, 'bad_request', 'decision must be approved or declined');
  }

  const record = await readApplication(kv, githubId);
  if (!record) return bad(404, 'not_found', 'no application for that github_id');
  const state = applicationState(record);
  if (state !== APPLICATION_STATE.pending) {
    // `unknown` lands here too, which is the point: a corrupt record is visible in the lane but must never be
    // approvable, because approving one grants a real tier against whatever identity the broken record carries.
    return bad(409, 'not_pending', `this application is ${state}, so there is no decision left to make`);
  }

  if (decision === APPLICATION_STATE.approved) {
    const entry = {
      ...(record.login ? { login: record.login } : {}),
      reason: CREATOR_APPLICATION_REASON,
      tier: TIER.creator,
      // No `until`: a grant is permanent by default (CLAUDE.md), and Content Creator is free on approval with
      // pricing revisited later (owner answer 2, 2026-08-29). An expiry here would silently demote a creator.
    };
    // Injectable for the same reason scripts/lib/coupon-grants.mjs injects its writer: the ORDER of the grant
    // against the record write is the load-bearing property here, and it cannot be asserted without observing
    // both halves. Defaults to the real writer, so production has no test-only branch.
    const write = writeGrant || ((args) => writeOverrideToKv({ kv, ...args }));
    let wrote;
    try {
      wrote = await write({ section: 'grandfathered', githubId, entry, remove: false });
    } catch (err) {
      return bad(503, 'grant_failed', `the Content Creator grant could not be written: ${err?.message ?? err}`);
    }
    // `written: false` is NOT always an error here (the writer reports "already in that state" for a grant that
    // exists), but a refusal to write IS, and the two must not be conflated: reporting success on a refused
    // grant would mark the application approved with no tier behind it.
    if (!wrote?.written && !/already/i.test(String(wrote?.reason ?? ''))) {
      return bad(503, 'grant_failed', `the Content Creator grant could not be written: ${wrote?.reason ?? 'unknown reason'}`);
    }
  }

  const decided = decideApplication(record, {
    decision,
    by: auth.githubId,
    byLogin: auth.login ?? null,
    note: typeof body?.note === 'string' ? body.note : '',
    now,
  });
  try {
    await kv.put(applicationKey(githubId), JSON.stringify(decided));
  } catch {
    // On an approval the grant already landed, so the member HAS the tier. Say so rather than implying nothing
    // happened: a caller told "failed" would reasonably retry, and the retry is safe, but they should know the
    // access is already live.
    return bad(503, 'unavailable', decision === APPLICATION_STATE.approved
      ? 'the Content Creator grant was written but the application record was not updated; the member has access, retry to record it'
      : 'the application record could not be updated; please try again');
  }
  return { status: 200, body: { ok: true, application: { ...decided, state: applicationState(decided) } } };
}
