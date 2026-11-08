// sow-494: the website adapter for COMMUNITY, spread into createWorkbenchClient with one line. Every call goes to the
// signup Worker over the cookie session through the client's own workerGet/workerPost, so this module holds no fetch
// and no second copy of the CSRF rule. The Worker is the gate on every call: members only (effective paid), each
// entry visible only to the members it is shared with, and the superadmin route re-checks the role.
//
// TWO GROUPS, ON PURPOSE (the sow-161 / sow-427 pattern). The member methods are attached for every caller. The two
// superadmin methods are attached ONLY when isSuperadmin, so an element decides whether to draw the host controls
// with a capability check (`typeof client.communityAdmin === 'function'`), which keeps them away from a member.
//
// Errors arrive as the transport's WorkbenchClientError, whose `code` is the Worker's error name: `unauthorized`
// (signed out), `forbidden` (not a paid member, or not a superadmin), `not_found` (missing or not shared with you,
// deliberately the same), `conflict`, `bad_request`, `rate_limited`, `unavailable`.

type WorkerGet = (path: string) => Promise<any>;
type WorkerPost = (path: string, body: unknown) => Promise<any>;

export const COMMUNITY_ROUTE = '/membership/community';
export const COMMUNITY_ADMIN_ROUTE = '/membership/admin/community';

const q = (v: unknown) => encodeURIComponent(String(v ?? ''));

/** The superadmin ops the Worker accepts. Anything else is refused here, before a request is made. */
export const COMMUNITY_ADMIN_OPS = Object.freeze(['create', 'edit', 'open', 'close', 'publish', 'unpublish', 'lock', 'unlock', 'delete', 'access', 'moderate', 'tidy']);

export function communityMethods({ workerGet, workerPost, base, isSuperadmin = false }: { workerGet: WorkerGet; workerPost: WorkerPost; base: string; isSuperadmin?: boolean }): Record<string, any> {
  const origin = String(base || '').replace(/\/$/, '');
  const always = {
    /** { ok, entries: [summary], meetings: [{ key, label, date }] }. `meeting` is a meeting key, or '-' for between meetings. */
    communityList({ kind = '', meeting = '' }: { kind?: string; meeting?: string } = {}) {
      return workerGet(`${COMMUNITY_ROUTE}/entries?kind=${q(kind)}&meeting=${q(meeting)}`);
    },
    /** { ok, entry, mine, results, discussion, viewer, version } */
    communityEntry(id: string) { return workerGet(`${COMMUNITY_ROUTE}/entry?id=${q(id)}`); },
    /** { ok, unchanged: true, version } when nothing moved, else the same shape as communityEntry. */
    communityUpdates(id: string, version: number) { return workerGet(`${COMMUNITY_ROUTE}/updates?id=${q(id)}&v=${q(version)}`); },
    /** `answer` is { choice } for a poll or { text } for a typed poll. */
    communityAnswer(id: string, answer: { choice?: number; text?: string } = {}) {
      return workerPost(`${COMMUNITY_ROUTE}/answer`, { id, choice: answer.choice, text: answer.text });
    },
    communityPost(id: string, { body = '', images = [], parentId = null }: { body?: string; images?: string[]; parentId?: string | null } = {}) {
      return workerPost(`${COMMUNITY_ROUTE}/post`, { id, body, images, parentId });
    },
    communityEditPost(id: string, postId: string, { body = '', images }: { body?: string; images?: string[] } = {}) {
      return workerPost(`${COMMUNITY_ROUTE}/post-edit`, { id, postId, body, images });
    },
    communityDeletePost(id: string, postId: string) { return workerPost(`${COMMUNITY_ROUTE}/post-delete`, { id, postId }); },
    communityReact(id: string, postId: string, name: string) { return workerPost(`${COMMUNITY_ROUTE}/react`, { id, postId, name }); },
    /** { ok, id, name, size }. `dataBase64` may carry a data: URL header. */
    communityUploadImage(id: string, { name, dataBase64 }: { name: string; dataBase64: string }) {
      return workerPost(`${COMMUNITY_ROUTE}/image`, { id, name, dataBase64 });
    },
    communityDropImage(id: string, img: string) { return workerPost(`${COMMUNITY_ROUTE}/image-drop`, { id, img }); },
    /** The address an <img> loads an image from. The session cookie rides along: gbti.network and the Worker are one site. */
    communityImageSrc(id: string, img: string) { return `${origin}${COMMUNITY_ROUTE}/image?id=${q(id)}&img=${q(img)}`; },
  };
  if (!isSuperadmin) return always;
  return {
    ...always,
    /** One superadmin op: create, edit, open, close, publish, unpublish, lock, unlock, delete, access, moderate, tidy. */
    communityAdmin(op: string, payload: Record<string, unknown> = {}) {
      if (!COMMUNITY_ADMIN_OPS.includes(op)) return Promise.reject(Object.assign(new Error('Unknown operation.'), { code: 'bad_request' }));
      return workerPost(COMMUNITY_ADMIN_ROUTE, { ...payload, op });
    },
    /** { ok, members: [{ githubId, username }] }, the picker for chosen access. */
    communityMembers() { return workerGet(`${COMMUNITY_ADMIN_ROUTE}/members`); },
  };
}
