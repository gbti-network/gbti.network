// SOW-046 (B/E): the member-prefs model — category interests + FOLLOWED NEWS CHANNELS (news source ids) — for the
// deletable edge store (prefs:<github_id> in SIGNUP_KV). Pure + node-free, like member-follows.mjs: the Worker
// handler does the KV read-modify-write; these transforms validate / dedupe / cap. GDPR-erasable (a hard KV delete
// of the key; wired into sop-member-erasure.md alongside activity + follows).

import { normalizeNotify } from './notify-resolve.mjs';
import { normalizeOnboarding, isEmptyOnboarding, isStepKey, isOnboardingKey, cleanKeys, cleanSocials, MAX_NETWORK_FOLLOWS, MAX_HANDLE } from './onboarding.mjs';

export class PrefsError extends Error {}

const MAX_CATEGORIES = 200; // raised from 40 for the topic picker's Select all (the vocabulary is 85 topics today)
const MAX_CHANNELS = 300;
// sow-307: followed TAGS. Tags are free-form on content, so the stored set is bounded three ways: a shape (a
// lowercase slug, 1 to 40 characters), a dedupe, and a CAP of 50 (owner decision 2026-09-08). Past the cap a
// toggle is REFUSED with a message naming the limit rather than silently dropping one, so the panel can say so.
export const MAX_TAGS = 50;
const TAG = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** One tag as stored: trimmed, lowercased, a leading '#' dropped; null when it is not a tag at all. */
export function normalizeTag(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/^#+/, '').toLowerCase();
  return TAG.test(t) ? t : null;
}
/** A followed-tags list as stored: each normalized, deduped, capped at MAX_TAGS. */
export function cleanTags(v, max = MAX_TAGS) {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const t = normalizeTag(x);
    if (!t || out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
// A category label or a news source id (both config-defined in the news worker): a bounded token set so a stored
// pref can never smuggle anything unexpected into a query or the UI.
const TOKEN = /^[a-z0-9][a-z0-9 ._/+-]{0,60}$/i;

function cleanList(v, max) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(v) ? v : []) {
    if (typeof x !== 'string') continue; // stored prefs are JSON string arrays; drop anything non-string
    const s = x.trim();
    if (!s || !TOKEN.test(s)) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Normalize a stored prefs record to { categories, followedChannels, publicFavorites } (arrays deduped +
 *  capped; publicFavorites strictly boolean, default false = SOW-114 opt-in consent to appear in the public
 *  "Favorited by" aggregate). */
export function normalizePrefs(stored) {
  const p = stored && typeof stored === 'object' ? stored : {};
  const out = {
    categories: cleanList(p.categories, MAX_CATEGORIES),
    followedChannels: cleanList(p.followedChannels, MAX_CHANNELS),
    followedTags: cleanTags(p.followedTags), // sow-307
    publicFavorites: p.publicFavorites === true,
  };
  // SOW-186: the member's GLOBAL notification defaults, the (content-type x channel) matrix that applies to
  // any followed member without a per-follow override. Only present when set, so a member who never touched it
  // keeps the record's prior shape and resolveNotify falls through to SYSTEM_NOTIFY_DEFAULT (email OFF).
  const notify = normalizeNotify(p.notify);
  if (notify) out.notify = notify;
  // sow-343: onboarding progress (skips, GBTI channels opened, a trial member's kept social handles). Present only
  // once something is stored, the same rule as notify, so an untouched record keeps its shape.
  const onboarding = normalizeOnboarding(p.onboarding);
  if (onboarding) out.onboarding = onboarding;
  return out;
}

/** sow-343: apply the onboarding patches to a normalized prefs object (mutates `next`). */
function applyOnboardingPatch(next, patch) {
  if (patch.onboarding !== undefined) {
    // The one whole-block write is a CLEAR (the account page's "reset the welcome process"). A caller cannot
    // hand over a block wholesale: every other change goes through a patch that validates its one field.
    if (patch.onboarding !== null) throw new PrefsError('onboarding can only be cleared (null)');
    delete next.onboarding;
  }
  const touched = patch.onboardingSkip !== undefined || patch.onboardingFollows !== undefined
    || patch.onboardingSocials !== undefined || patch.onboardingSocialsSaved !== undefined;
  if (!touched) return;
  const ob = next.onboarding ?? { skipped: [], networkFollows: [], socials: {}, socialsSaved: false };
  if (patch.onboardingSkip !== undefined) {
    const step = patch.onboardingSkip?.step;
    if (!isStepKey(step)) throw new PrefsError('a known welcome step is required');
    const on = patch.onboardingSkip.on !== false;
    ob.skipped = on ? cleanKeys([...ob.skipped, step], 20) : ob.skipped.filter((k) => k !== step);
  }
  if (patch.onboardingFollows !== undefined) {
    // Add only. Nothing in the wizard un-follows, and a stale tab must not be able to erase another tab's ticks.
    if (!Array.isArray(patch.onboardingFollows) || !patch.onboardingFollows.every(isOnboardingKey)) {
      throw new PrefsError('onboardingFollows must be a list of channel keys');
    }
    const merged = [...ob.networkFollows, ...patch.onboardingFollows.filter((k) => !ob.networkFollows.includes(k))];
    if (merged.length > MAX_NETWORK_FOLLOWS) throw new PrefsError(`too many followed channels (the limit is ${MAX_NETWORK_FOLLOWS})`);
    ob.networkFollows = cleanKeys(merged, MAX_NETWORK_FOLLOWS);
  }
  if (patch.onboardingSocials !== undefined) {
    const v = patch.onboardingSocials;
    if (v !== null && (typeof v !== 'object' || Array.isArray(v))) throw new PrefsError('onboardingSocials must be an object of handles');
    if (v && Object.values(v).some((h) => typeof h === 'string' && h.trim().length > MAX_HANDLE)) {
      throw new PrefsError(`a social handle is too long (the limit is ${MAX_HANDLE} characters)`);
    }
    ob.socials = cleanSocials(v);
  }
  if (patch.onboardingSocialsSaved !== undefined) {
    if (typeof patch.onboardingSocialsSaved !== 'boolean') throw new PrefsError('onboardingSocialsSaved must be a boolean');
    ob.socialsSaved = patch.onboardingSocialsSaved;
    // A save that landed clears the handles it was carrying (a publish clears its own draft record).
    if (ob.socialsSaved) ob.socials = {};
  }
  if (isEmptyOnboarding(ob)) delete next.onboarding;
  else next.onboarding = ob;
}

/**
 * Apply a prefs patch and return the new normalized prefs. Patch shapes:
 *  - { categories: string[] }                 replace the category interests
 *  - { followChannel: { id, on } }            follow (on!==false) / unfollow a news source id
 *  - { followedTags: string[] }               sow-307: replace the followed tags (the one-time browser -> account push)
 *  - { followTag: { tag, on } }               sow-307: follow / unfollow one tag; refused past MAX_TAGS
 *  - { publicFavorites: boolean }             SOW-114: opt in/out of the public "Favorited by" list
 *  - { notify: { [type]: { api?, email? } } } SOW-186: set the global notification defaults matrix
 *                                             (null or {} clears it, falling back to the system default)
 *  - sow-343 onboarding progress:
 *    { onboardingSkip: { step, on } }         mark / unmark a welcome step as skipped (known steps only)
 *    { onboardingFollows: string[] }          add GBTI channels the member opened (add only, capped)
 *    { onboardingSocials: object | null }     replace / clear the social handles kept for a trial member
 *    { onboardingSocialsSaved: boolean }      the handles reached the profile (true also clears them)
 *    { onboarding: null }                     clear all of it (the account page's welcome reset)
 * Throws PrefsError on an invalid patch. Idempotent (re-following a channel is a no-op).
 */
export function applyPrefs(stored, patch = {}) {
  const next = normalizePrefs(stored);
  applyOnboardingPatch(next, patch);
  if (patch.categories !== undefined) {
    if (!Array.isArray(patch.categories)) throw new PrefsError('categories must be an array');
    next.categories = cleanList(patch.categories, MAX_CATEGORIES);
  }
  if (patch.notify !== undefined) {
    if (patch.notify !== null && (typeof patch.notify !== 'object' || Array.isArray(patch.notify))) {
      throw new PrefsError('notify must be an object');
    }
    const n = normalizeNotify(patch.notify);
    if (n) next.notify = n; else delete next.notify;
  }
  if (patch.publicFavorites !== undefined) {
    if (typeof patch.publicFavorites !== 'boolean') throw new PrefsError('publicFavorites must be a boolean');
    next.publicFavorites = patch.publicFavorites;
  }
  if (patch.followedTags !== undefined) {
    if (!Array.isArray(patch.followedTags)) throw new PrefsError('followedTags must be an array');
    if (patch.followedTags.length > MAX_TAGS) throw new PrefsError(`too many followed tags (the limit is ${MAX_TAGS})`);
    next.followedTags = cleanTags(patch.followedTags);
  }
  if (patch.followTag) {
    const tag = normalizeTag(patch.followTag.tag);
    if (!tag) throw new PrefsError('a valid tag is required (letters, digits and hyphens, up to 40 characters)');
    const on = patch.followTag.on !== false;
    const has = next.followedTags.includes(tag);
    if (on && !has) {
      if (next.followedTags.length >= MAX_TAGS) throw new PrefsError(`too many followed tags (the limit is ${MAX_TAGS})`);
      next.followedTags.push(tag);
    } else if (!on && has) {
      next.followedTags = next.followedTags.filter((t) => t !== tag);
    }
  }
  if (patch.followChannel) {
    const id = String(patch.followChannel.id ?? '').trim();
    if (!id || !TOKEN.test(id)) throw new PrefsError('a valid channel id is required');
    const on = patch.followChannel.on !== false;
    const lc = id.toLowerCase();
    const has = next.followedChannels.some((c) => c.toLowerCase() === lc);
    if (on && !has) {
      if (next.followedChannels.length >= MAX_CHANNELS) throw new PrefsError('too many followed channels');
      next.followedChannels.push(id);
    } else if (!on && has) {
      next.followedChannels = next.followedChannels.filter((c) => c.toLowerCase() !== lc);
    }
  }
  return next;
}
