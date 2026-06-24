// SOW-058 (+ SOW-057): the syndication configuration shared by the signup Worker drain, the reconcile mirror,
// and the SOW-057 share-upvote threshold. Reads house/syndication-config.yml and normalizes it into a safe,
// validated config. Pure functions operate on already-parsed objects (fixture-testable); loadSyndicationConfig
// reads + parses the file for node callers.
//
// Everything fails closed to the SAFE default:
//   enabled            master switch. A missing/unparseable file or key leaves this false, so nothing is ever
//                      auto-syndicated by accident.
//   hold_minutes       the deliberate delay before a queued item goes out (default 60). The superadmin can
//                      cancel during this window. Coerced to a non-negative integer.
//   upvote_threshold   SOW-057: distinct non-author members required to enqueue a share (default 2). Coerced
//                      to an integer >= 1; a smaller/invalid value falls back to the default (never below 1).
//   channels           per-channel master switches. Default false. A channel still also requires its secret
//                      to be present at drain time (a flag-on channel with no secret is recorded "skipped").
//
// The config carries NO secrets; channel API tokens live only in the Worker secret store. Reconcile mirrors the
// normalized config (minus nothing sensitive) to the KV key `synd:config` so the Worker reads the live values
// without a redeploy (the overrides:mirror precedent).

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const SYNDICATION_CONFIG_PATH = 'house/syndication-config.yml';
export const SYNDICATION_MIRROR_KEY = 'synd:config';

// The canonical channel set. Adding a channel here makes it a recognized, normalizable flag.
export const CHANNELS = Object.freeze(['discord', 'x', 'linkedin', 'mastodon', 'bluesky']);

export const DEFAULT_SYNDICATION_CONFIG = Object.freeze({
  enabled: false,
  require_approval: true, // SOW-058: opt-IN by default — NOTHING posts until a superadmin approves it
  hold_minutes: 60,
  upvote_threshold: 2,
  channels: Object.freeze({ discord: false, x: false, linkedin: false, mastodon: false, bluesky: false }),
});

function asBool(v, fallback) {
  if (v === true || v === false) return v;
  if (v === 1 || v === 0) return v === 1; // YAML may parse a bare 1/0 as a number
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === 'on' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === 'off' || s === '0') return false;
  }
  return fallback;
}

function asHoldMinutes(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function asThreshold(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i >= 1 ? i : fallback; // never below 1 (a threshold of 0 would syndicate on any single vote)
}

function normalizeChannels(raw) {
  const out = {};
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const name of CHANNELS) out[name] = asBool(src[name], DEFAULT_SYNDICATION_CONFIG.channels[name]);
  return Object.freeze(out);
}

/**
 * Normalize a parsed syndication-config.yml ({ syndication: {...} } or a bare {...}) into a validated config.
 * Unknown/missing keys fall back to DEFAULT_SYNDICATION_CONFIG. Never throws.
 */
export function syndicationConfigFromParsed(parsed) {
  const raw = parsed?.syndication ?? parsed ?? {};
  const d = DEFAULT_SYNDICATION_CONFIG;
  return Object.freeze({
    enabled: asBool(raw.enabled, d.enabled),
    require_approval: asBool(raw.require_approval, d.require_approval),
    hold_minutes: asHoldMinutes(raw.hold_minutes, d.hold_minutes),
    upvote_threshold: asThreshold(raw.upvote_threshold, d.upvote_threshold),
    channels: normalizeChannels(raw.channels),
  });
}

/** Master switch: may anything be enqueued/syndicated at all? */
export function isSyndicationEnabled(cfg) {
  return cfg?.enabled === true;
}

/** SOW-058: when true (the default), the drain posts ONLY superadmin-approved items; a pending item never posts on
 *  its own. Fail-safe: anything other than an explicit false means approval IS required. */
export function requiresApproval(cfg) {
  return cfg?.require_approval !== false;
}

/** The hold window in milliseconds (hold_minutes * 60000). */
export function holdMs(cfg) {
  return asHoldMinutes(cfg?.hold_minutes, DEFAULT_SYNDICATION_CONFIG.hold_minutes) * 60_000;
}

/** The SOW-057 distinct-non-author-voter threshold. */
export function upvoteThreshold(cfg) {
  return asThreshold(cfg?.upvote_threshold, DEFAULT_SYNDICATION_CONFIG.upvote_threshold);
}

/** Is a given channel switched on in config? (Its secret presence is checked separately at drain time.) */
export function isChannelEnabled(cfg, name) {
  return cfg?.channels?.[name] === true;
}

/** The list of channel names switched on in config (still subject to secret presence at drain time). */
export function enabledChannelNames(cfg) {
  return CHANNELS.filter((name) => isChannelEnabled(cfg, name));
}

/** The small, secret-free object reconcile writes to the KV mirror (synd:config) and the Worker reads back. */
export function toSyndicationMirror(cfg) {
  const c = syndicationConfigFromParsed(cfg);
  return { enabled: c.enabled, require_approval: c.require_approval, hold_minutes: c.hold_minutes, upvote_threshold: c.upvote_threshold, channels: { ...c.channels } };
}

/** Read + normalize house/syndication-config.yml from a repo root. Missing/unparseable file = safe defaults. */
export function loadSyndicationConfig(root) {
  const file = path.join(root, 'house', 'syndication-config.yml');
  if (!fs.existsSync(file)) return syndicationConfigFromParsed({});
  try {
    return syndicationConfigFromParsed(yaml.load(fs.readFileSync(file, 'utf8')) ?? {});
  } catch {
    return syndicationConfigFromParsed({}); // an unparseable config must never enable syndication
  }
}
