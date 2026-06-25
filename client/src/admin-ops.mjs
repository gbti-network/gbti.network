// Admin/superadmin operations (SOW-006; SOW-038 P4). Each reads the current LOCAL file, applies the consolidated
// pure governance core (membership/superadmin-actions.mjs), and opens the appropriate house/cross-folder PR
// (publishFiles). SOW-038 P4 converged this path off the parallel admin-edits.mjs onto superadmin-actions, so the
// SAME module the effective-status precedence reads (overrides-core) is the module the panel writes, and every
// governance action now gains (1) idempotency — a no-op when already in that state, no redundant PR — and (2) an
// identity-minimal audit entry, folded into the PR body (the PR is the audit trail).
//
// Capability is checked against the signed-in role from the LOCAL roles.yml, but that is UX gating only: the
// SOW-005 gate + CODEOWNERS are the real boundary (a member who fakes a role locally still cannot merge the PR).
// Errors use OperationError so every transport (CLI/MCP/UI) maps them consistently.

import yaml from 'js-yaml';

import { OperationError } from './operations.mjs';
import { canModerate, canBanGrandfather, canManageRoles } from './roles.mjs';
import { ban, unban, grandfather, revokeGrandfather, grantRole, SuperadminActionError } from '../../membership/superadmin-actions.mjs';
import { addCategory as addCategoryEdit, renameLabel as renameLabelEdit, TaxonomyEditError } from '../../membership/taxonomy-edits.mjs';
import { addSource as addSourceEdit, removeSource as removeSourceEdit, setSourceEnabled as setSourceEnabledEdit, NewsSourceEditError } from '../../membership/news-source-edits.mjs'; // SOW-056 P2
import { addQuote as addQuoteEdit, removeQuote as removeQuoteEdit, setQuoteEnabled as setQuoteEnabledEdit, QuoteEditError } from '../../membership/quote-edits.mjs'; // SOW-063 P3
import { parseContentFile } from './content-ops.mjs';
import { publishFiles } from './publish.mjs';

function requireRole(ctx, check, need) {
  const role = ctx.role?.() ?? 'member';
  if (!check(role)) throw new OperationError('forbidden', `requires ${need} (you are ${role})`);
  return role;
}

// Host-agnostic: read the CURRENT house/content file through ctx.reader (node = working copy, extension =
// GitHub Contents API) so an edit never clobbers the rest of the file. The repoPath guard ensures the node
// host has a local clone to read from (the extension host satisfies it with a sentinel).
function requireRepo(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError('not-authenticated', 'run `gbti login` first');
  if (!ctx.store?.get('repoPath')) throw new OperationError('bad-request', 'no local repoPath configured');
  return { repo };
}

// Host-portable read: the npm host's reader.readFile is sync (returns a string); the extension's is async
// (GitHub Contents API). `await` handles both (awaiting a plain string yields the string), so the same admin
// ops run in either host.
const readYaml = async (ctx, rel) => {
  try {
    return yaml.load((await ctx.reader?.readFile?.(rel)) || '') ?? {};
  } catch {
    return {};
  }
};
const dumpYaml = (obj) => yaml.dump(obj, { lineWidth: 100, noRefs: true });
const slugOf = (rel) => rel.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48);

// SOW-038 P4: the action context for the governance core — the signed-in actor (for the identity-minimal audit
// entry) + the deterministic clock. Actor is null when the host did not attach an identity (the audit allows it).
function actionCtx(ctx) {
  const id = ctx.identity?.();
  return {
    actor: id ? { githubId: id.githubId ?? id.github_id ?? null, login: id.login ?? null } : null,
    now: ctx.now ? ctx.now() : undefined,
  };
}
// Fold the identity-minimal audit entry into the PR body (the PR is the audit trail) as a parseable, low-noise
// HTML comment, under an optional human-readable reason line.
function prBody(reason, auditEntry) {
  const head = reason ? `Reason: ${reason}\n\n` : '';
  return `${head}<!-- gbti-audit ${JSON.stringify(auditEntry)} -->`;
}
// A governance action that did not change anything (already in that state) -> a graceful idempotent no-op, no PR.
const noop = (message, auditEntry) => ({ changed: false, noop: true, message, audit: auditEntry });

