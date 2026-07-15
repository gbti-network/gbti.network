// SOW-119: the PURE coupon-pool edit core. Given the PARSED house/coupons.yml plus an action, each
// function returns { next, changed, audit } exactly like news-source-edits.mjs: `next` is the new parsed
// doc (the caller serializes + commits it via the SOW-005 PR flow), `changed` is false when the action is
// already satisfied (idempotent), `audit` is an identity-minimal log entry for the PR body. Node-free.
//
// SECURITY: this only COMPUTES the file edit. Authorization is CODEOWNERS (house/** is admin-owned) +
// no-bypass branch protection + the metadata-only gate; a non-admin PR touching house/coupons.yml is
// auto-rejected regardless of what this computes.

import { normalizeCouponCode, COUPON_CODE_RE } from './coupons.mjs';

export class CouponEditError extends Error {}

const MAX_NOTE = 160;

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new CouponEditError('invalid timestamp');
  return d.toISOString();
}

function auditEntry(ctx, action, code, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { code },
    detail: detail ?? null,
  };
}

function listOf(parsed) {
  return Array.isArray(parsed?.coupons) ? parsed.coupons.map((c) => ({ ...c })) : [];
}

function checkDays(freeDays) {
  const days = Number(freeDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new CouponEditError('freeDays must be an integer 1-3650');
  return days;
}
function checkMax(maxRedemptions) {
  if (maxRedemptions === undefined || maxRedemptions === null || maxRedemptions === '') return null;
  const n = Number(maxRedemptions);
  if (!Number.isInteger(n) || n < 1) throw new CouponEditError('maxRedemptions must be a positive integer or empty (unlimited)');
  return n;
}
function checkExpires(expiresAt) {
  if (expiresAt === undefined || expiresAt === null || expiresAt === '') return null;
  if (Number.isNaN(new Date(expiresAt).getTime())) throw new CouponEditError('expiresAt must be an ISO date or empty');
  return String(expiresAt);
}

/** Add a coupon. Errors on a duplicate code (updating is its own explicit action). */
export function addCouponEdit(parsed, { code, freeDays, note, maxRedemptions, expiresAt } = {}, ctx) {
  const c = normalizeCouponCode(code);
  if (!COUPON_CODE_RE.test(c)) throw new CouponEditError('a coupon code is 3-32 chars A-Z 0-9');
  const days = checkDays(freeDays);
  const coupons = listOf(parsed);
  if (coupons.some((e) => normalizeCouponCode(e?.code) === c)) throw new CouponEditError(`coupon ${c} already exists`);
  coupons.push({
    code: c,
    freeDays: days,
    active: true,
    note: String(note ?? '').slice(0, MAX_NOTE),
    maxRedemptions: checkMax(maxRedemptions),
    expiresAt: checkExpires(expiresAt),
  });
  return { next: { ...parsed, coupons }, changed: true, audit: auditEntry(ctx, 'coupon-add', c, { freeDays: days }) };
}

/**
 * Update a coupon: any of { freeDays, active, note, maxRedemptions, expiresAt }. Idempotent: a patch that
 * changes nothing returns changed:false. An existing redemption keeps its original grant; edits shape
 * FUTURE redemptions only.
 */
export function updateCouponEdit(parsed, { code, patch } = {}, ctx) {
  const c = normalizeCouponCode(code);
  const coupons = listOf(parsed);
  const idx = coupons.findIndex((e) => normalizeCouponCode(e?.code) === c);
  if (idx === -1) throw new CouponEditError(`no such coupon: ${c}`);
  const cur = coupons[idx];
  const nextEntry = { ...cur };
  const p = patch || {};
  const detail = {};
  if (p.freeDays !== undefined) { nextEntry.freeDays = checkDays(p.freeDays); detail.freeDays = nextEntry.freeDays; }
  if (p.active !== undefined) { nextEntry.active = p.active === true || p.active === 'true'; detail.active = nextEntry.active; }
  if (p.note !== undefined) { nextEntry.note = String(p.note ?? '').slice(0, MAX_NOTE); detail.note = true; }
  if (p.maxRedemptions !== undefined) { nextEntry.maxRedemptions = checkMax(p.maxRedemptions); detail.maxRedemptions = nextEntry.maxRedemptions; }
  if (p.expiresAt !== undefined) { nextEntry.expiresAt = checkExpires(p.expiresAt); detail.expiresAt = nextEntry.expiresAt; }
  if (Object.keys(detail).length === 0) throw new CouponEditError('nothing to update');
  const changed = JSON.stringify(nextEntry) !== JSON.stringify(cur);
  if (!changed) return { next: parsed, changed: false, audit: auditEntry(ctx, 'coupon-update', c, detail) };
  coupons[idx] = nextEntry;
  return { next: { ...parsed, coupons }, changed: true, audit: auditEntry(ctx, 'coupon-update', c, detail) };
}
