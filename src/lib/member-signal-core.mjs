// sow-158 Phase 2: the PURE identity logic shared by the site consumer (member-signal.ts). Kept in a .mjs core so
// `node --test` can import it (the test runner has no TS loader). No DOM. `memberSignalFromStatus` maps the public
// /membership/status payload into the presentation-only MemberSignal; `selectIdentity` is the cookie-wins precedence.

/**
 * Map the /membership/status payload ({ ok, github_id, login, status, canCurate, couponUntil }) into a
 * MemberSignal, or null when there is no signed-in member. Presentation only (it drives header chrome, never a
 * security decision). `role` defaults to 'member': the status oracle does not return the role, and the admin menu
 * item is extension-relay-only, so a cookie-hydrated header surfaces no role-gated actions.
 */
export function memberSignalFromStatus(payload) {
  if (!payload || payload.ok !== true || !payload.login) return null;
  // sow-158 follow-up: prefer the EFFECTIVE status (the oracle folds ban > staff > grandfather > Stripe, which the
  // static site cannot do itself) and the resolved ROLE, both added to /membership/status. Fall back to the raw
  // Stripe `status` + 'member' for an older Worker. This drives the correct membership label AND lets the header
  // reveal role-gated items (e.g. Admin tools) to a superadmin on the cookie session.
  const membership = typeof payload.effectiveStatus === 'string' ? payload.effectiveStatus
    : (typeof payload.status === 'string' ? payload.status : 'unknown');
  return {
    authenticated: true,
    login: String(payload.login),
    githubId: payload.github_id != null ? String(payload.github_id) : null,
    username: String(payload.login),
    role: typeof payload.role === 'string' && payload.role ? payload.role : 'member',
    membership,
    // sow-185: the resolved paid TIER (none|member|creator) the Worker now folds server-side. Fail closed to
    // 'none' for an older Worker that does not send it, so a creator gate keyed on this never opens by default.
    paidTier: typeof payload.paidTier === 'string' ? payload.paidTier : 'none',
    canPublish: membership === 'paid',
    source: 'cookie',
  };
}

/**
 * Precedence: the httpOnly-cookie session WINS over the extension's display-only signal. Returns the cookie
 * signal once the cookie fetch has resolved to a member; otherwise the extension signal (which may be null). A
 * resolved-but-signed-out cookie (cookieSignal null) defers to the extension, so an anonymous cookie state does
 * not suppress an installed+signed-in extension.
 */
export function selectIdentity({ cookieResolved, cookieSignal, extSignal }) {
  if (cookieResolved && cookieSignal) return cookieSignal;
  return extSignal ?? null;
}

/**
 * ACTIVE MEMBER: paid, or on the 90-day trial. sow-191.
 *
 * Extracted so the definition exists ONCE and is node-testable. It was previously inline in
 * member-signal.ts's DOM code (the `is-gbti-member-active` class), where `node --test` cannot reach it, and
 * the Shop Talk calendar CTA needed the same rule. A second hand-written copy of a membership predicate is
 * how two surfaces quietly start disagreeing about who is a member.
 *
 * PRESENTATION ONLY, and this is not a hedge. The signal it reads is attacker-settable page state, so this
 * decides what a button LOOKS like, never what anyone may access. The Shop Talk .ics is a public file on a
 * CDN and is readable regardless of what this returns.
 *
 * NOTE, deliberately not "fixed" here: `workbench-client-core.mjs:326` MEMBER_READ_TIER also accepts the
 * string 'trial' alongside 'trialing', and this does not. That divergence is real and predates sow-191;
 * widening it here would change `is-gbti-member-active` across every surface that uses it, which is well
 * outside a calendar button. Recorded in sow-191 instead.
 */
export const ACTIVE_MEMBERSHIPS = Object.freeze(['paid', 'trialing']);

/** True when the signal describes an active member. Fail-closed: null, undefined and any unknown shape are not. */
export function isActiveMember(signal) {
  return !!signal && ACTIVE_MEMBERSHIPS.includes(signal.membership);
}
