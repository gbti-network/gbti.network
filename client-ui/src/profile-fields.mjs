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
