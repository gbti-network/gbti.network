// The website WorkBench client's Worker transport (split out of workbench-client.ts at the 900-line cap, owner
// ruling 2026-09-30). The error type the editor reads, the CSRF cookie read, and every fetch the client makes to
// the signup Worker: GET, POST and PATCH over the httpOnly-cookie session, the status-aware news GET, the public
// same-origin index read, and the two own-file reads. Writes carry `credentials:'include'` plus the non-secret
// gbti_csrf echo (double-submit CSRF); reads carry `credentials:'include'` alone. No token ever enters the page.

/** A GbtiClientError-shaped error (code + message) so the editor's failHint reads it exactly like the other hosts. */
class WorkbenchClientError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.name = 'WorkbenchClientError';
    this.code = code;
  }
}
const err = (code: string, message?: string) => new WorkbenchClientError(code, message);

/** Read the non-HttpOnly gbti_csrf cookie for the double-submit header (mirrors member-signal.ts). */
function readCsrf(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === 'gbti_csrf') return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** The transport for one signup Worker origin. `base` is the origin with no trailing slash. */
export function createWorkerTransport(base: string) {
  async function parseJson(res: Response) {
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) throw new WorkbenchClientError(json?.error || `http-${res.status}`, json?.message || json?.error || `request failed (${res.status})`);
    return json;
  }
  // Worker GET over the cookie session (credentials ride the httpOnly gbti_session; no token, no CSRF on GET).
  async function workerGet(path: string) {
    return parseJson(await fetch(base + path, { credentials: 'include' }));
  }
  // Worker POST over the cookie session: credentials + the double-submit X-GBTI-CSRF header (resolveIdentity gates).
  async function workerPost(path: string, body: unknown) {
    const csrf = readCsrf();
    return parseJson(await fetch(base + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-GBTI-CSRF': csrf } : {}) },
      body: JSON.stringify(body),
    }));
  }
  // sow-231 Phase 3: the same cookie-session + CSRF treatment as workerPost, for the invite PATCH route.
  // Written as its own helper rather than a `method` parameter on workerPost so an existing POST caller
  // cannot acquire a method by accident.
  async function workerPatch(path: string, body: unknown) {
    const csrf = readCsrf();
    return parseJson(await fetch(base + path, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-GBTI-CSRF': csrf } : {}) },
      body: JSON.stringify(body),
    }));
  }
  // sow-158 News: a status-aware GET for the news read routes. <gbti-news> drives its view from the ERROR CODE
  // (not-authenticated -> sign-in nudge, membership-required -> locked nudge, else the feed), so map the HTTP
  // status to those codes (mirrors operations.mapNewsErr). A signed-in member gets 200 -> the feed renders.
  async function newsGet(path: string) {
    const res = await fetch(base + path, { credentials: 'include' });
    if (res.status === 401) throw err('not-authenticated', 'Sign in to read the news.');
    if (res.status === 403) throw err('membership-required', 'News is a members-only perk.');
    return parseJson(res);
  }
  // A same-origin build-artifact index JSON (public, no credentials needed).
  async function sameOriginJson(path: string) {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) throw err(`http-${res.status}`, `could not load ${path}`);
    return res.json();
  }

  async function readOwnFile(path: string): Promise<string | null> {
    const r = await workerGet(`/membership/file?path=${encodeURIComponent(path)}&ref=main`);
    return r?.text ?? null;
  }
  // sow-183: the same read, returning the RAW base64 GitHub sent rather than the decoded text. An image is
  // binary, so `text` is mojibake for it and the bytes cannot be recovered from that; this is the only way to
  // read a committed image back out of the repo, which a move has to do to carry it to the item's new folder.
  // Same route, same allow-list, same auth: nothing here is reachable that readOwnFile above cannot reach.
  async function readOwnFileBase64(path: string): Promise<string | null> {
    const r = await workerGet(`/membership/file?path=${encodeURIComponent(path)}&ref=main`);
    return r?.base64 ?? null;
  }

  return { parseJson, workerGet, workerPost, workerPatch, newsGet, sameOriginJson, readOwnFile, readOwnFileBase64 };
}

export { WorkbenchClientError, err, readCsrf };
