// Referral revenue-share configuration (SOW-007). Reads house/referral-config.yml and normalizes it
// into a safe, validated config object that the signup Worker, the reconcile, and the payout job all
// share. Pure functions operate on already-parsed objects (fixture-testable); loadReferralConfig reads
// and parses the file for real callers.
//
// Switch semantics (deliberately independent, all fail closed to the SAFE default):
//   attribution_enabled  capture referred_by at signup. Independent of `enabled` so attribution can run
//                        SILENTLY from launch (capture first-touch before the feature is advertised).
//   accrual_enabled      compute the commission ledger. Also independent of `enabled` (track from day one).
//   enabled              master switch for the USER-FACING feature: the per-content join CTA, the Connect
//                        onboarding entry point, and the terms link. Does NOT gate silent attribution/accrual.
//   payouts_enabled      actually move money via Connect. Requires BOTH `enabled` AND `payouts_enabled`
//                        (a globally disabled feature must never transfer), so isPayoutsActive is the AND.
//
// rate is clamped to [0, 1]; hold_days is coerced to a non-negative integer. A missing file or key falls
// back to DEFAULT_REFERRAL_CONFIG (payouts OFF), so no misconfiguration can accidentally pay out.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const DEFAULT_REFERRAL_CONFIG = Object.freeze({
  enabled: false,
  attribution_enabled: true,
  accrual_enabled: true,
  payouts_enabled: false,
  rate: 0.30,
  hold_days: 90,
});

function asBool(v, fallback) {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === 'on' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === 'off' || s === '0') return false;
  }
  return fallback;
}

function asRate(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function asHoldDays(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/**
 * Normalize a parsed referral-config.yml ({ referral: {...} } or a bare {...}) into a validated config.
 * Unknown/missing keys fall back to DEFAULT_REFERRAL_CONFIG. Never throws.
 */
export function referralConfigFromParsed(parsed) {
  const raw = parsed?.referral ?? parsed ?? {};
  const d = DEFAULT_REFERRAL_CONFIG;
  return Object.freeze({
    enabled: asBool(raw.enabled, d.enabled),
    attribution_enabled: asBool(raw.attribution_enabled, d.attribution_enabled),
    accrual_enabled: asBool(raw.accrual_enabled, d.accrual_enabled),
    payouts_enabled: asBool(raw.payouts_enabled, d.payouts_enabled),
    rate: asRate(raw.rate, d.rate),
    hold_days: asHoldDays(raw.hold_days, d.hold_days),
  });
}

/** Capture referred_by at signup? Independent of the master switch (silent from launch). */
export function isAttributionActive(cfg) {
  return cfg.attribution_enabled === true;
}

/** Compute the commission ledger? Independent of the master switch (track from day one). */
export function isAccrualActive(cfg) {
  return cfg.accrual_enabled === true;
}

/** Advertise the user-facing feature (CTA, Connect onboarding, terms link)? Gated by the master switch. */
export function isFeatureAdvertised(cfg) {
  return cfg.enabled === true;
}

/** Actually transfer money via Connect? Requires the master switch AND payouts_enabled (fail closed). */
export function isPayoutsActive(cfg) {
  return cfg.enabled === true && cfg.payouts_enabled === true;
}

/** Read + normalize house/referral-config.yml from a repo root. Missing file = safe defaults. */
export function loadReferralConfig(root) {
  const file = path.join(root, 'house', 'referral-config.yml');
  if (!fs.existsSync(file)) return referralConfigFromParsed({});
  try {
    return referralConfigFromParsed(yaml.load(fs.readFileSync(file, 'utf8')) ?? {});
  } catch {
    return referralConfigFromParsed({}); // unparseable config must never enable payouts
  }
}
