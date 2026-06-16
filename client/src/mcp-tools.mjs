// MCP managed-abstraction tools (SOW-006). A minimal, dependency-free MCP (JSON-RPC 2.0) layer so a
// member's AI agents author through the SAME content-ops + publish flow as the CMS UI. Tool handlers call
// the shared operations core; the gate stays authoritative. Both transports use this: stdio (mcp-stdio.mjs,
// a trusted spawned child) and the hardened HTTP server (POST /mcp, behind localhost + token + Origin/Host).
//
// We implement the small slice of MCP we need (initialize, tools/list, tools/call) rather than pull an SDK,
// matching this repo's no-SDK pattern and keeping it unit-testable with no install.

import {
  OperationError,
  CLIENT_VERSION,
  getStatus,
  listContent,
  getContentItem,
  validateContent,
  publish,
  listPRs,
  prStatus,
  listIncomingContributions,
  getContributionReview,
  reviewContribution,
} from './operations.mjs';
import { startDeviceLogin, confirmDeviceLogin, logout } from './mcp-auth.mjs';

const PROTOCOL_VERSION = '2024-11-05';

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: true });
const TYPE_ENUM = { type: 'string', enum: ['post', 'product', 'prompt', 'profile'] };

// The managed-abstraction tools. Each handler returns a plain JSON-serializable result (or throws an
// OperationError); dispatch() wraps it into MCP tool-call content.
export const TOOLS = [
  {
    name: 'login',
    description: 'Start GitHub sign-in via device flow (the shared GBTI OAuth app; no Chrome/extension needed). Returns a verification URL + code for the member to approve, then call `login_confirm`.',
    inputSchema: obj({}),
    handler: (ctx) => startDeviceLogin(ctx),
  },
  {
    name: 'login_confirm',
    description: 'Finish the sign-in started by `login`: poll for the member approval. Returns { pending: true } until approved (call again), then { ok: true } with the identity. Persists the token locally so publishing works with Chrome closed.',
    inputSchema: obj({}),
    handler: (ctx) => confirmDeviceLogin(ctx),
  },
  {
    name: 'logout',
    description: 'Sign out locally (clears the stored token + identity).',
    inputSchema: obj({}),
    handler: (ctx) => logout(ctx),
  },
  {
    name: 'whoami',
    description: 'Return the signed-in identity, membership/auth status, and client settings.',
    inputSchema: obj({}),
    handler: (ctx) => getStatus(ctx),
  },
  {
    name: 'list_my_content',
    description: "List the member's own content (posts/products/prompts/profile). Optional `type` filter.",
    inputSchema: obj({ type: TYPE_ENUM }),
    handler: (ctx, args) => listContent(ctx, { type: args?.type }),
  },
  {
    name: 'get_content',
    description: "Read one of the member's own content files (frontmatter + body) by repo `path`.",
    inputSchema: obj({ path: { type: 'string' } }, ['path']),
    handler: (ctx, args) => getContentItem(ctx, { path: args?.path }),
  },
  {
    name: 'validate_content',
    description: 'Validate a content object against the schema WITHOUT publishing. Returns { valid, path | error, issues }.',
    inputSchema: obj({ type: TYPE_ENUM, input: { type: 'object' }, body: { type: 'string' } }, ['type', 'input']),
    handler: (ctx, args) => validateContent(ctx, { type: args?.type, input: args?.input, body: args?.body }),
  },
  {
    name: 'publish_content',
    description: 'Validate and publish a content object as a pull request (forces author/owner fields; goes through the gate). Returns the PR number + url.',
    inputSchema: obj(
      { type: TYPE_ENUM, input: { type: 'object' }, body: { type: 'string' }, message: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' } },
      ['type', 'input'],
    ),
    handler: (ctx, args) => publish(ctx, args ?? {}),
  },
  // SOW-025: per-type "add content" shortcuts so an agent gets guided tools instead of the generic
  // publish_content. Each pre-sets `type` and forwards to the same gated publish flow (author is forced to the
  // signed-in member; publishing is paid-only). Call validate_content first if unsure which fields are required.
  {
    name: 'add_prompt',
    description: 'Create + publish a PROMPT as a pull request. input requires: title, slug (kebab-case), shortDescription; optional: targets[], categories[] (taxonomy path), tags[], variables[], sourceUrl. The markdown `body` is the prompt text. author is forced to you.',
    inputSchema: obj({ input: { type: 'object' }, body: { type: 'string' }, message: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' } }, ['input']),
    handler: (ctx, args) => publish(ctx, { ...(args ?? {}), type: 'prompt' }),
  },
  {
    name: 'add_product',
    description: 'Create + publish a PRODUCT as a pull request. input requires: title, slug, shortDescription, icon (repo image path), featuredImage (16:10 repo image path); optional: categories[], tags[], pricing, links[]. The markdown `body` is the product description. author is forced to you. (Attach images via the repo first; an MCP image-upload tool is a follow-on.)',
    inputSchema: obj({ input: { type: 'object' }, body: { type: 'string' }, message: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' } }, ['input']),
    handler: (ctx, args) => publish(ctx, { ...(args ?? {}), type: 'product' }),
  },
  {
    name: 'add_post',
    description: 'Create + publish a BLOG POST as a pull request. input requires: title, slug (kebab-case); optional: excerpt, categories[], tags[], coverImage, publishedAt. The markdown `body` is the article. author is forced to you.',
    inputSchema: obj({ input: { type: 'object' }, body: { type: 'string' }, message: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' } }, ['input']),
    handler: (ctx, args) => publish(ctx, { ...(args ?? {}), type: 'post' }),
  },
  {
    name: 'list_prs',
    description: "List the member's open pull requests upstream.",
    inputSchema: obj({}),
    handler: (ctx) => listPRs(ctx),
  },
  {
    name: 'pr_status',
    description: 'Read the gate status (held vs mergeable) for one of the member PRs by `number`.',
    inputSchema: obj({ number: { type: 'integer' } }, ['number']),
    handler: (ctx, args) => prStatus(ctx, { number: args?.number }),
  },
  {
    name: 'list_contributions',
    description: "List incoming contributions to review: open pull requests another member opened against the signed-in member's own folder, awaiting their approval (SOW-028).",
    inputSchema: obj({}),
    handler: (ctx) => listIncomingContributions(ctx),
  },
  {
    name: 'get_contribution',
    description: 'Read one incoming contribution by PR `number`: its per-file unified diff and the proposed new body of each changed markdown file (SOW-028).',
    inputSchema: obj({ number: { type: 'integer' } }, ['number']),
    handler: (ctx, args) => getContributionReview(ctx, { number: args?.number }),
  },
  {
    name: 'review_contribution',
    description: "Decide an incoming contribution to your folder: approve (merges + awards), request-changes, or decline (closes it). The client never merges directly; approve submits a GitHub review the gate reads. Args: number, decision ('approve'|'request-changes'|'decline'), optional message (SOW-028).",
    inputSchema: obj(
      { number: { type: 'integer' }, decision: { type: 'string', enum: ['approve', 'request-changes', 'decline'] }, message: { type: 'string' } },
      ['number', 'decision'],
    ),
    handler: (ctx, args) => reviewContribution(ctx, { number: args?.number, decision: args?.decision, message: args?.message }),
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
function toolText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * Handle one JSON-RPC message. Returns a response object, or null for notifications (no id). Never throws:
 * tool/operation errors become an isError tool result or a JSON-RPC error.
 */
export async function dispatch(message, ctx) {
  const { id, method, params } = message ?? {};
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'gbti-network', version: CLIENT_VERSION },
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    return null; // notification, no response
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }

  if (method === 'tools/call') {
    const tool = TOOLS_BY_NAME.get(params?.name);
    if (!tool) return rpcError(id, -32602, `unknown tool: ${params?.name}`);
    try {
      const result = await tool.handler(ctx, params?.arguments ?? {});
      return rpcResult(id, toolText(result));
    } catch (err) {
      // Surface operation errors as an MCP tool error (so the agent sees the reason), not a transport error.
      const detail = err instanceof OperationError
        ? { error: err.code, message: err.message, ...(err.details ? { issues: err.details } : {}) }
        : { error: 'internal_error', message: err?.message };
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }], isError: true });
    }
  }

  if (isNotification) return null;
  return rpcError(id, -32601, `method not found: ${method}`);
}
