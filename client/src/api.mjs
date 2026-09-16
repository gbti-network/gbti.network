// CMS HTTP API router (SOW-006). A thin mapping from HTTP routes to the shared operations core
// (operations.mjs); the MCP tools map the SAME operations to JSON-RPC, so the two transports never
// diverge. The hardened server has already enforced localhost + token + Origin/Host before anything
// reaches here. Returns { status, json }.

import {
  OperationError,
  getStatus,
  listContent,
  listMembersOnly,
  getContentItem,
  validateContent,
  publish,
  saveDraft,
  listDrafts,
  readDraft,
  discardDraft,
  publishDraft,
  publishShare,
  listShares, myShares,
  listShareComments,
  listComments,
  readContent,
  publishComment,
  editComment,
  getComment,
  listPRs,
  prStatus, itemStats,
  stageImage,
  decryptMemberAsset,
  getMemberActivity,
  getMemberEarnings,
  mutateMemberActivity,
  getFollows,
  setFollow,
  ogPreview,
  getDiscordInvite,
  getNews,
  getNewsSources,
  discordUnlink, // sow-218: disconnect Discord
  getPrefs,
  setPrefs,
  publishNews,
  reflectNewsDiscussion, recordNewsOpen, setOwnContentStatus, renameContent, deleteComment, listDiscordChannels,
  getOnboardingStatus,
  getOverridesRoster,
  getOpenPulls,
  triggerAdminOp,
  getSyndicationQueue,
  cancelSyndication,
  approveSyndication,
  getSyndicateNowInfo,
  syndicateNow,
  getSocialQueue,
  socialQueueAction,
  getCouponUsageOp,
  listInvitesOp,
  listEditorialOp,
  decideEditorialOp,
  createInviteOp,
  updateInviteOp,
  refreshCouponUntil, governanceAdminOp } from './operations.mjs';
import { getSettings, updateSettings, getBilling, getReferral } from './settings-ops.mjs';
import { fieldsFor } from './form-fields.mjs';
import { renderMarkdown } from './markdown.mjs';
import {
  // sow-274: READS only. Every admin WRITE goes to the Worker (admin-worker-actions.mjs), so the local
  // writers this used to import are retired with the path that carried them.
  getTaxonomy, getNewsSourcePool, getQuotePool,
  getContentChannelPool, getModerationFlagPool, getSyndicationTemplatePool,
  getNewsEngagementSettings, getSyndicationSettings,
  getCouponPool, getSiteSettings, getCtaPool,
} from './admin-ops.mjs';
import { toWorkerRequest } from './admin-worker-actions.mjs'; // sow-274: the one admin action table

export { CLIENT_VERSION } from './operations.mjs';

// sow-274: EVERY admin action goes to the Worker now. The two sets this replaces (governance from sow-213,
// coupons from sow-291) were the start of exactly this move; what stopped it being finished was that the
// remaining writers worked, right up until the moment they did not. The table and the translation for the few
// actions the Worker spells differently live in admin-worker-actions.mjs, pure and tested.

const STATUS_FOR = {
  'no-identity': 409,
  'not-authenticated': 401,
  'forbidden': 403,
  'membership-required': 402, // SOW-011: publishing is paid-only
  'not-found': 404,
  'bad-request': 400,
  'invalid-content': 400,
};

async function run(fn) {
  try {
    return { status: 200, json: await fn() };
  } catch (err) {
    if (err instanceof OperationError) {
      return {
        status: STATUS_FOR[err.code] ?? 400,
        json: { error: err.code, message: err.message, ...(err.details ? { issues: err.details } : {}) },
      };
    }
    return { status: 500, json: { error: 'internal_error', message: err?.message } };
  }
}

