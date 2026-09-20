// sow-274: WHICH ADMIN ACTIONS GO TO THE WORKER, AND HOW. Pure and node-free, so the mapping is testable
// without a network and both hosts read the same table.
//
// Before this, five admin actions went to the Worker (the governance ones plus coupons) and the rest opened a
// pull request from the acting member's own copy of the repository, using their own GitHub token. That is the
// path being retired, and it is the path that stalled the owner's syndication settings on 13 and 14 September:
// the branch force-resets onto a fork's possibly-stale main, the merge conflicts, the gate's auto-merge is
// refused, and the pull request sits open with nobody told.
//
// EVERY admin action now goes to the Worker. There is deliberately no local fallback: a fallback is how the
// old path survives, and a half-retired path is worse than either whole one, because the failure only shows up
// on the surface nobody tested.
//
// THREE KINDS OF ACTION LIVE HERE:
//   1. Actions the Worker names itself. Forwarded unchanged.
//   2. Actions the Worker serves through a BATCH op it already has. Translated here rather than given a new
//      Worker entry, because the website already edits these through the batch and a second spelling of the
//      same write is a second thing to keep in step. See TRANSLATED below.
//   3. Nothing else. An unknown action is refused rather than falling back.

/** Actions the Worker's own tables name. Forwarded with the payload untouched. */
export const WORKER_ADMIN_ACTIONS = Object.freeze(new Set([
  // governance (sow-213) and coupons (sow-291), which already took this path
  'ban', 'unban', 'grandfather', 'ungrandfather', 'role',
  'coupon-add', 'coupon-update',
  // house config
  'quote-add', 'quote-remove', 'quote-toggle',
  'news-source-add', 'news-source-remove', 'news-source-toggle',
  'news-source-weight', // sow-338/sow-374: superadmin, forwarded unchanged
  'news-banword-add', 'news-banword-remove', // sow-372: superadmin, forwarded unchanged
  'digest-cta-set', 'digest-sponsor-set', // sow-266: superadmin, forwarded unchanged (both are PATCHES, so the payload must not be defaulted on the way through)
  'digest-optin-set', // sow-270: superadmin, the double opt-in switch, forwarded unchanged for the same reason
  'site-setting-set',
  'cta-add', 'cta-update', 'cta-toggle', 'cta-assign', 'cta-unassign',
  'outbound-add', 'outbound-update', 'outbound-status', // sow-359: the tracked partner links, forwarded unchanged
  'flag-term-add', 'flag-term-remove',
  'syndication-templates-set', 'news-engagement-set', 'syndication-settings-set',
  // content moderation, and the multi-file batches
  'deplatform', 'remove', 'republish',
  'category-batch', 'tag-edit',
  // sow-274: the content flags, added to the Worker in this change
  'stale', 'unstale', 'unindex', 'reindex',
]));

/**
 * Actions the Worker serves under another name, with the payload it expects.
 *
 * Each returns `{ action, payload }`. They are one-entry batches: the batch op is the Worker's only spelling of
 * these writes, and it is the spelling the website uses (src/lib/workbench-client.ts records that decision for
 * the channel map). Translating here keeps ONE vocabulary on the server.
 */
const TRANSLATED = Object.freeze({
  'category-add': (p) => ({
    action: 'category-batch',
    payload: { ops: [{ kind: 'add', args: { parentPath: Array.isArray(p?.parentPath) ? p.parentPath : [], key: p?.key, label: p?.label } }] },
  }),
  'category-rename': (p) => ({
    action: 'category-batch',
    payload: { ops: [{ kind: 'label', args: { path: p?.path, label: p?.label } }] },
  }),
  'content-channel-set': (p) => ({
    action: 'category-batch',
    payload: { ops: [{ kind: 'channel-set', args: { category: p?.category, channelId: p?.channelId } }] },
  }),
  'content-channel-remove': (p) => ({
    action: 'category-batch',
    payload: { ops: [{ kind: 'channel-remove', args: { category: p?.category } }] },
  }),
  'syndication-template-set': (p) => ({
    action: 'syndication-templates-set',
    payload: { edits: [{ type: p?.type, template: p?.template, channel: p?.channel, stub: p?.stub === true }] },
  }),
});

/** Every action this module will send, under either kind. */
export function isWorkerAdminAction(action) {
  const a = String(action ?? '');
  return WORKER_ADMIN_ACTIONS.has(a) || Object.prototype.hasOwnProperty.call(TRANSLATED, a);
}

/**
 * The request to send for one admin body, or null when the action is not one this module serves.
 *
 * @param body the `/api/admin` body, `{ action, ...payload }`.
 * @returns `{ action, payload }` with the action name the WORKER understands.
 */
export function toWorkerRequest(body) {
  const { action, ...payload } = body ?? {};
  const a = String(action ?? '');
  if (Object.prototype.hasOwnProperty.call(TRANSLATED, a)) return TRANSLATED[a](payload);
  if (WORKER_ADMIN_ACTIONS.has(a)) return { action: a, payload };
  return null;
}
