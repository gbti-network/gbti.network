// SOW-029: pure helpers for the post-setup welcome view (<gbti-welcome>). Node-free so `node --test` imports
// them directly without a DOM; the component is the only DOM consumer. Keep this dependency-light.

/** Map the effective membership status to the welcome-banner phase. NEVER throws (unknown -> neutral). */
export function phaseLabel(membership) {
  switch (membership) {
    case 'paid':
      return { phase: 'paid', title: 'You are a paid member', body: 'Your profile, posts, products, and prompts publish under your name. Welcome to the co-op.', upgrade: false };
    case 'trialing':
      return { phase: 'trial', title: 'You are in your 90-day trial', body: 'Explore the community and stage drafts now. Upgrade any time to publish under your name.', upgrade: true };
    default:
      // unknown / unreachable oracle, or a status that should not reach this view: a neutral welcome, no claim.
      return { phase: 'neutral', title: 'Welcome to GBTI Network', body: 'You are set up to author and publish through the co-op.', upgrade: false };
  }
}

/** Fisher-Yates shuffle. Tests pass a deterministic rng(); runtime defaults to Math.random (UX shuffle only).
 *  Pure: returns a new array, does not mutate the input. */
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Drop the signed-in member's OWN username (case-insensitive) from a member list (no following yourself). */
export function excludeSelf(members, ownUsername) {
  const me = String(ownUsername || '').toLowerCase();
  return me ? members.filter((m) => String(m?.username || '').toLowerCase() !== me) : [...members];
}

/** 1-based page `p` of `size` from `list`, clamped. Returns { page, pages, items }. */
export function paginate(list, p, size = 10) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const page = Math.min(Math.max(1, p | 0 || 1), pages);
  const start = (page - 1) * size;
  return { page, pages, items: list.slice(start, start + size) };
}
