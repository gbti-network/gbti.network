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
  authorContent,
  listPRs,
  prStatus,
  publishComment,
  editComment,
  listComments,
  publishShare,
  ogPreview,
  listDrafts,
  readDraft,
  discardDraft,
  publishDraft,
} from './operations.mjs';
import { startDeviceLogin, confirmDeviceLogin, logout } from './mcp-auth.mjs';
// sow-271: resolve the retired `product` type name at the MCP BOUNDARY, so nothing downstream has to know it
// ever existed. Accepting it in TYPE_ENUM alone is not enough: the SUBDIR maps carry an alias but the TYPES
// allow-lists in github-reader.mjs and repo-fs.mjs do not, so a legacy value would pass the schema and then
// be rejected deeper with a worse message. One canonicalization here beats an alias in every map.
import { canonicalType } from '../../membership/content-types.mjs';

const PROTOCOL_VERSION = '2024-11-05';

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: true });
// sow-271: `product` STAYS in this enum. It is the retired name for `project`, and the enum is the SCHEMA,
// so a member's AI agent calling list_my_content or publish_content with type:'product' is rejected here
// before canonicalType can resolve it. The tools are a published interface that agents were written
// against; removing the value breaks those agents with a validation error, not a helpful message.
const TYPE_ENUM = { type: 'string', enum: ['post', 'project', 'product', 'prompt', 'profile'] };
// SOW-106: the REQUIRED author intent. "published" merges to the network (public); "draft" saves it privately.
const STATUS_ENUM = { type: 'string', enum: ['draft', 'published'], description: 'REQUIRED: "published" merges and goes live on the network; "draft" saves it privately for review.' };
const COMMENT_TARGET = { type: 'string', enum: ['post', 'project', 'prompt', 'share', 'news'] }; // SOW-072
// sow-193: `path` + `scope`, which authorContent forwards to publish()/saveDraft() now. `path` is what turns a
// re-publish under a changed slug into a RENAME (one PR that moves the item and 301s the old URL) instead of a
// duplicate item with the old page still live. `scope` targets the non-member house/ folder (superadmin only,
// re-checked server-side); omit it for your own folder.
const PATH_PARAM = { type: 'string', description: 'The repo path of the EXISTING item you are editing (members/<you>/<type>s/<slug>/index.md). Pass it whenever the item already exists: it preserves publishedAt, carries redirectFrom, and makes a changed slug a rename rather than a duplicate.' };
const SCOPE_PARAM = { type: 'string', enum: ['member', 'house'], description: 'Target folder. "member" (default) is your own folder; "house" is the non-member house/ content and is superadmin-only, re-checked server-side.' };

// sow-194 + sow-193: RESOLVE a draft's store server-side before acting on it.
//
// listDrafts folds two stores (a private staged record, and a repo draft committed to the canonical repo; a
// third, the fork branch, was retired in sow-274), and each action routes differently. The operations take
// `store` and `path` to do that routing, but the tool schema advertises only { type, slug }, so that is what an
// agent sends. With `store` undefined, discardDraft's `store === 'repo'` guard never fires and a repo draft is
// treated as a staged one. When there were forks, that meant deleting a stale fork branch at the same slug and
// reporting success; now it means a wrong-store delete. Resolving the row here prevents both.
//
// Threading `store` through the handlers would only fix the caller who remembers to pass it. Resolving it here
// means the caller cannot get it wrong, because the caller no longer supplies it. An explicit `store` argument
// is still accepted as a hint, but the resolved row wins.
//
// FAIL SAFE: when the row cannot be identified, the caller gets a typed error rather than a guessed store.
// An unresolvable discard must be a no-op with a message, never a silent delete of the wrong record.
async function resolveDraftRow(ctx, { type, slug }) {
  try {
    const { drafts } = await listDrafts(ctx, { type });
    return (Array.isArray(drafts) ? drafts : []).find((d) => d?.type === type && d?.slug === slug) ?? null;
  } catch {
    return null; // a listing failure must not silently guess a store
  }
}

