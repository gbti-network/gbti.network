// sow-388: when the full-screen digest invitation (src/components/mail/DigestInvite.astro) may open, and what it
// remembers afterwards. Plain .mjs with no DOM and no node imports, so node --test imports it and the component's
// bundled script imports the same functions.
//
// THE OWNER'S RULES (2026-09-23). Once per visit, one minute after the reader arrives; not again for 24 hours on
// that browser; never for a signed-in reader; never on the sales, sign-up and account pages; never again on that
// browser once the reader subscribes; and after two dismissals, quiet for 90 days instead of 24 hours.
//
// "ONE MINUTE AFTER ARRIVING" IS MEASURED FROM THE START OF THE VISIT, NOT FROM EACH PAGE. The site is a multi-page
// site, so a timer per page restarts on every click, and a reader who moves between pages faster than once a minute
// would never see it. The visit record in sessionStorage holds when the visit began; each page waits only for what
// is left of the minute.
//
// THESE KEYS ARE NOT ACCOUNT-SCOPED, ON PURPOSE. The rule that a per-person flag under a bare key leaks between
// accounts on a shared browser (sow-345) is about signed-in state. These are only ever consulted for a SIGNED-OUT
// reader, and a signed-in reader never sees the invitation whatever the keys hold, so there is no account for them
// to leak between.

export const INVITE_DELAY_MS = 60 * 1000;
export const INVITE_QUIET_MS = 24 * 60 * 60 * 1000;
export const INVITE_LONG_QUIET_MS = 90 * 24 * 60 * 60 * 1000;
export const INVITE_DISMISS_LIMIT = 2;
/**
 * The least time a reader spends on a page before it opens there. Without it, a reader whose minute ran out on a page
 * where the invitation stays away (a membership page, say) would meet it the instant the next page loaded, before
 * seeing anything of that page.
 */
export const INVITE_PAGE_FLOOR_MS = 10 * 1000;

/** sessionStorage: this visit's record, `{ t: <visit start, ms>, s: 1 when the invitation opened this visit }`. */
export const INVITE_VISIT_KEY = 'gbti_digest_invite_visit';
/** localStorage: `{ v: 1, n: <dismissals so far>, until: <quiet until, ms>, done: true once subscribed }`. */
export const INVITE_STATE_KEY = 'gbti-digest-invite';

/** Pages the invitation never opens on: selling a membership or a sponsorship, signing in, and the account area. */
export const INVITE_QUIET_PATHS = Object.freeze([
  '/membership/',
  '/member-invite/',
  '/curator-invite/',
  '/codeable-invite/',
  '/sponsorship/',
  '/login/',
  '/welcome/',
  '/account/',
  '/workbench/',
  '/admin/',
]);

// A clock set forward and then corrected must not freeze the invitation for months, and a hand-edited value must
// not freeze it forever: a quiet window longer than the longest one this module ever writes is treated as corrupt.
const FUTURE_SKEW_MS = 60 * 1000;

const EMPTY_STATE = Object.freeze({ n: 0, until: 0, done: false });

const isTime = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;

function parseObject(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** The stored browser state, from localStorage's raw string. Anything unreadable reads as "never seen". */
export function readInviteState(raw) {
  const o = parseObject(raw);
  if (!o) return { ...EMPTY_STATE };
  return {
    n: Number.isInteger(o.n) && o.n > 0 && o.n < INVITE_DISMISS_LIMIT ? o.n : 0,
    until: isTime(o.until) ? o.until : 0,
    done: o.done === true,
  };
}

export function serializeInviteState(state) {
  const s = state || EMPTY_STATE;
  const out = { v: 1, n: s.n || 0, until: s.until || 0 };
  if (s.done) out.done = true;
  return JSON.stringify(out);
}

/** This visit's record, from sessionStorage's raw string. A missing or unreadable record starts the visit now. */
export function readInviteVisit(raw, now) {
  const o = parseObject(raw);
  const start = o && isTime(o.t) && o.t <= now + FUTURE_SKEW_MS ? o.t : now;
  return { start, shown: !!(o && o.s === 1) };
}

export function serializeInviteVisit(visit) {
  return JSON.stringify(visit.shown ? { t: visit.start, s: 1 } : { t: visit.start });
}

/** How long this page waits before the invitation may open, in ms: what is left of the minute, and never less than the floor. */
export function inviteDelayRemaining(visit, now) {
  return Math.max(INVITE_PAGE_FLOOR_MS, visit.start + INVITE_DELAY_MS - now);
}

/** True on the pages listed above, with or without the trailing slash, and on anything below them. */
export function isQuietPath(path) {
  if (typeof path !== 'string' || path === '') return false;
  const p = path.toLowerCase();
  return INVITE_QUIET_PATHS.some((q) => p === q.slice(0, -1) || p.startsWith(q));
}

/** A reader arriving on an invitation link carries a coupon; they came to redeem it, not to be asked for an email. */
export function carriesCoupon(search) {
  if (typeof search !== 'string' || search === '') return false;
  try {
    return new URLSearchParams(search).has('coupon');
  } catch {
    return false;
  }
}

/**
 * Why the invitation may not open, or '' when it may. The reason names the rule, so a test can prove which one
 * held rather than only that something did.
 */
export function inviteBlocker({ state, visit, signedIn, path, search, now }) {
  if (signedIn) return 'signed-in';
  const s = state || EMPTY_STATE;
  if (s.done) return 'subscribed';
  if (visit && visit.shown) return 'shown-this-visit';
  if (isQuietPath(path)) return 'quiet-page';
  if (carriesCoupon(search)) return 'coupon';
  if (isTime(s.until) && s.until > now && s.until - now <= INVITE_LONG_QUIET_MS + FUTURE_SKEW_MS) return 'quiet-window';
  return '';
}

export function shouldOpenInvite(ctx) {
  return inviteBlocker(ctx) === '';
}

/**
 * The stored state after something happened. `shown` quiets it for 24 hours whatever the reader does next; the
 * first dismissal does the same, and the second quiets it for 90 days and starts the count again; `subscribed`
 * ends it on this browser.
 */
export function afterInvite(state, outcome, now) {
  const s = { ...EMPTY_STATE, ...(state || {}) };
  if (outcome === 'subscribed') return { ...s, done: true };
  if (outcome === 'shown') return { ...s, until: now + INVITE_QUIET_MS };
  if (outcome === 'dismissed') {
    const n = s.n + 1;
    if (n >= INVITE_DISMISS_LIMIT) return { ...s, n: 0, until: now + INVITE_LONG_QUIET_MS };
    return { ...s, n, until: now + INVITE_QUIET_MS };
  }
  return s;
}
