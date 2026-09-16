// sow-274: the CONTENT FLAG config ops (stale / unindexed), moved to the Worker.
//
// These four were the last admin actions with no Worker equivalent. Every other action the client offers is
// either already in the Worker's table or reachable through one of its batch ops, so once these exist the
// client stops needing to write to GitHub at all, which is the whole point of the retirement.
//
// A FLAG IS A STATEMENT ABOUT A MEMBER'S CONTENT THAT THE MEMBER MUST NOT BE ABLE TO FLIP BACK, which is why
// it lives in house/content-flags.yml rather than in the item's own frontmatter: the merge gate is path-scoped
// and never reads a field, so a member editing their own file could otherwise unmark themselves. Superadmin
// only, matching the client rule it replaces (client/src/admin-ops.mjs setContentFlagOp) and the file's own
// CODEOWNERS pin.
//
// In its own file because membership-admin-author.mjs is at the 900-line cap, the same reason the CTA
// validators live in membership-admin-ctas.mjs.
import { setContentFlag, flagKeyForPath } from '../../membership/content-flags.mjs';

/** The four actions, and what each one does to the flag. */
export const CONTENT_FLAG_ACTIONS = Object.freeze({
  stale: { flag: 'stale', on: true },
  unstale: { flag: 'stale', on: false },
  unindex: { flag: 'unindexed', on: true },
  reindex: { flag: 'unindexed', on: false },
});

/**
 * Resolve the payload to a flag key.
 *
 * THE KEY IS DERIVED FROM THE PATH, never taken from the caller. `flagKeyForPath` accepts only a real content
 * item path (`members/<who>/<type>/<slug>/index.md`, or house), so a caller cannot invent a key for something
 * that is not content, and cannot reach a file outside the content tree by naming one.
 */
export function contentFlagInput(payload) {
  const bad = (message) => ({ ok: false, status: 400, body: { error: 'bad_request', message } });
  const path = typeof payload?.path === 'string' ? payload.path.trim() : '';
  if (!path) return bad('a content item path is required');
  const key = flagKeyForPath(path);
  if (!key) return bad(`not a flaggable content path: ${path}`);
  const reason = typeof payload?.reason === 'string' ? payload.reason.slice(0, 200) : undefined;
  return { ok: true, args: { key, ...(reason ? { reason } : {}) } };
}

/** The edit function for one action, bound to its flag and direction. Shape: (parsed, args, ctx). */
export function contentFlagFn(flag, on) {
  return (parsed, args, ctx) => setContentFlag(parsed, { key: args.key, flag, on, reason: args.reason }, ctx);
}

/**
 * The CONFIG_OP entries, ready to spread into the table. `rank` is superadmin for all four: the client enforced
 * that and the file is superadmin-pinned, so anything lower here would be a quiet relaxation of a rule that
 * already exists in two other places.
 *
 * @param rank the caller's ROLE_RANK.superadmin, passed in so this module does not re-declare the rank table.
 */
export function contentFlagOps(rank) {
  const entry = (flag, on) => ({
    path: 'house/content-flags.yml',
    rank,
    fn: contentFlagFn(flag, on),
    input: contentFlagInput,
    slug: (a) => `content-flag-${String(a.key).replace(':', '-')}`,
  });
  return {
    stale: entry('stale', true),
    unstale: entry('stale', false),
    unindex: entry('unindexed', true),
    reindex: entry('unindexed', false),
  };
}