function requireId(githubId) {
  if (githubId === undefined || githubId === null || String(githubId).trim() === '') {
    throw new OperationError('bad-request', 'githubId is required');
  }
  return String(githubId);
}
function requirePath(rel) {
  if (!rel || typeof rel !== 'string' || rel.includes('\\') || rel.startsWith('/')) {
    throw new OperationError('bad-request', 'a valid in-repo content path is required');
  }
  // Reject any non-canonical segment. Note `.` matters: path.join normalizes a `./` prefix away, so a
  // bare `rel.includes('..')` check is not enough to keep a path inside its intended scope.
  const segments = rel.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new OperationError('bad-request', 'a valid in-repo content path is required');
  }
  return rel;
}

/** Moderation (deplatform/remove) is content-only: restrict to a member content folder. */
function requireMemberContentPath(rel) {
  requirePath(rel);
  if (!rel.startsWith('members/')) {
    throw new OperationError('forbidden', 'moderation is limited to member content (members/<user>/...)');
  }
  return rel;
}

// ---- admin: ban / grandfather (house/bans.yml, house/grandfathered.yml) ----

export async function banMember(ctx, { githubId, reason } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  const { next, changed, audit } = ban(await readYaml(ctx, 'house/bans.yml'), { githubId: id, reason }, actionCtx(ctx));
  if (!changed) return noop(`already banned: ${id}`, audit);
  const pr = await publishFiles({ repo, branch: `gbti/ban-${id}`, files: [{ path: 'house/bans.yml', content: dumpYaml(next) }], message: `Ban ${id}`, title: `Ban member ${id}`, body: prBody(reason, audit) });
  return { ...pr, changed: true, audit };
}

export async function unbanMember(ctx, { githubId } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  const { next, changed, audit } = unban(await readYaml(ctx, 'house/bans.yml'), { githubId: id }, actionCtx(ctx));
  if (!changed) return noop(`not banned: ${id}`, audit);
  const pr = await publishFiles({ repo, branch: `gbti/unban-${id}`, files: [{ path: 'house/bans.yml', content: dumpYaml(next) }], message: `Unban ${id}`, title: `Unban member ${id}`, body: prBody(null, audit) });
  return { ...pr, changed: true, audit };
}

