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
  publishShare,
  listShares,
  publishComment,
  editComment,
  getComment,
  listPRs,
  prStatus,
  stageImage,
  decryptMemberAsset,
  getMemberActivity,
  mutateMemberActivity,
  getFollows,
  setFollow,
  getOnboardingStatus,
} from './operations.mjs';
import { getSettings, updateSettings, getBilling, getReferral } from './settings-ops.mjs';
import { fieldsFor } from './form-fields.mjs';
import { renderMarkdown } from './markdown.mjs';
import {
  banMember, unbanMember, grandfatherMember, ungrandfatherMember, setMemberRole, deplatformContent, removeContent,
} from './admin-ops.mjs';

export { CLIENT_VERSION } from './operations.mjs';

const ADMIN_ACTIONS = {
  ban: banMember,
  unban: unbanMember,
  grandfather: grandfatherMember,
  ungrandfather: ungrandfatherMember,
  role: setMemberRole,
  deplatform: deplatformContent,
  remove: removeContent,
};

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

export async function handleApi(reqInfo, ctx) {
  const { method, pathname } = reqInfo;
  const query = normalizeQuery(reqInfo.query);
  const body = reqInfo.body;

  if (method === 'GET' && pathname === '/api/status') return { status: 200, json: getStatus(ctx) };
  if (method === 'GET' && pathname === '/api/content') return run(() => listContent(ctx, { type: query.type }));
  if (method === 'GET' && pathname === '/api/content/item') return run(() => getContentItem(ctx, { path: query.path }));
  if (method === 'POST' && pathname === '/api/validate') return run(() => validateContent(ctx, body ?? {}));
  if (method === 'POST' && pathname === '/api/publish') return run(() => publish(ctx, body ?? {}));
  if (method === 'POST' && pathname === '/api/share') return run(() => publishShare(ctx, body ?? {})); // SOW-018
  if (method === 'GET' && pathname === '/api/shares') return run(() => listShares(ctx, { limit: Number(query.limit) || undefined })); // SOW-018 feed
  if (method === 'POST' && pathname === '/api/comment') return run(() => publishComment(ctx, body ?? {})); // SOW-027
  if (method === 'POST' && pathname === '/api/comment/edit') return run(() => editComment(ctx, body ?? {})); // SOW-027
  if (method === 'GET' && pathname === '/api/comment') return run(() => getComment(ctx, { id: query.id })); // SOW-027 edit prefill
  if (method === 'GET' && pathname === '/api/activity') return run(() => getMemberActivity(ctx)); // SOW-024 (favorites + collections)
  if (method === 'POST' && pathname === '/api/activity') return run(() => mutateMemberActivity(ctx, body ?? {})); // SOW-024
  if (method === 'GET' && pathname === '/api/follows') return run(() => getFollows(ctx)); // SOW-023
  if (method === 'POST' && pathname === '/api/follows') return run(() => setFollow(ctx, body ?? {})); // SOW-023
  if (method === 'GET' && pathname === '/api/onboarding-status') return run(() => getOnboardingStatus(ctx)); // SOW-026
  if (method === 'GET' && pathname === '/api/prs') return run(() => listPRs(ctx));
  if (method === 'GET' && pathname === '/api/pr-status') return run(() => prStatus(ctx, { number: query.number }));

  if (method === 'GET' && pathname === '/api/form-fields') {
    const fields = fieldsFor(query.type);
    if (!fields) return { status: 400, json: { error: 'bad-request', message: `unknown type: ${query.type}` } };
    return { status: 200, json: { type: query.type, fields } };
  }
  if (method === 'POST' && pathname === '/api/preview') return { status: 200, json: { html: renderMarkdown(body?.body ?? '') } };
  if (method === 'POST' && pathname === '/api/image') return run(() => stageImage(ctx, body ?? {}));

  if (method === 'GET' && pathname === '/api/members-content') return run(() => listMembersOnly(ctx));
  if (method === 'POST' && pathname === '/api/member-decrypt') return run(() => decryptMemberAsset(ctx, body ?? {})); // SOW-016
  if (method === 'GET' && pathname === '/api/settings') return run(() => getSettings(ctx));
  if (method === 'POST' && pathname === '/api/settings') return run(() => updateSettings(ctx, body ?? {}));
  if (method === 'GET' && pathname === '/api/billing') return run(() => getBilling(ctx));
  if (method === 'GET' && pathname === '/api/referral') return run(() => getReferral(ctx));

  // Role-gated admin/superadmin actions (the operations enforce the capability; the gate is authoritative).
  if (method === 'POST' && pathname === '/api/admin') {
    const fn = ADMIN_ACTIONS[body?.action];
    if (!fn) return { status: 400, json: { error: 'bad-request', message: `unknown admin action: ${body?.action}` } };
    return run(() => fn(ctx, body ?? {}));
  }

  return { status: 404, json: { error: 'not-found' } };
}

function normalizeQuery(q) {
  if (!q) return {};
  if (q instanceof URLSearchParams) return Object.fromEntries(q.entries());
  return q;
}
