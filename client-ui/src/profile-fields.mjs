// SOW-129: pure, DOM-free profile-field helpers shared by the client-ui profile editor AND the content validator
// (scripts/validate-content.mjs), so the avatar host allowlist has ONE source of truth. No DOM, node-importable.

// A profile avatar may only come from our sanctioned hosts (a member's GitHub avatar or a Gravatar), so a profile
// never hotlinks an arbitrary external image. Empty is allowed (the build falls back to the GitHub avatar). Covers
// avatars.githubusercontent.com, github.com/<user>.png, and secure/www/en/s.gravatar.com. Must be https.
const AVATAR_HOSTS = /(^|\.)githubusercontent\.com$|^github\.com$|(^|\.)gravatar\.com$/i;

export function isSanctionedAvatar(url) {
  const v = String(url == null ? '' : url).trim();
  if (!v) return true;
  let u;
  try { u = new URL(v); } catch { return false; }
  return u.protocol === 'https:' && AVATAR_HOSTS.test(u.hostname);
}

export const githubAvatarUrl = (login) => (login ? `https://github.com/${encodeURIComponent(login)}.png?size=128` : '');

/** Merge the welcome flow's staged social handles into a profile's links, filling ONLY unset keys (an
 *  existing profile value always wins). `staged` is the parsed gbti-welcome-socials object (or null);
 *  `allowed` restricts which keys may land (pass SOCIAL_KEYS). Junk values are dropped. Pure. */
export function mergeStagedLinks(links, staged, allowed = null) {
  const out = { ...(links || {}) };
  if (!staged || typeof staged !== 'object' || Array.isArray(staged)) return out;
  const ok = Array.isArray(allowed) ? new Set(allowed) : null;
  for (const [k, v] of Object.entries(staged)) {
    if (ok && !ok.has(k)) continue;
    if (typeof v !== 'string' || !v.trim()) continue;
    if (typeof out[k] === 'string' && out[k].trim() !== '') continue;
    out[k] = v.trim();
  }
  return out;
}
