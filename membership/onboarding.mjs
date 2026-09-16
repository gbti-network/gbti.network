// sow-343: onboarding progress. The ONE list of welcome steps, the shape of what is stored about them, and the
// merge that turns real account state plus that stored record into a per-step state.
//
// WHY A RECORD AT ALL. The welcome wizard re-derives its position every time it opens, which is right for the
// wizard and useless for anything else: the knowledge existed only while the page was open, so nothing could
// remind a member who had not finished. Owner, 2026-09-16: "we need to record onboarding progress and nag them to
// complete it".
//
// DERIVE FIRST, STORE ONLY WHAT CANNOT BE DERIVED. Four of the five steps have real state somewhere (the Discord
// link, the follow graph, the saved topics, the profile links), and that state always wins. The record holds only
// what no server can tell us: which steps the member skipped, which of GBTI's social accounts they opened (no
// platform reports a follow back), and the social handles a trial member typed before they could publish a
// profile. A member who did the work months ago reads as done with no migration.
//
// It lives on the existing prefs:<github_id> record (member-prefs.mjs), so it is served, erased and cleared by
// machinery that already exists. Node-free and pure: the Worker, the three hosts and the tests import it.

/** The welcome steps, in order. `key` values are STORED (skips), so they never change; `subreddit` is the
 *  historical name of the "follow GBTI's channels" step, kept for that reason. `title` is the WorkBench card's
 *  wording; `label`, `sub` and `heading` are the wizard's rail and page heading. */
export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({ key: 'discord', label: 'Discord', sub: 'Join the community', heading: 'Connect Discord', title: 'Connect Discord' }),
  Object.freeze({ key: 'subreddit', label: 'Follow', sub: 'Network channels', heading: 'Follow the channels', title: 'Follow the network channels' }),
  Object.freeze({ key: 'socials', label: 'Socials', sub: 'Your handles', heading: 'Add your socials', title: 'Add your social handles' }),
  Object.freeze({ key: 'follow', label: 'Members', sub: 'People to follow', heading: 'Follow members', title: 'Follow other members' }),
  Object.freeze({ key: 'topics', label: 'Topics', sub: 'Tune your feed', heading: 'Follow topics', title: 'Pick your topics' }),
]);

export const ONBOARDING_STEP_KEYS = Object.freeze(ONBOARDING_STEPS.map((s) => s.key));

// A channel key (reddit, x, bluesky...) or a social key (website, linkedin...): lowercase, short, no punctuation
// beyond a hyphen. Bounded so a stored value can never carry anything but a key.
const KEY = /^[a-z][a-z0-9-]{0,39}$/;
export const MAX_NETWORK_FOLLOWS = 40;
export const MAX_SOCIALS = 30;
export const MAX_HANDLE = 200;

export const isStepKey = (v) => typeof v === 'string' && ONBOARDING_STEP_KEYS.includes(v);
export const isOnboardingKey = (v) => typeof v === 'string' && KEY.test(v);

/** A list of keys as stored: key-shaped only, deduped, capped. `allow` narrows it further (the step keys). */
export function cleanKeys(v, max, allow = null) {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    if (!isOnboardingKey(x) || (allow && !allow.includes(x)) || out.includes(x)) continue;
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

/** Social handles as stored: key-shaped keys, trimmed non-empty strings of at most MAX_HANDLE characters with no
 *  control characters, at most MAX_SOCIALS of them. Anything else is dropped, never coerced. */
export function cleanSocials(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, raw] of Object.entries(v)) {
    if (!isOnboardingKey(k) || typeof raw !== 'string') continue;
    const s = raw.trim();
    if (!s || s.length > MAX_HANDLE || /[\x00-\x1f\x7f]/.test(s)) continue;
    out[k] = s;
    if (++n >= MAX_SOCIALS) break;
  }
  return out;
}

/** The stored block, normalized; null when there is nothing in it, so an untouched record keeps its old shape. */
export function normalizeOnboarding(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {
    skipped: cleanKeys(v.skipped, ONBOARDING_STEP_KEYS.length, ONBOARDING_STEP_KEYS),
    networkFollows: cleanKeys(v.networkFollows, MAX_NETWORK_FOLLOWS),
    socials: cleanSocials(v.socials),
    socialsSaved: v.socialsSaved === true,
  };
  return isEmptyOnboarding(out) ? null : out;
}

export function isEmptyOnboarding(o) {
  return !o || (!o.skipped.length && !o.networkFollows.length && !Object.keys(o.socials).length && !o.socialsSaved);
}

/** True when a saved profile's links carry at least one handle. The wizard counts the same keys (it prefills
 *  from recallProfileSocials over the offered social keys, GitHub included), so the two surfaces agree. */
export function profileHasSocials(links, allowed = null) {
  if (!links || typeof links !== 'object' || Array.isArray(links)) return false;
  return Object.entries(links).some(([k, v]) => (!allowed || allowed.includes(k)) && typeof v === 'string' && v.trim() !== '');
}

const count = (v) => (Number.isFinite(v) ? v : Array.isArray(v) ? v.length : null);
const emptyRecord = () => ({ skipped: [], networkFollows: [], socials: {}, socialsSaved: false });

/**
 * Merge real state with the stored record into one view.
 *
 * Every real-state input may be `null`, meaning the read failed. A failed read is NOT "not done": the view
 * reports `known: false` and a surface that nags must then say nothing, because a false to-do list tells a
 * member to redo work they already did.
 *
 * @param {object} s
 * @param {boolean|null} s.discordLinked   the network's link status
 * @param {number|Array|null} s.follows    members followed (a count or the list)
 * @param {number|Array|null} s.topics     saved topics (a count or the list)
 * @param {boolean|null} s.profileSocials  the saved profile carries a handle (false when there is no profile)
 * @param {object|null} s.record           the stored onboarding block (null when never written; undefined = unread)
 * @returns {{ steps: Array<{key,label,title,state}>, complete: boolean, known: boolean, outstanding: number }}
 */
export function onboardingProgress({ discordLinked = null, follows = null, topics = null, profileSocials = null, record } = {}) {
  // `undefined` = the record was not read; `null` = read, and nothing has been stored yet.
  const rec = record === undefined ? undefined : (normalizeOnboarding(record) ?? emptyRecord());
  const nFollows = count(follows);
  const nTopics = count(topics);
  const known = typeof discordLinked === 'boolean' && nFollows !== null && nTopics !== null
    && typeof profileSocials === 'boolean' && rec !== undefined;
  const r = rec ?? emptyRecord();
  const done = {
    discord: discordLinked === true,
    subreddit: r.networkFollows.length > 0,
    socials: profileSocials === true || r.socialsSaved,
    follow: (nFollows ?? 0) > 0,
    topics: (nTopics ?? 0) > 0,
  };
  const steps = ONBOARDING_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    title: s.title,
    state: done[s.key] ? 'done' : r.skipped.includes(s.key) ? 'skipped' : 'todo',
  }));
  const outstanding = steps.filter((s) => s.state !== 'done').length;
  return { steps, complete: outstanding === 0, known, outstanding };
}
