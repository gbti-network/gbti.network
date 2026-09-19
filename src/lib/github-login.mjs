// sow-369: is this string a GitHub login, and therefore something we may render as a member handle?
//
// WHY IT EXISTS. The header's display-only signed-in hint took `?u=` off the URL, stored it forever and
// printed it as "@<value>", with no check of any kind. Two consequences, both live on production until this
// shipped:
//
//   1. `gbti.network/?u=https://www.youtube.com/watch?v=...` printed that whole url as the member handle, and
//      kept printing it on every later visit. That is how the owner met it (2026-09-19), after following a
//      link that carried the embed relay's `?u=<video>` to the site root instead of to /embed/.
//   2. `gbti.network/?u=someone-else` printed THEIR handle and loaded THEIR GitHub avatar for anyone who
//      opened the link, and two other surfaces read the same stored value as "this visitor is signed in".
//      It grants nothing (the menu stays in hint mode and every member action needs the real session), but a
//      header that names a person is a claim, and it should not be makeable from a query string.
//
// GitHub's own rule: 1 to 39 characters, alphanumerics and single internal hyphens. Case is PRESERVED here,
// unlike the member-folder normalizer in membership/member-follows.mjs, because this value is displayed
// rather than used as a path.
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** True when `value` is shaped like a GitHub login. Never throws; anything that is not a string is false. */
export function isGithubLogin(value) {
  return typeof value === 'string' && LOGIN_RE.test(value);
}
