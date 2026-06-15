// SOW-023: the member FOLLOW graph (subscriptions). Who a member follows is behavioral/relational personal
// data, so per SOW-024 it lives in the deletable edge store (Cloudflare KV), NOT the public git repo: the
// graph is private by default and a member's right to erasure is a hard delete, never immutable history.
//
// This is the PURE, node-free core (mirrors membership/member-activity.mjs): each function takes a plain
// follows object and a command and returns a NEW follows object. No IO, no Date.now() inside (callers inject
// `now`), so it is fully unit-tested. The Worker handler (workers/signup/membership-follows.mjs) does the KV
// read-modify-write and the effective-paid auth around these transforms.
//
// Shape (one KV value per follower, key `follows:<github_id>`):
//   { following: [{ username, addedAt }], updatedAt }
//
// We store the FOLLOWED member's username (the folder name), not their github_id, because the activity index
// and profiles are keyed by username; the feed resolves a follow against published works, so a follow whose
// username has no published profile simply yields nothing (fail-safe, no Worker-side member lookup needed).

export const MAX_FOLLOWING = 5000;
// GitHub-username shaped: 1-39 chars, alphanumeric or single internal hyphens. We lowercase first (member
// folder names are lowercase), so a stored value can never carry casing or path characters.
const USERNAME_RE = /^[a-z0-9](?:-?[a-z0-9])*$/;

/** Thrown for caller-input problems; the handler maps it to a 400 (never a 500). */
export class FollowError extends Error {}

export function emptyFollows() {
  return { following: [], updatedAt: null };
}

/** Normalize an incoming username to the stored form, or return null if it is not a valid username. */
export function normalizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().toLowerCase();
  if (u.length < 1 || u.length > 39 || !USERNAME_RE.test(u)) return null;
  return u;
}

/** Defensive: coerce any stored/incoming value into the canonical shape, dropping malformed or duplicate
 *  entries, so a hand-edited or partially-written KV value can never crash a read or a transform. */
export function normalizeFollows(raw) {
  const f = emptyFollows();
  if (!raw || typeof raw !== 'object') return f;
  if (Array.isArray(raw.following)) {
    const seen = new Set();
    for (const e of raw.following) {
      const u = normalizeUsername(e && e.username);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      f.following.push({ username: u, addedAt: Number(e.addedAt) || 0 });
    }
  }
  f.updatedAt = Number(raw.updatedAt) || null;
  return f;
}

/** Toggle following `username` on/off. Returns a NEW follows object. */
export function applyFollow(follows, { username, on = true } = {}, { now = Date.now } = {}) {
  const u = normalizeUsername(username);
  if (!u) throw new FollowError('a valid username is required');
  const f = normalizeFollows(follows);
  const exists = f.following.some((e) => e.username === u);
  if (on && !exists) {
    if (f.following.length >= MAX_FOLLOWING) throw new FollowError('following limit reached');
    f.following.push({ username: u, addedAt: now() });
  } else if (!on && exists) {
    f.following = f.following.filter((e) => e.username !== u);
  }
  f.updatedAt = now();
  return f;
}

/** Just the followed usernames (for the feed filter). */
export function followingUsernames(follows) {
  return normalizeFollows(follows).following.map((e) => e.username);
}
