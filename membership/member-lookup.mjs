// sow-331: the PURE half of the superadmin member lookup (the IO half is workers/signup/membership-member-lookup.mjs).
// No network, no KV, no clock: every input is passed in, so each rule is unit tested directly.
//
// The owner's request (2026-09-14): "From super admin i need to be able to search an email address and find out
// everything we know about a member." The superadmin types an email or a GitHub username; this file decides what
// the query is, merges the matches each resolution path produced, and reduces each store to what a person reads.
//
// A STORE THAT COULD NOT BE READ IS NEVER SHOWN AS EMPTY. Every section is { ok: true, data } or { ok: false, reason }.
// "No favorites" and "could not read favorites" collapse to the same summary if a read failure is allowed to become an
// empty value, and the superadmin would act on the wrong one. The IO half runs every read inside `section()` below.
//
// Every summarizer runs the store's OWN normalizer rather than restating its shape here, so a store that changes shape
// changes this view with it instead of drifting from it.

import { normalizeActivity } from './member-activity.mjs';
import { normalizeFollows } from './member-follows.mjs';
import { normalizeFollowers } from './member-followers.mjs';
import { normalizePrefs } from './member-prefs.mjs';
import { normalizeNotifications, unseenCount } from './member-notifications.mjs';
import { normalizeDrafts } from './member-drafts.mjs';
import { normalizeSubscriber, wantsDigest } from './mail-subscriber.mjs';
import { applicationState } from './creator-applications.mjs';
import { inviteSummary } from './invites.mjs';
import {
  rolesFromParsed, bansFromParsed, grandfathersFromParsed, newsEditorsFromParsed, roleOf, effectiveStatus, grandfatherActive,
} from './overrides-core.mjs';
import { safeSearchEmail, safeSearchLogin } from '../clients/stripe.mjs';

const GITHUB_ID_RE = /^\d{1,20}$/;

/**
 * What the superadmin typed: { kind: 'email' | 'login' | 'invalid', value }. The box is trimmed here (a person pasting
 * an address picks up spaces); the shape check is the Stripe client's own, so the query this accepts is exactly the
 * one the search will not refuse. A leading @ reads as a username, not an address.
 */
export function classifyQuery(q) {
  const raw = String(q ?? '').trim();
  if (raw.includes('@') && !raw.startsWith('@')) {
    const email = safeSearchEmail(raw);
    return email ? { kind: 'email', value: email } : { kind: 'invalid', value: '' };
  }
  const login = safeSearchLogin(raw.replace(/^@/, ''));
  return login ? { kind: 'login', value: login } : { kind: 'invalid', value: '' };
}

export function isGithubId(v) {
  return GITHUB_ID_RE.test(String(v ?? '').trim());
}

/**
 * Merge resolution hits into candidates, one per github_id. A hit is { githubId, via, login?, stripeStatus? }. Each
 * candidate keeps every path that matched it (`via`), so an account found by a single path is visible as such.
 * Ordered by how many paths agreed, then by id, so the list is stable between identical searches.
 */
export function mergeCandidates(hits = []) {
  const byId = new Map();
  for (const h of hits) {
    if (!h || !isGithubId(h.githubId)) continue;
    const id = String(h.githubId).trim();
    const c = byId.get(id) || { githubId: id, via: [], logins: [], stripeStatus: null };
    if (h.via && !c.via.includes(h.via)) c.via.push(h.via);
    const login = String(h.login ?? '').trim();
    if (login && !c.logins.some((l) => l.toLowerCase() === login.toLowerCase())) c.logins.push(login);
    if (h.stripeStatus && !c.stripeStatus) c.stripeStatus = h.stripeStatus;
    byId.set(id, c);
  }
  return [...byId.values()].sort((a, b) => b.via.length - a.via.length || a.githubId.localeCompare(b.githubId));
}

export const ok = (data) => ({ ok: true, data });
export const unreadable = (reason = 'could not read') => ({ ok: false, reason });

/** Run one read as a section: its value on success, { ok: false } on any throw. Never an empty stand-in. */
export async function section(fn) {
  try { return ok(await fn()); } catch { return unreadable(); }
}

const iso = (v) => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};
const arr = (v) => (Array.isArray(v) ? v : []);

