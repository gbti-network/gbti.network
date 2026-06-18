// SOW-042: the ONE "All" merge shared by both surfaces that combine every content type — the Browse "All" tab (the
// UNCAPPED directory in <gbti-browse>) and the new-tab Activity "All" filter (the CAPPED river). Both pass a list
// of already-projected content items ({type,title,author,visibility,thumb,createdAt|publishedAt,...}) plus the raw
// shares from client.listShares(), and get back ONE newest-first list under ONE visitor/Locked policy: Shares are
// omitted unless the caller's effective status can see them (paid or trialing; a Locked/unknown account sees none).
// The two surfaces deliberately differ in source (per-type indexes vs the activity-index) and in how they wire
// open-in-place vs a deep-link href — but NOT in this policy, this share projection, or this sort. Pure +
// node-testable (no DOM, no client). The body/discussion engine stays in gbti-reader / gbti-shares-feed.

// A member who is paid or trialing can read Shares — the exact effectiveMembership vocabulary from membership.mjs
// (ban > staff > grandfather > Stripe; a grandfather grant resolves to 'paid'). Every other value —
// expired/cancelled/none/banned or an unknown/unset status — is fail-closed to no Shares, matching the SOW's
// "omit Shares unless paid or trialing" and a Locked/unknown account showing none.
const SHARE_OK = new Set(['paid', 'trialing']);

export function canSeeShares(membership) {
  return SHARE_OK.has(String(membership || '').toLowerCase());
}

/** Normalize a createdAt (ISO string) / publishedAt (ms or ISO) to ms for sorting. 0 when absent/unparseable. */
export function toMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; }
}

/** The display title for a Share: its title, else its short description, else "Link: <host>", else a default. */
export function shareTitle(it) {
  return it.title || it.shortDescription || (it.url ? `Link: ${hostOf(it.url)}` : 'Member share');
}

/** Project a raw Share (a shareSummary from client.listShares) onto the uniform card-item shape. Carries the full
 *  share through (...it) so the reader can open it (body/encryptedBody/id/author); overrides only the card fields. */
export function shareToItem(it) {
  return {
    ...it,
    type: 'share',
    title: shareTitle(it),
    excerpt: it.title ? (it.shortDescription || '') : '',
    thumb: null,
    createdAt: it.createdAt,
  };
}

/** Merge content items + Shares newest-first under the one visitor policy. `shares` may be an array or null.
 *  Returns a fresh array (does not mutate `items`). */
export function mergeAll({ items = [], shares = null, membership = 'unknown' } = {}) {
  const out = Array.isArray(items) ? items.slice() : [];
  if (canSeeShares(membership) && Array.isArray(shares)) {
    for (const s of shares) out.push(shareToItem(s));
  }
  return out.sort((a, b) => toMs(b.createdAt ?? b.publishedAt) - toMs(a.createdAt ?? a.publishedAt));
}
