// SOW-106 Phase A: the client transport for the Worker's fork-main sync (POST /membership/sync-fork). The
// member's own token cannot merge-upstream (workflows scope) and cannot create refs off unfetched upstream
// SHAs, so the Worker performs the sync with a fork-installation token. Best-effort BY CONTRACT: this module
// NEVER throws — a sync miss must never block a publish (the SOW-053 conflict surfacing is the backstop).

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

/** Sync the caller's fork main with upstream. Always resolves to { ok, synced, reason?|state? }. */
export async function workerSyncFork({ token, signupBase, fetch = globalThis.fetch, branch = 'main' } = {}) {
  if (!token || !signupBase) return { ok: false, synced: false, reason: 'not-signed-in' };
  try {
    const res = await fetch(`${trimBase(signupBase)}/membership/sync-fork`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    });
    if (!res.ok) return { ok: false, synced: false, reason: `http-${res.status}` };
    const data = await res.json().catch(() => null);
    return data && typeof data === 'object' ? data : { ok: false, synced: false, reason: 'bad-response' };
  } catch {
    return { ok: false, synced: false, reason: 'network' };
  }
}
