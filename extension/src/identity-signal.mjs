// SOW-030: build the PAGE-SAFE identity signal from the /api/status response. The content script publishes this
// to gbti.network so the site can render a signed-in / member experience (header avatar, owner-only edit chrome)
// WITHOUT the GitHub token ever leaving the background worker.
//
// SECURITY CONTRACT: this is an EXPLICIT ALLOWLIST. We build a fresh object from named, non-sensitive fields and
// NEVER spread the raw status, so the GitHub token, the device-flow code, the Stripe customer id, or any secret
// can never reach the page even if a future /api/status grows new fields. login/github_id/username are already
// public on the content repo; role + membership are derived. Pure + node-free so the token-free guarantee is
// asserted directly in a unit test.

export function buildMemberSignal(status) {
  if (!status || typeof status !== 'object') return null;
  const id = status.identity;
  if (!status.authenticated || !id) return null; // signed out (or no identity) -> no signal
  return {
    authenticated: true,
    login: typeof id.login === 'string' ? id.login : null,
    githubId: id.githubId != null ? String(id.githubId) : null,
    username: typeof id.username === 'string' ? id.username : null,
    role: typeof status.role === 'string' ? status.role : 'member',
    membership: typeof status.membership === 'string' ? status.membership : 'unknown',
    canPublish: status.canPublish === true,
  };
}