/** The { store, path } to act with, resolved from the live row. Throws `not-found` when it cannot be resolved. */
async function draftTarget(ctx, args, { require: mustResolve = true } = {}) {
  const type = args?.type;
  const slug = args?.slug;
  const row = await resolveDraftRow(ctx, { type, slug });
  if (!row && mustResolve) {
    throw new OperationError('not-found', `no draft found for ${type}/${slug}. Call list_drafts to see what exists; refusing to act on an unidentified draft.`);
  }
  return { type, slug, store: row?.store ?? args?.store ?? undefined, path: row?.path ?? args?.path ?? undefined };
}

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
    description: "List the member's own content (posts/projects/prompts/profile). Optional `type` filter.",
    inputSchema: obj({ type: TYPE_ENUM, scope: SCOPE_PARAM }),
    handler: (ctx, args) => listContent(ctx, { type: canonicalType(args?.type) || undefined, scope: args?.scope }),
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
    handler: (ctx, args) => validateContent(ctx, { type: canonicalType(args?.type) || undefined, input: args?.input, body: args?.body }),
  },
  {
    name: 'publish_content',
    description: 'Author a content object. REQUIRED `status`: "published" merges it (public, goes live on the network) and returns the PR number + url; "draft" saves it privately for review (no PR, nothing public). Forces author/owner fields; goes through the gate. For a new project/prompt, pass `authorNote` (markdown) to seed the required SOW-014 from-the-author intro comment into the SAME PR.',
    inputSchema: obj(
      { type: TYPE_ENUM, input: { type: 'object' }, status: STATUS_ENUM, body: { type: 'string' }, authorNote: { type: 'string' }, title: { type: 'string' }, path: PATH_PARAM, scope: SCOPE_PARAM },
      ['type', 'input', 'status'],
    ),
    // sow-271: this one forwards `args` WHOLE, so the type has to be canonicalized here rather than relying
    // on the spread. The per-type shortcuts below pin `type` themselves and need nothing.
    handler: (ctx, args) => authorContent(ctx, { ...(args ?? {}), ...(args?.type ? { type: canonicalType(args.type) } : {}) }),
  },
  // SOW-025: per-type "add content" shortcuts so an agent gets guided tools instead of the generic
  // publish_content. Each pre-sets `type` and forwards to the same gated publish flow (author is forced to the
  // signed-in member; publishing is paid-only). Call validate_content first if unsure which fields are required.
  {
    name: 'add_prompt',
    description: 'Author a PROMPT. REQUIRED `status`: "published" publishes it live (a PR that merges), "draft" saves it privately for review. input requires: title, slug (kebab-case), shortDescription; optional: targets[], categories[] (taxonomy path), tags[], variables[], sourceUrl. The markdown `body` is the prompt text. author is forced to you. SOW-014: a new prompt needs a from-the-author intro, so pass `authorNote` (markdown) and it publishes as your public intro comment in the SAME PR.',
    inputSchema: obj({ input: { type: 'object' }, status: STATUS_ENUM, body: { type: 'string' }, authorNote: { type: 'string' }, title: { type: 'string' }, path: PATH_PARAM, scope: SCOPE_PARAM }, ['input', 'status']),
    handler: (ctx, args) => authorContent(ctx, { ...(args ?? {}), type: 'prompt' }),
  },
  {
    name: 'add_product',
    description: 'Author a PROJECT (this tool was named add_product before the type was renamed; the name is kept so existing agents keep working). REQUIRED `status`: "published" publishes it live (a PR that merges), "draft" saves it privately for review. input requires: title, slug, shortDescription, icon (repo image path), featuredImage (16:10 repo image path); optional: categories[], tags[], pricing, links[], license (an exact id from house/licenses.yml, e.g. MIT, GPL-3.0, Proprietary, Custom) and licenseUrl (required for Custom). The markdown `body` is the project description. author is forced to you. SOW-014: a new project needs a from-the-author intro, so pass `authorNote` (markdown) and it publishes as your public intro comment in the SAME PR. (Attach images via the repo first; an MCP image-upload tool is a follow-on.)',
    inputSchema: obj({ input: { type: 'object' }, status: STATUS_ENUM, body: { type: 'string' }, authorNote: { type: 'string' }, title: { type: 'string' }, path: PATH_PARAM, scope: SCOPE_PARAM }, ['input', 'status']),
    handler: (ctx, args) => authorContent(ctx, { ...(args ?? {}), type: 'project' }),
  },
  {
    name: 'add_post',
    description: 'Author a BLOG POST. REQUIRED `status`: "published" publishes it live (a PR that merges), "draft" saves it privately for review. input requires: title, slug (kebab-case); optional: excerpt, categories[], tags[], coverImage, publishedAt. The markdown `body` is the article. author is forced to you.',
    inputSchema: obj({ input: { type: 'object' }, status: STATUS_ENUM, body: { type: 'string' }, title: { type: 'string' }, path: PATH_PARAM, scope: SCOPE_PARAM }, ['input', 'status']),
    handler: (ctx, args) => authorContent(ctx, { ...(args ?? {}), type: 'post' }),
  },
  // sow-193: the DRAFT lifecycle. These four operations existed and were tested since SOW-082 but none was
  // exposed as a tool, so an agent could create a draft with status:"draft" and then never list, read, publish
  // or discard it. A staged draft lives in the private store, where nothing else would ever show it to them.
  // Thin wrappers, no new logic.
  {
    name: 'list_drafts',
    description: 'List your staged drafts (items saved with status:"draft" and not yet published). Optional `type` filter. Each row carries its type, slug, title, and whether it still validates against the current schema.',
    inputSchema: obj({ type: TYPE_ENUM }),
    handler: (ctx, args) => listDrafts(ctx, { type: canonicalType(args?.type) || undefined }),
  },
  {
    name: 'read_draft',
    description: 'Read one staged draft (frontmatter + body) by `type` and `slug`, so you can revise it before publishing.',
    inputSchema: obj({ type: TYPE_ENUM, slug: { type: 'string' } }, ['type', 'slug']),
    handler: async (ctx, args) => readDraft(ctx, await draftTarget(ctx, args)),
  },
  {
    name: 'publish_draft',
    description: 'Publish a staged draft: opens the gated pull request from the draft branch it is already on. Paid-only, like every publish.',
    inputSchema: obj({ type: TYPE_ENUM, slug: { type: 'string' }, title: { type: 'string' } }, ['type', 'slug']),
    handler: async (ctx, args) => publishDraft(ctx, { ...(await draftTarget(ctx, args)), title: args?.title }),
  },
  {
    name: 'discard_draft',
    description: 'Discard a staged draft and delete its branch. Refused while the draft has an open pull request: withdraw the pull request first. This is not reversible, so confirm with the member before calling it.',
    inputSchema: obj({ type: TYPE_ENUM, slug: { type: 'string' } }, ['type', 'slug']),
    handler: async (ctx, args) => discardDraft(ctx, await draftTarget(ctx, args)),
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
  // SOW-072: commenting via MCP — author the SAME members-only (encrypted) comment + author-intro flow the CMS UI
  // uses, through the gated PR pipeline. targetSlug: the content slug for a post/product/prompt; "<author>/<shareId>"
  // for a Share (SOW-032); the news targetSlug for news. The server forces visibility (only an authorNote intro on
  // your own post/product/prompt is public; every reply, and ALL Share comments, are members-only + encrypted).
  {
    name: 'post_comment',
    description: 'Post a comment as a pull request (members-only + encrypted unless it is a public from-the-author intro). input: targetType ("post"|"project"|"prompt"|"share"|"news"), targetSlug (content slug, or "<author>/<shareId>" for a share), body (markdown). optional: authorNote (true = a public "from the author" intro, valid only on your own post/product/prompt), parentId (reply), title (the pull request title). author is forced to you; paid-only; goes through the gate. Returns the PR number + url.',
    inputSchema: obj(
      { targetType: COMMENT_TARGET, targetSlug: { type: 'string' }, body: { type: 'string' }, authorNote: { type: 'boolean' }, parentId: { type: 'string' }, title: { type: 'string' } },
      ['targetType', 'targetSlug', 'body'],
    ),
    handler: (ctx, args) => publishComment(ctx, args ?? {}),
  },
  {
    name: 'edit_comment',
    description: 'Edit one of your own comments by `id` (re-publishes through the gate; visibility is re-derived and a members body is re-encrypted). Args: id, body (markdown), optional authorNote.',
    inputSchema: obj({ id: { type: 'string' }, body: { type: 'string' }, authorNote: { type: 'boolean' } }, ['id', 'body']),
    handler: (ctx, args) => editComment(ctx, { id: args?.id, body: args?.body, authorNote: args?.authorNote }),
  },
  // sow-181: post a SHARE from an agent. A Share is a link to something worth reading, so the tool takes a url
  // and does the OG extraction ITSELF (ogPreview, the same SSRF-guarded Worker route the extension composer
  // uses) rather than making the caller pre-fetch metadata. `visibility` is REQUIRED with no default so the
  // agent has to ask the member public-or-members before anything is written: the schema default is `members`,
  // and silently defaulting would quietly hide a share the member meant to publish, or publish one they meant
  // to keep in the members stream.
  {
    name: 'add_share',
    description: 'Post a SHARE (a link to something worth reading) to the network. REQUIRED `url`. Shares go to the members-only stream (body encrypted); only a superadmin can post a public share, by passing `visibility: "public"`. Title, description and image are auto-extracted from the url unless you pass them. Optional: title, shortDescription, image, category (one flat topic key), tags[], body (your own note about the link). author is forced to you; posting a Share is paid-only and goes through the gate. Returns the PR number + url.',
    inputSchema: obj(
      {
        url: { type: 'string', description: 'The link being shared (absolute http/https URL).' },
        visibility: { type: 'string', enum: ['public', 'members'], description: 'Optional, defaults to "members". "public" is refused unless the member is a superadmin.' },
        title: { type: 'string' },
        shortDescription: { type: 'string' },
        image: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        body: { type: 'string', description: 'Optional note in your own words about why the link is worth reading.' },
      },
      ['url'],
    ),
    handler: (ctx, args) => addShare(ctx, args ?? {}),
  },
  {
    name: 'preview_link',
    description: 'Fetch the OpenGraph metadata for a url (title, description, image) WITHOUT posting anything. Useful to show the member what a Share will look like before calling add_share. Server-side and SSRF-guarded.',
    inputSchema: obj({ url: { type: 'string' } }, ['url']),
    handler: (ctx, args) => ogPreview(ctx, { url: args?.url }),
  },
  {
    name: 'list_comments',
    description: 'Read the published comment thread for a target. Args: targetType ("post"|"project"|"prompt"|"share"|"news"), targetSlug (content slug, or "<author>/<shareId>" for a share), optional limit. Reads merged/published comments (a just-posted comment appears after its PR merges + the site deploys).',
    inputSchema: obj({ targetType: COMMENT_TARGET, targetSlug: { type: 'string' }, limit: { type: 'integer' } }, ['targetType', 'targetSlug']),
    handler: (ctx, args) => listComments(ctx, { targetType: args?.targetType, targetSlug: args?.targetSlug, limit: args?.limit }),
  },
];