/** A Stripe Customer, reduced to what a superadmin reads. `membership` is { status, tier } from the derive helper. */
export function summarizeCustomer(customer, membership = null) {
  if (!customer) return null;
  const m = customer.metadata || {};
  return {
    customerId: customer.id ?? null,
    email: customer.email ?? null,
    name: customer.name ?? null,
    created: iso(customer.created),
    login: m.github_login || null,
    discordUserId: m.discord_user_id || null,
    trialStartedAt: m.trial_started_at || null,
    signupSource: m.signup_source || null,
    referredBy: m.referred_by || null,
    connectAccountId: m.connect_account_id || null,
    stripeStatus: membership?.status ?? null,
    stripeTier: membership?.tier ?? null,
    subscriptions: arr(customer.subscriptions?.data).map((s) => ({
      id: s.id ?? null,
      status: s.status ?? null,
      priceId: s.items?.data?.[0]?.price?.id ?? null,
      currentPeriodEnd: iso(s.current_period_end),
      cancelAtPeriodEnd: s.cancel_at_period_end === true,
    })),
  };
}

/**
 * The member's standing from the overrides mirror plus the Stripe-derived status: the effective status and where it
 * comes from (ban > staff > grandfather > Stripe), the staff role, the ban WITH its reason (this is a superadmin-only
 * view; the public admin list strips reasons), and the grandfather grant. `stripe` is null when Stripe was unreadable,
 * and then the effective status is only reported when an override decides it without Stripe.
 */
export function summarizeStanding(mirror, githubId, stripe = null, now = new Date()) {
  const id = String(githubId);
  const overrides = {
    roles: rolesFromParsed(mirror?.roles),
    bans: bansFromParsed(mirror?.bans),
    grandfathers: grandfathersFromParsed(mirror?.grandfathered),
  };
  const role = roleOf(id, overrides.roles);
  const ban = overrides.bans.get(id) || null;
  const grant = overrides.grandfathers.get(id) || null;
  let effective = effectiveStatus(id, stripe?.status ?? 'unknown', overrides, now);
  if (!stripe && effective.source === 'stripe') effective = { status: 'unknown', source: 'stripe-unreadable' };
  return {
    mirrorGeneratedAt: mirror?.generatedAt ?? null,
    effectiveStatus: effective.status,
    effectiveSource: effective.source,
    role,
    newsEditor: newsEditorsFromParsed(mirror?.roles).has(id),
    ban: ban ? { reason: ban.reason ?? null, at: ban.at ?? null, login: ban.login ?? null } : null,
    grandfather: grant
      ? { reason: grant.reason ?? null, until: grant.until ?? null, tier: grant.tier ?? null, active: grandfatherActive(id, overrides.grandfathers, now) }
      : null,
  };
}

export function summarizeApplication(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    state: applicationState(raw),
    submittedAt: raw.submittedAt ?? null,
    why: raw.why ?? '',
    links: raw.links ?? '',
    topics: raw.topics ?? '',
    decidedAt: raw.decidedAt ?? null,
    decidedByLogin: raw.decidedByLogin ?? null,
    decisionNote: raw.decisionNote ?? '',
  };
}

/** The one-per-member coupon lock plus every code this account redeemed (read from the redemption KEYS alone). */
export function summarizeCoupons(grantRaw, redemptionKeyNames = [], githubId, now = new Date()) {
  const id = String(githubId);
  const redeemed = [];
  for (const name of arr(redemptionKeyNames)) {
    const m = /^redemption:([A-Z0-9]{3,32}):(\d+)$/.exec(String(name));
    if (m && m[2] === id) redeemed.push(m[1]);
  }
  let grant = null;
  if (grantRaw && typeof grantRaw === 'object') {
    const until = grantRaw.until ? new Date(grantRaw.until) : null;
    const active = Boolean(until) && !Number.isNaN(until.getTime()) && now.getTime() < until.getTime();
    grant = { code: grantRaw.code ?? null, until: grantRaw.until ?? null, active };
  }
  return { grant, redeemed: redeemed.sort() };
}

/** Invites this account issued or redeemed, from the invite records the IO half read. */
export function invitesFor(records = [], githubId, now = new Date()) {
  const id = String(githubId);
  const issued = [];
  const redeemed = [];
  for (const rec of arr(records)) {
    if (!rec || typeof rec !== 'object') continue;
    if (String(rec.issuedBy ?? '') === id) issued.push(inviteSummary(rec, now));
    if (String(rec.redeemedBy ?? '') === id) redeemed.push(inviteSummary(rec, now));
  }
  const newest = (a, b) => String(b.issuedAt ?? '').localeCompare(String(a.issuedAt ?? ''));
  return { issued: issued.sort(newest), redeemed: redeemed.sort(newest) };
}

