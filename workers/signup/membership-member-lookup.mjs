// sow-331: GET /membership/admin/member-lookup, the superadmin member lookup (the pure half is
// membership/member-lookup.mjs). The owner asked (2026-09-14) to "search an email address and find out everything we
// know about a member". Superadmins only, view only, and lookups are NOT recorded (all three are owner decisions).
//
//   ?q=<email or GitHub username>   resolve to member accounts: none, one (the record), or several (a list to pick from)
//   ?githubId=<id>                  the record for one account, which is how the page opens a picked candidate
//
// WHAT "EVERYTHING WE KNOW" COVERS, and where each part comes from. The per-member stores are the ones the erasure tool
// deletes (scripts/lib/erase-member.mjs is the inventory), so this view and erasure describe the same set:
//   Stripe Customer (email, metadata, subscriptions)   the overrides mirror (role, ban with reason, grandfather grant)
//   application: coupon-grant: redemption: invite:    activity: follows: followers: prefs: notifications: drafts:
//   earnings: conv: shoptalk:optout: shoptalk:seen     modlog:<id>:   the mail subscriber, block and bounce records
//   published content from the site's public indexes
//
// EACH SECTION FAILS ON ITS OWN AND SAYS SO. A store that could not be read comes back { ok: false, reason } and the page
// shows "could not read", never an empty value. The same rule applies one level up: a search where one resolution path
// failed reports which path failed, so "no member found" is only ever said when every path was actually searched.
//
// COST BOUNDS. At most three Stripe calls per request (one search, one Customer read, one login search), the sweeps over
// shared prefixes (invite:, mail:subscriber:) are budgeted, and the whole request stays well inside the Worker's
// per-invocation operation cap. A per-caller rate limit protects the Stripe search quota.
//
// THE SEARCHED ADDRESS IS NEVER LOGGED. Nothing here writes a log line carrying the query.