/** sow-323 Phase 3: the audience add_share posts with: members-only unless asked, and only the two real values. */
export function shareVisibilityArg(v) {
  const visibility = v == null || v === '' ? 'members' : v;
  if (visibility !== 'public' && visibility !== 'members') {
    throw new OperationError('bad-request', 'visibility must be "members" (the default) or "public" (superadmins only).');
  }
  return visibility;
}

/**
 * sow-181: add_share = extract THEN publish, in one call.
 *
 * The OG fetch is best-effort on purpose: a link whose metadata cannot be read (a 403, a site with no OG
 * tags, a timeout) must still be shareable, so a failed extraction degrades to the url alone rather than
 * failing the share. Anything the caller passed explicitly always wins over the extracted value, so an agent
 * can correct a bad title without losing the rest.
 */
export async function addShare(ctx, args = {}) {
  const url = String(args.url || '').trim();
  if (!url) throw new OperationError('bad-request', 'url is required');
  // sow-323 Phase 3 (owner, 2026-09-15): "Only superadmins can make shares public though, so don't even give members
  // the option on creation." A share is members-only unless asked otherwise, and the Worker refuses a public one
  // from anyone but a superadmin, so this no longer makes an agent ask the member a question with one real answer.
  const visibility = shareVisibilityArg(args.visibility);
  let og = null;
  try { og = await ogPreview(ctx, { url }); } catch { og = null; } // best-effort: never block a share on extraction
  const input = stripBlank({
    url,
    visibility,
    title: args.title ?? og?.title,
    shortDescription: args.shortDescription ?? og?.description,
    image: args.image ?? og?.image,
    // sow-222: an agent-authored share carries the creator too, so its source card offers Subscribe like any
    // other. https only, and only when the provider named the channel as well, so no card is left unnamed.
    creatorUrl: /^https:\/\//i.test(String(og?.creatorUrl || '')) ? og.creatorUrl : undefined,
    creatorName: /^https:\/\//i.test(String(og?.creatorUrl || '')) ? og?.creatorName : undefined,
    category: args.category,
    tags: Array.isArray(args.tags) ? args.tags : undefined,
  });
  // NB: publishShare's `title` is the PULL REQUEST title, not the share's. Leave it unset so it derives
  // "New Share: <share title>" itself; passing args.title here would conflate the two.
  return publishShare(ctx, { input, body: args.body ?? '' });
}

const stripBlank = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

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
