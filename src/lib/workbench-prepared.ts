// sow-427: the website adapter for PREPARED PROJECT LISTINGS, spread into createWorkbenchClient with one line.
// A prepared listing is a project a superadmin writes for someone who is not a member yet. It waits in KV with its
// own invitation, and the person claims it under their own name. Every call goes to the superadmin-only Worker route
// /membership/admin/prepared (workers/signup/membership-prepared-admin.mjs) over the cookie session: a GET carries
// the credentials alone, a POST also carries the double-submit X-GBTI-CSRF header. Both helpers come from the
// adapter, so this module holds no fetch of its own and no second copy of the CSRF rule.
//
// TWO GROUPS, ON PURPOSE (engineering spec E5).
//   - preparedGet, preparedImage and preparedSave are attached for EVERY caller. The WorkBench page builds its
//     client without isSuperadmin (it never knew the role), yet the editor's prepared mode needs these three. The
//     Worker is the gate: a non-superadmin gets a 403 and nothing is written.
//   - preparedList, preparedRevoke, preparedResend and preparedDelete are attached ONLY when isSuperadmin. The
//     coupon manager decides whether to draw the prepared listings at all with a capability check
//     (`typeof client.preparedList === 'function'`), which cannot express a role; making the capability itself
//     superadmin-scoped is what keeps the section away from an admin (the sow-161 channel-map pattern).
//
// THE SAVE BODY IS AN ALLOW-LIST. Only the fields the route reads are forwarded, so an author note, an author
// target or a repository path can never ride along from a caller: the claimant writes the author note, and a
// prepared project has no path until it is claimed. `suggestedNote` (sow-434) is allowed because it is not the
// note: it is the optional text the claim dialog starts from, stored on the listing and never published as it is.

type WorkerGet = (path: string) => Promise<any>;
type WorkerPost = (path: string, body: unknown) => Promise<any>;

export const PREPARED_ROUTE = '/membership/admin/prepared';

/** The fields a prepared save may carry, and nothing else. */
export const PREPARED_SAVE_FIELDS = Object.freeze(['id', 'campaign', 'recipientName', 'message', 'suggestedNote', 'githubLogin', 'draft', 'stagedItem']);

/** A save body from whatever the caller passed: the allow-listed fields that are present, plus `op: 'save'`. */
export function preparedSaveBody(payload: any = {}): Record<string, unknown> {
  const src = payload && typeof payload === 'object' ? payload : {};
  const out: Record<string, unknown> = { op: 'save' };
  for (const k of PREPARED_SAVE_FIELDS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

const q = (v: unknown) => encodeURIComponent(String(v ?? ''));

export function preparedMethods({ workerGet, workerPost, isSuperadmin = false }: { workerGet: WorkerGet; workerPost: WorkerPost; isSuperadmin?: boolean }): Record<string, any> {
  const always = {
    // One listing for Edit: { ok, listing: <admin view incl. frontmatter, body, message>, link }.
    preparedGet(id: string) { return workerGet(`${PREPARED_ROUTE}?id=${q(id)}`); },
    // One stored listing image, the draft-image wire shape: { ok, name, dataBase64, contentType }.
    preparedImage(id: string, name: string) { return workerGet(`${PREPARED_ROUTE}?id=${q(id)}&image=${q(name)}`); },
    // Create (no id) or edit (id): { ok, created, changed, listing: <summary row>, code, link }.
    preparedSave(payload: any = {}) { return workerPost(PREPARED_ROUTE, preparedSaveBody(payload)); },
  };
  if (!isSuperadmin) return always;
  return {
    ...always,
    preparedList() { return workerGet(PREPARED_ROUTE); }, // { ok, listings: [<summary row>] }, newest first
    preparedRevoke(id: string) { return workerPost(PREPARED_ROUTE, { op: 'revoke', id }); },
    preparedResend(id: string, campaign?: string | null) { return workerPost(PREPARED_ROUTE, { op: 'resend', id, ...(campaign ? { campaign } : {}) }); },
    preparedDelete(id: string) { return workerPost(PREPARED_ROUTE, { op: 'delete', id }); },
  };
}