// SOW-050 P2: a comma-separated `types` query (e.g. "post,share") -> a trimmed list, or undefined when absent.
const parseTypeList = (v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

export async function handleApi(reqInfo, ctx) {
  const { method, pathname } = reqInfo;
  const query = normalizeQuery(reqInfo.query);
  const body = reqInfo.body;

  if (method === 'GET' && pathname === '/api/status') return { status: 200, json: getStatus(ctx) };
  if (method === 'GET' && pathname === '/api/content') return run(() => listContent(ctx, { type: query.type, scope: query.scope })); // SOW-145: scope 'house' (superadmin)
  if (method === 'GET' && pathname === '/api/content/item') return run(() => getContentItem(ctx, { path: query.path }));
  if (method === 'GET' && pathname === '/api/read') return run(() => readContent(ctx, { path: query.path })); // SOW-031: cross-member published-content read for the reader
  if (method === 'POST' && pathname === '/api/validate') return run(() => validateContent(ctx, body ?? {}));
  if (method === 'POST' && pathname === '/api/publish') return run(() => publish(ctx, body ?? {}));
  // SOW-082: universal draft staging (save to the fork without a PR; review; publish from the staged branch).
  if (method === 'GET' && pathname === '/api/drafts') return run(() => listDrafts(ctx, { type: query.type }));
  if (method === 'GET' && pathname === '/api/draft') return run(() => readDraft(ctx, { type: query.type, slug: query.slug, store: query.store, path: query.path }));
  if (method === 'POST' && pathname === '/api/draft') return run(() => saveDraft(ctx, body ?? {}));
  if (method === 'POST' && pathname === '/api/draft/discard') return run(() => discardDraft(ctx, body ?? {}));
  if (method === 'POST' && pathname === '/api/draft/publish') return run(() => publishDraft(ctx, body ?? {}));
  if (method === 'POST' && pathname === '/api/share') return run(() => publishShare(ctx, body ?? {})); // SOW-018
  if (method === 'GET' && pathname === '/api/shares') return run(() => listShares(ctx, { limit: Number(query.limit) || undefined })); // SOW-018 feed
  if (method === 'GET' && pathname === '/api/my-shares') return run(() => myShares(ctx)); // sow-304: the member's own shares (WorkBench)
  if (method === 'GET' && pathname === '/api/share-comments') return run(() => listShareComments(ctx, { targetSlug: query.targetSlug, limit: Number(query.limit) || undefined })); // SOW-032 discussion
  if (method === 'GET' && pathname === '/api/comments') return run(() => listComments(ctx, { targetType: query.targetType, targetSlug: query.targetSlug, limit: Number(query.limit) || undefined, aliases: query.aliases ? String(query.aliases).split(',').filter(Boolean) : [] })); // SOW-041 discussion (+ SOW-112 rename aliases)
  if (method === 'POST' && pathname === '/api/comment') return run(() => publishComment(ctx, body ?? {})); // SOW-027
  if (method === 'POST' && pathname === '/api/comment/edit') return run(() => editComment(ctx, body ?? {})); // SOW-027
  if (method === 'GET' && pathname === '/api/comment') return run(() => getComment(ctx, { id: query.id })); // SOW-027 edit prefill
  if (method === 'GET' && pathname === '/api/activity') return run(() => getMemberActivity(ctx, { types: parseTypeList(query.types) })); // SOW-024 (favorites + collections); SOW-050 P2 optional type filter
  if (method === 'POST' && pathname === '/api/activity') return run(() => mutateMemberActivity(ctx, body ?? {})); // SOW-024
  if (method === 'GET' && pathname === '/api/earnings') return run(() => getMemberEarnings(ctx)); // SOW-083 P2: the member's own earnings ledger
  if (method === 'GET' && pathname === '/api/follows') return run(() => getFollows(ctx)); // SOW-023
  if (method === 'POST' && pathname === '/api/follows') return run(() => setFollow(ctx, body ?? {})); // SOW-023
  if (method === 'POST' && pathname === '/api/og-preview') return run(() => ogPreview(ctx, body ?? {})); // SOW-057
  if (method === 'GET' && pathname === '/api/discord-invite') return run(() => getDiscordInvite(ctx)); // on-demand Discord invite
  if (method === 'GET' && pathname === '/api/news') return run(() => getNews(ctx, { category: query.category, since: query.since, limit: Number(query.limit) || undefined })); // SOW-043 members-only news
  if (method === 'GET' && pathname === '/api/news-sources') return run(() => getNewsSources(ctx)); // SOW-046: followable news channels
  if (method === 'POST' && pathname === '/api/discord-unlink') return run(() => discordUnlink(ctx)); // sow-218: disconnect Discord
  if (method === 'GET' && pathname === '/api/prefs') return run(() => getPrefs(ctx)); // SOW-046: member prefs
  if (method === 'POST' && pathname === '/api/prefs') return run(() => setPrefs(ctx, body)); // SOW-046: set categories / follow a channel
  if (method === 'POST' && pathname === '/api/news-publish') return run(() => publishNews(ctx, body ?? {})); // SOW-046 C: curator -> Discord
  if (method === 'POST' && pathname === '/api/news-discussed') return run(() => reflectNewsDiscussion(ctx, body ?? {})); // SOW-046 D: reflect discussion onto Discord
  if (method === 'POST' && pathname === '/api/news-opened') return run(() => recordNewsOpen(ctx, body ?? {})); // SOW-111: the detail-open beacon
  if (method === 'POST' && pathname === '/api/content/status') return run(() => setOwnContentStatus(ctx, body ?? {})); // SOW-106: member self-unpublish/republish
  if (method === 'POST' && pathname === '/api/content/rename') return run(() => renameContent(ctx, body ?? {})); // SOW-112: the true permalink rename
  if (method === 'POST' && pathname === '/api/comment/delete') return run(() => deleteComment(ctx, body ?? {})); // SOW-112 QA: a member deletes their own comment
  if (method === 'GET' && pathname === '/api/onboarding-status') return run(() => getOnboardingStatus(ctx)); // SOW-026
  if (method === 'GET' && pathname === '/api/prs') return run(() => listPRs(ctx));
  if (method === 'GET' && pathname === '/api/pr-status') return run(() => prStatus(ctx, { number: query.number }));
  if (method === 'GET' && pathname === '/api/item-stats') return run(() => itemStats(ctx, { path: query.path })); // sow-232: the editor's Live revisions tile

  if (method === 'GET' && pathname === '/api/form-fields') {
    const fields = fieldsFor(query.type);
    if (!fields) return { status: 400, json: { error: 'bad-request', message: `unknown type: ${query.type}` } };
    return { status: 200, json: { type: query.type, fields } };
  }
  if (method === 'POST' && pathname === '/api/preview') return { status: 200, json: { html: renderMarkdown(body?.body ?? '', { autoEmbed: !!body?.autoEmbed }) } };
  if (method === 'POST' && pathname === '/api/image') return run(() => stageImage(ctx, body ?? {}));

  if (method === 'GET' && pathname === '/api/members-content') return run(() => listMembersOnly(ctx));
  if (method === 'POST' && pathname === '/api/member-decrypt') return run(() => decryptMemberAsset(ctx, body ?? {})); // SOW-016
  if (method === 'GET' && pathname === '/api/settings') return run(() => getSettings(ctx));
  if (method === 'POST' && pathname === '/api/settings') return run(() => updateSettings(ctx, body ?? {}));
  if (method === 'GET' && pathname === '/api/billing') return run(() => getBilling(ctx));
  if (method === 'GET' && pathname === '/api/referral') return run(() => getReferral(ctx));
  if (method === 'GET' && pathname === '/api/overrides') return run(() => getOverridesRoster(ctx)); // SOW-038 P2: superadmin dashboard roster (admin-gated)
  if (method === 'GET' && pathname === '/api/taxonomy') return run(() => getTaxonomy(ctx)); // SOW-055: the canonical category tree for the manager UI
  if (method === 'GET' && pathname === '/api/news-source-pool') return run(() => getNewsSourcePool(ctx)); // SOW-056/079: news-source pool (npm parity with the extension)
  if (method === 'GET' && pathname === '/api/quote-pool') return run(() => getQuotePool(ctx)); // SOW-063/079: splash quote pool (npm parity with the extension)
  if (method === 'GET' && pathname === '/api/discord-channels') return run(() => listDiscordChannels(ctx)); // SOW-100: channel names
  if (method === 'GET' && pathname === '/api/content-channel-pool') return run(() => getContentChannelPool(ctx)); // SOW-087
  if (method === 'GET' && pathname === '/api/moderation-flag-pool') return run(() => getModerationFlagPool(ctx)); // SOW-087
  if (method === 'GET' && pathname === '/api/syndication-template-pool') return run(() => getSyndicationTemplatePool(ctx)); // SOW-087
  if (method === 'GET' && pathname === '/api/news-engagement') return run(() => getNewsEngagementSettings(ctx)); // SOW-111
  if (method === 'GET' && pathname === '/api/syndication-settings') return run(() => getSyndicationSettings(ctx)); // SOW-088
  if (method === 'GET' && pathname === '/api/open-pulls') return run(() => getOpenPulls(ctx)); // SOW-038 P2: open content-PR queue (admin-gated)
  if (method === 'GET' && pathname === '/api/syndication') return run(() => getSyndicationQueue(ctx)); // SOW-058: superadmin syndication tracker
  if (method === 'POST' && pathname === '/api/syndication/approve') return run(() => approveSyndication(ctx, body ?? {})); // SOW-058: superadmin approve
  if (method === 'POST' && pathname === '/api/syndication/cancel') return run(() => cancelSyndication(ctx, body ?? {})); // SOW-058: superadmin cancel/reject
  if (method === 'GET' && pathname === '/api/social-queue') return run(() => getSocialQueue(ctx)); // SOW-121: superadmin Social Queue
  if (method === 'POST' && pathname === '/api/social-queue') return run(() => socialQueueAction(ctx, body ?? {})); // SOW-121: done/delete
  if (method === 'GET' && pathname === '/api/syndicate-now') return run(() => getSyndicateNowInfo(ctx)); // SOW-088: manual syndicate readiness
  if (method === 'POST' && pathname === '/api/syndicate-now') return run(() => syndicateNow(ctx, body)); // SOW-088: post one item to one destination now
  if (method === 'POST' && pathname === '/api/admin-ops') return run(() => triggerAdminOp(ctx, body ?? {})); // SOW-038 P3: reconcile/E2E trigger
  if (method === 'GET' && pathname === '/api/site-settings') return run(() => getSiteSettings(ctx)); // sow-271: site-wide presentation toggles
  if (method === 'GET' && pathname === '/api/cta-pool') return run(() => getCtaPool(ctx)); // sow-281: the CTA registry
  if (method === 'GET' && pathname === '/api/coupon-pool') return run(() => getCouponPool(ctx)); // SOW-119: the coupon registry
  if (method === 'GET' && pathname === '/api/coupon-usage') return run(() => getCouponUsageOp(ctx)); // SOW-119: KV usage (Worker-gated)
  // sow-231 Phase 3: issued invites. One path, three verbs, matching the Worker route it forwards to.
  if (pathname === '/api/invites') {
    if (method === 'GET') return run(() => listInvitesOp(ctx));
    if (method === 'POST') return run(() => createInviteOp(ctx, body ?? {}));
    if (method === 'PATCH') return run(() => updateInviteOp(ctx, body ?? {}));
  }
  // sow-293: the creator application review lane. KV-native like the invites above, so it opens no PR and
  // goes straight to the Worker, which gates both verbs at authorizeSuperadmin.
  if (pathname === '/api/editorial') {
    if (method === 'GET') return run(() => listEditorialOp(ctx));
    if (method === 'POST') return run(() => decideEditorialOp(ctx, body ?? {}));
  }
  if (method === 'GET' && pathname === '/api/coupon-refresh') return run(() => refreshCouponUntil(ctx)); // SOW-119 QA: live-oracle recheck before the expiry popup

  // Role-gated admin/superadmin actions (the operations enforce the capability; the gate is authoritative).
  if (method === 'POST' && pathname === '/api/admin') {
    // sow-274: one path for all of them. The Worker commits with GBTI's own installation token against live
    // main, so there is no fork to go stale and no member token that needs write access to GitHub. An action
    // the Worker does not serve is REFUSED rather than falling back to a local writer: the fallback is how the
    // retired path would survive, and it would only be exercised on whichever surface nobody tested.
    const wreq = toWorkerRequest(body ?? {});
    if (!wreq) return { status: 400, json: { error: 'bad-request', message: `unknown admin action: ${body?.action}` } };
    return run(() => governanceAdminOp(ctx, { action: wreq.action, ...wreq.payload }));
  }

  return { status: 404, json: { error: 'not-found' } };
}

function normalizeQuery(q) {
  if (!q) return {};
  if (q instanceof URLSearchParams) return Object.fromEntries(q.entries());
  return q;
}
