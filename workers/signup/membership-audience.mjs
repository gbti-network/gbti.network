// sow-323: the AUDIENCE rule, in its own module because BOTH publish routes apply it and they cannot import each
// other (membership-author.mjs already imports github-app.mjs). The hosted author route checks the files the caller
// sent; the fork route (github-app.mjs openPullForMember) checks the files the member's fork branch changes. One
// function, so the two ways a member publishes cannot disagree about what may be public.
import { TIER, meetsTier } from '../../membership/tiers.mjs';
import { pathsNeedingApproval, statedVisibility } from '../../membership/hosted-author.mjs';

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });

/**
 * sow-323: is EVERY one of these repository paths already PUBLIC on main?
 *
 * This is the "already approved" waiver on the members-first rule. An author editing an article a superadmin
 * already approved must not be refused, and must not have their page taken down by their own typo fix, so the
 * gate asks main what the item's audience is today rather than trusting the request.
 *
 * Generalised from sow-304's isShareEdit, which read main for exactly this shape of question (does this path
 * exist there?) in order to exempt a share edit from the six-hour throttle. The throttle is gone by the owner's
 * decision of 2026-09-12, so its machinery now serves the audience rule instead of being deleted. The one real
 * difference: existence is not enough any more, the file's own frontmatter has to SAY public, so this reads the
 * raw text rather than only the status.
 *
 * FAILS CLOSED at every step: an empty list, a non-200, an unreadable body, a members-only file, or a thrown
 * fetch all answer false, which sends the request to the approval refusal.
 */
export async function approvedOnMain({ fetchImpl, instToken, upstream, paths }) {
  const list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p && !p.includes('..')) : [];
  if (!list.length) return false;
  for (const path of list) {
    try {
      const r = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, {
        headers: { ...GH_HEADERS(instToken), Accept: 'application/vnd.github.raw' },
      });
      if (!r || r.status !== 200) return false;
      const text = await r.text();
      if (statedVisibility(text) !== 'public') return false;
    } catch { return false; }
  }
  return true;
}

/**
 * sow-323: the AUDIENCE rule, shared by the hosted author route below and the fork route (github-app.mjs
 * openPullForMember), so the two ways a member publishes cannot disagree about what may be public.
 *
 * Refused unless positively allowed:
 *   - an article, project or prompt that is not members-only, unless the author is TRUSTED (the silently granted
 *     creator tier; staff resolve to it) or the item is already public on main;
 *   - a SHARE that is not members-only, unless the caller is a SUPERADMIN or the share is already public on main.
 *     Owner, 2026-09-15: "Only superadmins can make shares public", so the trusted tier does not waive a share.
 * Returns null when allowed, or the 403 the route should send.
 */
export async function audienceRefusal({ files, folders, tier, isSuperadmin = false, approvedCheck = approvedOnMain, fetchImpl, instToken, upstream }) {
  const trusted = meetsTier(tier, TIER.creator);
  const items = (Array.isArray(folders) ? folders : []).flatMap((folder) => pathsNeedingApproval(files, folder));
  const reviewed = items.filter((item) => (item.type === 'share' ? isSuperadmin !== true : !trusted));
  for (const item of reviewed) {
    let ok = false;
    for (const path of [item.path, ...item.priorPaths]) {
      if (await approvedCheck({ fetchImpl, instToken, upstream, paths: [path] })) { ok = true; break; }
    }
    if (ok) continue;
    return item.type === 'share'
      ? { status: 403, body: { error: 'review_required', message:
        'only a superadmin can make a share public. Post it to members only: https://gbti.network/submit-content/' } }
      : { status: 403, body: { error: 'review_required', message:
        'public content is approved by a superadmin after editorial review. Publish this to members only and it '
        + 'enters the review queue, or ask a superadmin to approve it: https://gbti.network/submit-content/' } };
  }
  return null;
}
