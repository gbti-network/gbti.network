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