import { authorizeSuperadmin } from './membership-admin.mjs';
import { OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from './membership-content.mjs';
import { rateLimit } from './abuse.mjs';
import { getInstallationToken } from './github-app.mjs';
import { scanForOwnRecord } from './membership-digest.mjs';
import { softBounceKey } from './resend-webhook.mjs';
import { couponGrantKey } from './coupons.mjs';
import { EARNINGS_KEY } from './membership-earnings.mjs';
import { CONV_KEY } from './conversion-snapshot-store.mjs';
import { SHOPTALK_OPTOUT_KEY, SHOPTALK_SEEN_KEY } from './membership-shoptalk.mjs';
import { MODLOG_PREFIX } from './membership-override-kv.mjs';
import { createStripeClient } from '../../clients/stripe.mjs';
import { deriveMembershipFromCustomer } from '../../membership/derive-status.mjs';
import { buildEnvPriceTierMap } from '../../membership/tier-gate.mjs';
import { parseMembersIndex } from '../../membership/hosted-author.mjs';
import { mailHash, subscriberKey, suppressKey } from '../../membership/mail-suppress.mjs';
import { normalizeSubscriber } from '../../membership/mail-subscriber.mjs';
import { applicationKey } from '../../membership/creator-applications.mjs';
import { INVITE_KEY_PREFIX } from '../../membership/invites.mjs';
import { ACTIVITY_KEY } from './membership-activity.mjs';
import { FOLLOWS_KEY } from './membership-follows.mjs';
import { FOLLOWERS_KEY } from '../../membership/member-followers.mjs';
import { PREFS_KEY } from './membership-prefs.mjs';
import { NOTIFICATIONS_KEY } from './membership-notifications.mjs';
import { DRAFTS_KEY } from './membership-drafts.mjs';
import { normalizeAddress } from '../../scripts/lib/shoptalk-enroll.mjs';
import {
  classifyQuery, isGithubId, mergeCandidates, section, ok, unreadable,
  summarizeCustomer, summarizeStanding, summarizeApplication, summarizeCoupons, invitesFor, summarizeActivity,
  summarizeFollows, summarizeFollowers, summarizePrefs, summarizeNotifications, summarizeDrafts, summarizeEarnings,
  summarizeConversion, summarizeModeration, summarizeMailEntry, contentForUsername,
} from '../../membership/member-lookup.mjs';

export const LOOKUP_RATE = { limit: 30, windowSeconds: 600, prefix: 'rl:memberlookup:' };
/** The most invite records one lookup reads. Past it the invites section says it is incomplete. */
export const INVITE_READ_BUDGET = 200;
/** The most subscriber records one lookup reads while looking for the member's record under an older address. */
export const MAIL_SCAN_BUDGET = 250;
/** The most moderation log entries one lookup reads. */
export const MODLOG_READ_LIMIT = 25;
/** Key-only listing pages over redemption: (1000 keys a page). */
const REDEMPTION_PAGE_LIMIT = 10;

const GH = 'https://api.github.com';

/** A read failure whose message is safe to show a superadmin in place of the generic "could not read". */
class LookupError extends Error {}

/** section(), but a LookupError keeps its message as the reason. */
async function part(fn) {
  try { return ok(await fn()); } catch (err) { return err instanceof LookupError ? unreadable(err.message) : unreadable(); }
}

const bad = (status, error, message) => ({ status, body: { error, message } });

/** The overrides mirror, read fail-closed exactly as the admin overrides endpoint reads it. */
async function readMirror(kv, now) {
  const mirror = await kv.get(OVERRIDES_KV_KEY, 'json');
  if (!mirror || !mirror.generatedAt) throw new LookupError('the overrides mirror is missing');
  const age = now.getTime() - new Date(mirror.generatedAt).getTime();
  if (!Number.isFinite(age) || age < 0 || age > MAX_OVERRIDES_AGE_MS) throw new LookupError('the overrides mirror is out of date');
  return mirror;
}

/** github_id -> folder username, from the live house/members-index.yml on main (the same read the author picker makes). */
async function defaultReadMembersIndex(env, { fetchImpl, kv }) {
  const token = await getInstallationToken(env, { fetchImpl, kv });
  const upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network';
  const res = await fetchImpl(`${GH}/repos/${upstream}/contents/house/members-index.yml?ref=main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' },
  });
  if (!res || !res.ok) throw new LookupError('the member index could not be read from GitHub');
  const data = await res.json();
  return parseMembersIndex(atob(String(data?.content || '').replace(/\n/g, '')));
}

async function defaultReadIndex(siteBase, path, fetchImpl) {
  const res = await fetchImpl(`${String(siteBase || 'https://gbti.network').replace(/\/$/, '')}${path}`, { headers: { Accept: 'application/json' } });
  if (!res || !res.ok) throw new LookupError(`the site index ${path} could not be read`);
  return res.json();
}

/** Every key name under a prefix, at most `maxPages` pages; throws when the listing would have gone further. */
async function listNames(kv, prefix, maxPages) {
  const names = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of res?.keys ?? []) names.push(k.name);
    if (res?.list_complete !== false || !res?.cursor) return names;
    cursor = res.cursor;
  }
  throw new LookupError(`there are more ${prefix} records than one lookup lists`);
}

const statusOf = (customer, env, now) => {
  try { return deriveMembershipFromCustomer(customer, { priceTierMap: buildEnvPriceTierMap(env), now }).status; } catch { return null; }
};

/**
 * Resolve an email or a username to member accounts. Returns { hits, searched, nonMember }: `searched` names each path
 * and whether it was actually searched; `nonMember` is what the mail store holds for a searched address.
 */
async function resolveQuery(query, ctx) {
  const { kv, env, stripe, now } = ctx;
  const hits = [];
  const searched = {};
  let nonMember = null;

  if (query.kind === 'email') {
    const email = query.value;
    searched.stripe = await part(async () => {
      if (!stripe) throw new LookupError('Stripe is not configured');
      const found = await stripe.searchCustomersByEmail(email);
      const unlinked = [];
      for (const c of found) {
        const githubId = String(c?.metadata?.github_id ?? '');
        if (isGithubId(githubId)) hits.push({ githubId, via: 'stripe-email', login: c?.metadata?.github_login, stripeStatus: statusOf(c, env, now) });
        else unlinked.push({ customerId: c?.id ?? null, created: c?.created ? new Date(c.created * 1000).toISOString() : null });
      }
      return { matches: found.length, unlinkedCustomers: unlinked };
    });
    searched.digest = await part(async () => {
      if (!env?.MAIL_SUPPRESS_KEY) throw new LookupError('the mail key is not configured');
      const hash = await mailHash(env.MAIL_SUPPRESS_KEY, email);
      const record = await kv.get(subscriberKey(hash), 'json');
      const rec = normalizeSubscriber(record);
      if (rec?.source === 'member' && isGithubId(rec.githubId)) hits.push({ githubId: rec.githubId, via: 'digest-record' });
      nonMember = summarizeMailEntry({
        record,
        suppressed: (await kv.get(suppressKey(hash))) != null,
        softBounce: await kv.get(softBounceKey(hash), 'json'),
        where: 'searched address',
      });
      return { found: Boolean(rec) };
    });
    searched.shoptalk = await part(async () => {
      const seen = await ctx.seen();
      const id = String(seen?.[normalizeAddress(email)] ?? '');
      if (isGithubId(id)) hits.push({ githubId: id, via: 'shoptalk' });
      return { found: isGithubId(id) };
    });
  } else {
    const login = query.value;
    const lower = login.toLowerCase();
    searched.membersIndex = await part(async () => {
      const index = await ctx.membersIndex();
      let found = 0;
      for (const [githubId, username] of index) if (username === lower) { hits.push({ githubId, via: 'members-index', login: username }); found += 1; }
      return { found };
    });
    searched.stripe = await part(async () => {
      if (!stripe) throw new LookupError('Stripe is not configured');
      const found = await stripe.searchCustomersByLogin(login);
      for (const c of found) {
        const githubId = String(c?.metadata?.github_id ?? '');
        if (isGithubId(githubId)) hits.push({ githubId, via: 'stripe-login', login: c?.metadata?.github_login, stripeStatus: statusOf(c, env, now) });
      }
      return { found: found.length };
    });
    searched.overrides = await part(async () => {
      const mirror = await ctx.mirror();
      const lists = [mirror?.roles?.superadmins, mirror?.roles?.admins, mirror?.roles?.moderators, mirror?.bans?.bans, mirror?.grandfathered?.grandfathered];
      let found = 0;
      for (const list of lists) {
        for (const e of Array.isArray(list) ? list : []) {
          if (String(e?.login ?? '').toLowerCase() !== lower) continue;
          const githubId = String(e?.github_id ?? '');
          if (isGithubId(githubId)) { hits.push({ githubId, via: 'overrides', login: e.login }); found += 1; }
        }
      }
      return { found };
    });
  }
  return { hits, searched, nonMember };
}

/** Read the Customer for one account: the gh: index then a point read (consistent), else the id search. */
async function readCustomer(kv, stripe, githubId) {
  if (!stripe) throw new LookupError('Stripe is not configured');
  const cached = await kv.get(`gh:${githubId}`);
  if (cached) {
    const c = await stripe.getCustomer(cached);
    if (c && !c.deleted) return c;
  }
  return stripe.searchCustomerByGithubId(githubId);
}

/** The member's mail records: at the hash of the account email, then (if that is not their own record) the bounded scan. */
async function readMail(kv, env, githubId, email) {
  const entries = [];
  const entryAt = async (hash, record, where) => summarizeMailEntry({
    record,
    suppressed: (await kv.get(suppressKey(hash))) != null,
    softBounce: await kv.get(softBounceKey(hash), 'json'),
    where,
  });
  let ownFound = false;
  if (email) {
    if (!env?.MAIL_SUPPRESS_KEY) throw new LookupError('the mail key is not configured');
    const hash = await mailHash(env.MAIL_SUPPRESS_KEY, email);
    const record = await kv.get(subscriberKey(hash), 'json');
    const rec = normalizeSubscriber(record);
    entries.push(await entryAt(hash, record, 'account email'));
    ownFound = rec?.source === 'member' && rec.githubId === githubId;
  }
  let searchComplete = true;
  if (!ownFound) {
    const scan = await scanForOwnRecord(kv, githubId, { budget: MAIL_SCAN_BUDGET });
    if (scan.error) throw new LookupError('a subscriber record could not be read during the search');
    if (scan.rec) entries.push(await entryAt(scan.rec.hash, scan.rec, 'member record'));
    else if (scan.exhausted) searchComplete = false;
  }
  return { accountEmailChecked: Boolean(email), entries, searchComplete, scanBudget: MAIL_SCAN_BUDGET };
}

async function readInvites(kv, githubId, now) {
  const names = await listNames(kv, INVITE_KEY_PREFIX, 5);
  const records = [];
  for (const name of names.slice(0, INVITE_READ_BUDGET)) records.push(await kv.get(name, 'json'));
  return { ...invitesFor(records, githubId, now), complete: names.length <= INVITE_READ_BUDGET, read: Math.min(names.length, INVITE_READ_BUDGET), total: names.length };
}

async function readModeration(kv, githubId) {
  const res = await kv.list({ prefix: `${MODLOG_PREFIX}${githubId}:`, limit: MODLOG_READ_LIMIT });
  const entries = [];
  for (const k of res?.keys ?? []) entries.push(await kv.get(k.name, 'json'));
  return { entries: summarizeModeration(entries), complete: res?.list_complete !== false };
}

const kvJson = (kv, key) => kv.get(key, 'json');

/** Assemble the full record for one github_id. Every section is independent; none can blank another. */
async function assembleRecord(githubId, ctx) {
  const { kv, env, stripe, now } = ctx;
  const account = await part(async () => {
    const customer = await readCustomer(kv, stripe, githubId);
    return customer ? summarizeCustomer(customer, deriveMembershipFromCustomer(customer, { priceTierMap: buildEnvPriceTierMap(env), now })) : null;
  });
  const stripeStatus = account.ok ? { status: account.data?.stripeStatus ?? 'none' } : null;
  const username = await part(async () => (await ctx.membersIndex()).get(githubId) ?? null);

  const sections = {
    account,
    standing: await part(async () => summarizeStanding(await ctx.mirror(), githubId, stripeStatus, now)),
    username,
    application: await section(async () => summarizeApplication(await kvJson(kv, applicationKey(githubId)))),
    coupons: await part(async () => summarizeCoupons(
      await kvJson(kv, couponGrantKey(githubId)),
      await listNames(kv, 'redemption:', REDEMPTION_PAGE_LIMIT),
      githubId,
      now,
    )),
    invites: await part(() => readInvites(kv, githubId, now)),
    activity: await section(async () => summarizeActivity(await kvJson(kv, ACTIVITY_KEY(githubId)))),
    follows: await section(async () => summarizeFollows(await kvJson(kv, FOLLOWS_KEY(githubId)))),
    followers: await section(async () => summarizeFollowers(await kvJson(kv, FOLLOWERS_KEY(githubId)))),
    prefs: await section(async () => summarizePrefs(await kvJson(kv, PREFS_KEY(githubId)))),
    notifications: await section(async () => summarizeNotifications(await kvJson(kv, NOTIFICATIONS_KEY(githubId)))),
    drafts: await section(async () => summarizeDrafts(await kvJson(kv, DRAFTS_KEY(githubId)))),
    earnings: await section(async () => summarizeEarnings(await kvJson(kv, EARNINGS_KEY(githubId)))),
    conversion: await section(async () => summarizeConversion(await kvJson(kv, CONV_KEY(githubId)))),
    shoptalk: await section(async () => {
      const optedOut = (await kv.get(SHOPTALK_OPTOUT_KEY(githubId))) != null;
      const seen = await ctx.seen();
      const invitedAddresses = Object.entries(seen || {}).filter(([, id]) => String(id) === githubId).map(([address]) => address);
      return { optedOut, invitedAddresses };
    }),
    moderation: await section(() => readModeration(kv, githubId)),
    mail: await part(() => {
      if (!account.ok) return readMail(kv, env, githubId, null);
      return readMail(kv, env, githubId, account.data?.email ? String(account.data.email).toLowerCase() : null);
    }),
    content: await part(async () => {
      if (!username.ok) throw new LookupError('the member index could not be read, so the folder is unknown');
      if (!username.data) return { username: null, items: null };
      const [activity, shares, comments] = await Promise.all([
        ctx.readIndex('/activity-index.json'), ctx.readIndex('/shares-index.json'), ctx.readIndex('/comments-index.json'),
      ]);
      return { username: username.data, items: contentForUsername(username.data, { activity, shares, comments }) };
    }),
  };
  return { githubId, sections };
}

/** Memoize one async read per request, so the mirror, the members index and shoptalk:seen are each read once. */
function once(fn) {
  let p = null;
  return () => { if (!p) p = fn(); return p; };
}

export async function membershipMemberLookup(request, env, deps = {}) {
  const {
    kv = env?.SIGNUP_KV, authorize = authorizeSuperadmin, stripe: injectedStripe, limiter = rateLimit,
    fetchImpl = globalThis.fetch, readMembersIndex = defaultReadMembersIndex, readIndex = null, now = new Date(), ...authDeps
  } = deps;
  if (!kv) return bad(500, 'misconfigured', 'the member store is not configured');

  const auth = await authorize(request, env, { ...authDeps, fetchImpl, now, allowCookie: true });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (request.method !== 'GET') return bad(405, 'method_not_allowed', 'use GET');

  const rl = await limiter({ kv, id: String(auth.githubId), ...LOOKUP_RATE });
  if (!rl.allowed) return bad(429, 'rate_limited', 'Too many lookups in a short time. Try again in a few minutes.');

  const stripe = injectedStripe !== undefined ? injectedStripe : (env?.STRIPE_SECRET_KEY ? createStripeClient({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl }) : null);
  const ctx = {
    kv, env, stripe, now,
    mirror: once(() => readMirror(kv, now)),
    membersIndex: once(() => readMembersIndex(env, { fetchImpl, kv })),
    seen: once(async () => {
      const raw = await kv.get(SHOPTALK_SEEN_KEY, 'json');
      return raw && typeof raw === 'object' ? raw : {};
    }),
    readIndex: readIndex || ((path) => defaultReadIndex(env?.SITE_BASE_URL, path, fetchImpl)),
  };

  const url = new URL(request.url);
  const idParam = url.searchParams.get('githubId');
  if (idParam !== null) {
    if (!isGithubId(idParam) || idParam !== idParam.trim()) return bad(400, 'bad_request', 'That is not a GitHub account id.');
    return { status: 200, body: { ok: true, kind: 'member', record: await assembleRecord(idParam, ctx) } };
  }

  const query = classifyQuery(url.searchParams.get('q'));
  if (query.kind === 'invalid') return bad(400, 'bad_request', 'Type an email address or a GitHub username.');

  const { hits, searched, nonMember } = await resolveQuery(query, ctx);
  const candidates = mergeCandidates(hits);
  const everySearched = Object.values(searched).every((s) => s.ok);
  if (candidates.length === 0) {
    return { status: 200, body: { ok: true, kind: 'none', queryKind: query.kind, searched, everySearched, nonMember } };
  }
  if (candidates.length === 1) {
    return { status: 200, body: { ok: true, kind: 'member', queryKind: query.kind, searched, everySearched, via: candidates[0].via, record: await assembleRecord(candidates[0].githubId, ctx) } };
  }
  return { status: 200, body: { ok: true, kind: 'candidates', queryKind: query.kind, searched, everySearched, candidates } };
}