export function summarizeActivity(raw) {
  const a = normalizeActivity(raw);
  return {
    favorites: a.favorites.length,
    collections: a.collections.map((c) => ({ name: c.name, items: c.items.length })),
    updatedAt: iso(a.updatedAt),
  };
}

export function summarizeFollows(raw) {
  const f = normalizeFollows(raw);
  return { count: f.following.length, usernames: f.following.map((e) => e.username) };
}

export function summarizeFollowers(raw) {
  return { count: normalizeFollowers(raw).followers.length };
}

export function summarizePrefs(raw) {
  if (raw == null) return null;
  const p = normalizePrefs(raw);
  return {
    topics: p.categories.length,
    newsChannels: p.followedChannels.length,
    tags: p.followedTags.length,
    publicFavorites: p.publicFavorites,
    notificationDefaultsSet: Boolean(p.notify),
  };
}

export function summarizeNotifications(raw) {
  const n = normalizeNotifications(raw);
  return { total: n.items.length, unseen: unseenCount(n) };
}

/** Draft titles are the member's unpublished writing, so only the item key and when it was saved are shown. */
export function summarizeDrafts(raw) {
  return Object.entries(normalizeDrafts(raw).items)
    .map(([key, v]) => ({ key, updatedAt: iso(v?.updatedAt) }))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

export function summarizeEarnings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    totals: raw.totals && typeof raw.totals === 'object' ? raw.totals : null,
    entries: arr(raw.entries).length,
    payoutConnected: raw.payoutSetup?.connected === true,
    payoutReady: raw.payoutSetup?.ready === true,
  };
}

export function summarizeConversion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    conversionAt: iso(raw.conversionAt),
    inviter: raw.inviter ?? null,
    firstOwner: raw.firstOwner ?? null,
    lastOwner: raw.lastOwner ?? null,
    frozenAt: iso(raw.frozenAt),
  };
}

/** Moderation history entries (the audit records appendModerationLog wrote), newest first. */
export function summarizeModeration(entries = []) {
  return arr(entries)
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      at: e.at ?? null,
      action: e.action ?? null,
      actorLogin: e.actor?.login ?? null,
      actorId: e.actor?.github_id ?? null,
      reason: e.detail?.reason ?? null,
    }))
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}

/**
 * One mail subscriber record with its block and bounce state. `where` says how it was found ('account email' for the
 * hash of the Stripe email, 'member record' for the scan by github_id, 'searched address' for a non-member lookup).
 */
export function summarizeMailEntry({ record = null, suppressed = false, softBounce = null, where = null } = {}) {
  const rec = normalizeSubscriber(record);
  return {
    where,
    subscribed: Boolean(rec),
    source: rec?.source ?? null,
    status: rec?.status ?? null,
    receivesDigest: rec ? wantsDigest(rec) : false,
    digestOff: rec?.digestOff === true,
    createdAt: iso(rec?.createdAt),
    welcomedAt: iso(rec?.welcomedAt),
    unsubscribeBlock: Boolean(suppressed),
    softBounces: softBounce && typeof softBounce === 'object' ? Number(softBounce.n) || 0 : 0,
  };
}

const TYPE_LABEL = { post: 'articles', project: 'projects', prompt: 'prompts', share: 'shares' };

/**
 * The member's published content from the site's public indexes, filtered by folder username. Every item is kept (the
 * page shows counts plus the five latest and expands the rest from this same payload), newest first. Members-only
 * shares never reach the public index, so the page says the share count covers public shares only.
 */
export function contentForUsername(username, { activity = null, shares = null, comments = null } = {}) {
  const u = String(username ?? '').trim().toLowerCase();
  const out = { articles: [], projects: [], prompts: [], shares: [], comments: [] };
  if (!u) return out;
  const mine = (e) => String(e?.author ?? '').toLowerCase() === u;
  const seen = new Set();
  for (const e of [...arr(activity?.entries), ...arr(shares?.entries)]) {
    const label = TYPE_LABEL[e?.type];
    if (!label || !mine(e)) continue;
    const key = `${e.type}:${e.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out[label].push({ title: e.title || e.slug || '', url: e.url ?? null, at: Number(e.publishedAt) || 0, visibility: e.visibility ?? null });
  }
  for (const c of arr(comments?.items)) {
    if (!mine(c)) continue;
    out.comments.push({ id: c.id ?? null, target: `${c.targetType ?? ''}/${c.targetSlug ?? ''}`, at: Date.parse(c.createdAt) || 0, visibility: c.visibility ?? null });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.at - a.at);
  return out;
}
