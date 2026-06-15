// SOW-030: the site's consumer of the extension's PAGE-SAFE identity signal. The GBTI extension content script
// stamps document.documentElement.dataset.gbtiMember (a JSON string) and dispatches a `gbti:identity` event when
// a member is signed in (identity + membership status only, NEVER the GitHub token). The site uses this to show
// a signed-in / member experience when the extension is installed + signed in.
//
// IMPORTANT: this signal is UNTRUSTED for any security decision. Page JS (including any XSS) can set the
// attribute, so it drives PRESENTATION ONLY (show an avatar, reveal non-functional edit chrome). Every
// authoritative check stays server-side: the SOW-005 PR gate (ownership + paid), the Worker membership oracle,
// and CODEOWNERS. The inert <gbti-edit-panel> still self-activates only for the true owner via the
// worker-backed client; this signal only governs the chrome around it.

export interface MemberSignal {
  authenticated: true;
  login: string | null;
  githubId: string | null;
  username: string | null;
  role: string;
  membership: string;
  canPublish: boolean;
}

/** Validate an already-parsed object into a MemberSignal, or null. Shared by the attribute + event paths. */
function coerce(o: unknown): MemberSignal | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (r.authenticated !== true) return null;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    authenticated: true,
    login: str(r.login),
    githubId: str(r.githubId),
    username: str(r.username),
    role: typeof r.role === 'string' ? r.role : 'member',
    membership: typeof r.membership === 'string' ? r.membership : 'unknown',
    canPublish: r.canPublish === true,
  };
}

/** Parse the data-gbti-member JSON string into a MemberSignal, or null (missing / malformed / signed out). */
export function parseMemberSignal(raw: string | null | undefined): MemberSignal | null {
  if (!raw) return null;
  try {
    return coerce(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Read the current signal from the DOM (null in SSR or when no member signal is present). */
export function readMemberSignal(): MemberSignal | null {
  if (typeof document === 'undefined') return null;
  return parseMemberSignal(document.documentElement.dataset.gbtiMember);
}

/** Subscribe to live sign-in/sign-out changes. Returns an unsubscribe fn. */
export function onMemberSignal(cb: (s: MemberSignal | null) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const handler = (e: Event) => cb(coerce((e as CustomEvent).detail));
  document.addEventListener('gbti:identity', handler as EventListener);
  return () => document.removeEventListener('gbti:identity', handler as EventListener);
}

/** Reflect the signal onto <html> so components + CSS can react to a signed-in / paid member presentationally. */
export function applyMemberSignalClasses(s: MemberSignal | null): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.classList.toggle('is-gbti-member', !!s);
  el.classList.toggle('is-gbti-paid', s?.membership === 'paid');
  if (s && s.role) el.dataset.gbtiRole = s.role;
  else delete el.dataset.gbtiRole;
}