export async function grandfatherMember(ctx, { githubId, reason, until = null, login } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  let result;
  try {
    result = grandfather(await readYaml(ctx, 'house/grandfathered.yml'), { githubId: id, login, reason, until }, actionCtx(ctx));
  } catch (err) {
    if (err instanceof SuperadminActionError) throw new OperationError('bad-request', err.message);
    throw err;
  }
  if (!result.changed) return noop(`already grandfathered: ${id}`, result.audit);
  const pr = await publishFiles({ repo, branch: `gbti/grandfather-${id}`, files: [{ path: 'house/grandfathered.yml', content: dumpYaml(result.next) }], message: `Grandfather ${id}`, title: `Grandfather member ${id}`, body: prBody(reason, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function ungrandfatherMember(ctx, { githubId } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  const { next, changed, audit } = revokeGrandfather(await readYaml(ctx, 'house/grandfathered.yml'), { githubId: id }, actionCtx(ctx));
  if (!changed) return noop(`not grandfathered: ${id}`, audit);
  const pr = await publishFiles({ repo, branch: `gbti/ungrandfather-${id}`, files: [{ path: 'house/grandfathered.yml', content: dumpYaml(next) }], message: `Remove grandfather ${id}`, title: `Remove grandfather for ${id}`, body: prBody(null, audit) });
  return { ...pr, changed: true, audit };
}

// ---- superadmin: role management (house/roles.yml) ----

export async function setMemberRole(ctx, { githubId, role, login } = {}) {
  requireRole(ctx, canManageRoles, 'superadmin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  if (!role) throw new OperationError('bad-request', 'role is required (member|moderator|admin|superadmin)');
  let result;
  try {
    result = grantRole(await readYaml(ctx, 'house/roles.yml'), { githubId: id, role, login }, actionCtx(ctx));
  } catch (err) {
    if (err instanceof SuperadminActionError) throw new OperationError('bad-request', err.message);
    throw err;
  }
  if (!result.changed) return noop(`already ${role}: ${id}`, result.audit);
  const pr = await publishFiles({ repo, branch: `gbti/role-${id}`, files: [{ path: 'house/roles.yml', content: dumpYaml(result.next) }], message: `Set ${id} role=${role}`, title: `Set role for ${id}: ${role}`, body: prBody(`role: ${role}`, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

// ---- moderator: deplatform / remove any content ----

export async function deplatformContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canModerate, 'moderator');
  const { repo } = requireRepo(ctx);
  requireMemberContentPath(rel);
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError('not-found', `no such file: ${rel}`);
  const { frontmatter, body } = parseContentFile(text);
  // SOW-038: deplatform = status -> draft (excludes it from the build, indexes, and feeds). Visibility is left
  // intact (not forced to members) so a later restore keeps the content's original public/members audience.
  const updated = { ...(frontmatter ?? {}), status: 'draft' };
  const content = `---\n${dumpYaml(updated).trimEnd()}\n---\n\n${String(body).trim()}\n`;
  return publishFiles({ repo, branch: `gbti/deplatform-${slugOf(rel)}`, files: [{ path: rel, content }], message: `Deplatform ${rel}`, title: `Deplatform ${rel}`, body: 'Moderation: set status to draft.' });
}

export async function removeContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canModerate, 'moderator');
  const { repo } = requireRepo(ctx);
  requireMemberContentPath(rel);
  return publishFiles({ repo, branch: `gbti/remove-${slugOf(rel)}`, files: [{ path: rel, content: null }], message: `Remove ${rel}`, title: `Remove ${rel}`, body: 'Moderation: remove content.' });
}

// ---- admin: category manager (house/taxonomy.yml) — SOW-055 v1 (add + rename-label, the safe ops) ----

const TAXONOMY_PATH = 'house/taxonomy.yml';
// yaml.dump drops comments; taxonomy.yml carries a load-bearing documentation header (the SOW-012 contract), so
// preserve the leading comment block and re-prepend it on write.
function leadingComment(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') out.push(line);
    else break;
  }
  const block = out.join('\n').replace(/\s+$/, '');
  return block ? `${block}\n` : '';
}

/** Read the current canonical taxonomy ({ tree }) for the category-manager UI. Public data; read-only. */
export async function getTaxonomy(ctx) {
  const raw = (await ctx.reader?.readFile?.(TAXONOMY_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  return { tree: parsed.tree || {} };
}

export async function addContentCategory(ctx, { parentPath, key, label } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin'); // house/taxonomy.yml is admin-owned (CODEOWNERS); the gate is the real boundary
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(TAXONOMY_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = addCategoryEdit(parsed, { parentPath, key, label }, actionCtx(ctx)); }
  catch (err) { if (err instanceof TaxonomyEditError) throw new OperationError('bad-request', err.message); throw err; }
  const fullPath = [...(Array.isArray(parentPath) ? parentPath : []), key].filter(Boolean);
  if (!result.changed) return noop(`category already exists: ${fullPath.join(' > ')}`, result.audit);
  const pr = await publishFiles({ repo, branch: `gbti/category-add-${slugOf(fullPath.join('-'))}`, files: [{ path: TAXONOMY_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message: `Add category ${fullPath.join('/')}`, title: `Add category: ${label}`, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function renameContentCategoryLabel(ctx, { path, label } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(TAXONOMY_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = renameLabelEdit(parsed, { path, label }, actionCtx(ctx)); }
  catch (err) { if (err instanceof TaxonomyEditError) throw new OperationError('bad-request', err.message); throw err; }
  const p = Array.isArray(path) ? path : [];
  if (!result.changed) return noop(`label unchanged: ${p.join(' > ')}`, result.audit);
  const pr = await publishFiles({ repo, branch: `gbti/category-rename-${slugOf(p.join('-'))}`, files: [{ path: TAXONOMY_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message: `Rename category ${p.join('/')} -> ${label}`, title: `Rename category: ${label}`, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

// SOW-056 Phase 2: the superadmin news-source-pool manager. Each edit applies the pure news-source-edits core to the
// parsed house/news-sources.yml and opens an auto-merged house PR (admin-owned via CODEOWNERS; the gate is the real
// boundary), exactly like the category manager. Edits go live at the Pages-deploy cadence (the worker reads the
// rebuilt /news-sources.json next cron).
const NEWS_SOURCES_PATH = 'house/news-sources.yml';

/** Read the current news-source pool for the manager UI. Public data; read-only. */
export async function getNewsSourcePool(ctx) {
  const raw = (await ctx.reader?.readFile?.(NEWS_SOURCES_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  return { sources: Array.isArray(parsed.sources) ? parsed.sources : [] };
}

async function editNewsSources(ctx, edit, { branch, message, title, noopMsg }) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(NEWS_SOURCES_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = edit(parsed); }
  catch (err) { if (err instanceof NewsSourceEditError) throw new OperationError('bad-request', err.message); throw err; }
  if (!result.changed) return noop(noopMsg, result.audit);
  const pr = await publishFiles({ repo, branch, files: [{ path: NEWS_SOURCES_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function addNewsSource(ctx, { id, name, url, description } = {}) {
  const sid = slugOf(String(id || name || ''));
  return editNewsSources(ctx, (parsed) => addSourceEdit(parsed, { id, name, url, description }, actionCtx(ctx)),
    { branch: `gbti/news-source-add-${sid}`, message: `Add news source ${id || name}`, title: `Add news source: ${name || id}`, noopMsg: `news source already present: ${id || name}` });
}

export async function removeNewsSource(ctx, { id } = {}) {
  const sid = slugOf(String(id || ''));
  return editNewsSources(ctx, (parsed) => removeSourceEdit(parsed, { id }, actionCtx(ctx)),
    { branch: `gbti/news-source-remove-${sid}`, message: `Remove news source ${id}`, title: `Remove news source: ${id}`, noopMsg: `no such news source: ${id}` });
}

export async function setNewsSourceEnabled(ctx, { id, enabled } = {}) {
  const sid = slugOf(String(id || ''));
  const on = !!enabled;
  return editNewsSources(ctx, (parsed) => setSourceEnabledEdit(parsed, { id, enabled: on }, actionCtx(ctx)),
    { branch: `gbti/news-source-${on ? 'enable' : 'disable'}-${sid}`, message: `${on ? 'Enable' : 'Disable'} news source ${id}`, title: `${on ? 'Enable' : 'Disable'} news source: ${id}`, noopMsg: `news source already ${on ? 'enabled' : 'disabled'}: ${id}` });
}

// SOW-063 Phase 3: the superadmin quote-pool manager. Each edit applies the pure quote-edits core to the parsed
// house/quotes.yml and opens an auto-merged house PR (admin-owned via CODEOWNERS; the gate is the real boundary),
// exactly like the news-source manager. Edits go live at the Pages-deploy cadence (the extension reads the rebuilt
// /quotes.json). Quotes are keyed by their text (no id).
const QUOTES_PATH = 'house/quotes.yml';
const quoteSlug = (text) => slugOf(String(text || '').slice(0, 40)) || 'quote';

/** Read the current quote pool for the manager UI. Public data; read-only. */
export async function getQuotePool(ctx) {
  const raw = (await ctx.reader?.readFile?.(QUOTES_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  return { quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [] };
}

async function editQuotes(ctx, edit, { branch, message, title, noopMsg }) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(QUOTES_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = edit(parsed); }
  catch (err) { if (err instanceof QuoteEditError) throw new OperationError('bad-request', err.message); throw err; }
  if (!result.changed) return noop(noopMsg, result.audit);
  const pr = await publishFiles({ repo, branch, files: [{ path: QUOTES_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function addQuote(ctx, { text, author } = {}) {
  return editQuotes(ctx, (parsed) => addQuoteEdit(parsed, { text, author }, actionCtx(ctx)),
    { branch: `gbti/quote-add-${quoteSlug(text)}`, message: `Add quote (${author || 'unknown'})`, title: `Add quote: ${author || 'unknown'}`, noopMsg: 'quote already present' });
}

export async function removeQuote(ctx, { text } = {}) {
  return editQuotes(ctx, (parsed) => removeQuoteEdit(parsed, { text }, actionCtx(ctx)),
    { branch: `gbti/quote-remove-${quoteSlug(text)}`, message: 'Remove quote', title: 'Remove quote', noopMsg: 'no such quote' });
}

export async function setQuoteEnabled(ctx, { text, enabled } = {}) {
  const on = !!enabled;
  return editQuotes(ctx, (parsed) => setQuoteEnabledEdit(parsed, { text, enabled: on }, actionCtx(ctx)),
    { branch: `gbti/quote-${on ? 'enable' : 'disable'}-${quoteSlug(text)}`, message: `${on ? 'Enable' : 'Disable'} quote`, title: `${on ? 'Enable' : 'Disable'} quote`, noopMsg: `quote already ${on ? 'enabled' : 'disabled'}` });
}
