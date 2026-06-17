// Admin/superadmin operations (SOW-006). Each reads the current LOCAL file, applies a pure edit
// (admin-edits.mjs), and opens the appropriate house/cross-folder PR (publishFiles). Capability is checked
// against the signed-in role from the LOCAL roles.yml, but that is UX gating only: the SOW-005 gate +
// CODEOWNERS are the real boundary (a member who fakes a role locally still cannot merge the PR). The PR is
// the audit trail. Errors use OperationError so every transport (CLI/MCP/UI) maps them consistently.

import yaml from 'js-yaml';

import { OperationError } from './operations.mjs';
import { canModerate, canBanGrandfather, canManageRoles } from './roles.mjs';
import { addBan, removeBan, addGrandfather, removeGrandfather, assignRole, setStatusDraft } from './admin-edits.mjs';
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
const nowIso = (ctx) => (ctx.now ? ctx.now() : new Date().toISOString());
const slugOf = (rel) => rel.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48);

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
  const updated = addBan(await readYaml(ctx,'house/bans.yml'), { githubId: id, reason, at: nowIso(ctx) });
  return publishFiles({ repo, branch: `gbti/ban-${id}`, files: [{ path: 'house/bans.yml', content: dumpYaml(updated) }], message: `Ban ${id}`, title: `Ban member ${id}`, body: reason ? `Reason: ${reason}` : '' });
}

export async function unbanMember(ctx, { githubId } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  const updated = removeBan(await readYaml(ctx,'house/bans.yml'), id);
  return publishFiles({ repo, branch: `gbti/unban-${id}`, files: [{ path: 'house/bans.yml', content: dumpYaml(updated) }], message: `Unban ${id}`, title: `Unban member ${id}` });
}

export async function grandfatherMember(ctx, { githubId, reason, until = null, login } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  const updated = addGrandfather(await readYaml(ctx,'house/grandfathered.yml'), { githubId: id, reason, at: nowIso(ctx), until, login });
  return publishFiles({ repo, branch: `gbti/grandfather-${id}`, files: [{ path: 'house/grandfathered.yml', content: dumpYaml(updated) }], message: `Grandfather ${id}`, title: `Grandfather member ${id}`, body: reason ? `Reason: ${reason}` : '' });
}

export async function ungrandfatherMember(ctx, { githubId } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  const updated = removeGrandfather(await readYaml(ctx,'house/grandfathered.yml'), id);
  return publishFiles({ repo, branch: `gbti/ungrandfather-${id}`, files: [{ path: 'house/grandfathered.yml', content: dumpYaml(updated) }], message: `Remove grandfather ${id}`, title: `Remove grandfather for ${id}` });
}

// ---- superadmin: role management (house/roles.yml) ----

export async function setMemberRole(ctx, { githubId, role, login } = {}) {
  requireRole(ctx, canManageRoles, 'superadmin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  if (!role) throw new OperationError('bad-request', 'role is required (member|moderator|admin|superadmin)');
  let updated;
  try {
    updated = assignRole(await readYaml(ctx,'house/roles.yml'), { githubId: id, role, login });
  } catch (err) {
    throw new OperationError('bad-request', err.message);
  }
  return publishFiles({ repo, branch: `gbti/role-${id}`, files: [{ path: 'house/roles.yml', content: dumpYaml(updated) }], message: `Set ${id} role=${role}`, title: `Set role for ${id}: ${role}` });
}

// ---- moderator: deplatform / remove any content ----

export async function deplatformContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canModerate, 'moderator');
  const { repo } = requireRepo(ctx);
  requireMemberContentPath(rel);
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError('not-found', `no such file: ${rel}`);
  const { frontmatter, body } = parseContentFile(text);
  const updated = setStatusDraft(frontmatter);
  const content = `---\n${dumpYaml(updated).trimEnd()}\n---\n\n${String(body).trim()}\n`;
  return publishFiles({ repo, branch: `gbti/deplatform-${slugOf(rel)}`, files: [{ path: rel, content }], message: `Deplatform ${rel}`, title: `Deplatform ${rel}`, body: 'Moderation: set status to draft.' });
}

export async function removeContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canModerate, 'moderator');
  const { repo } = requireRepo(ctx);
  requireMemberContentPath(rel);
  return publishFiles({ repo, branch: `gbti/remove-${slugOf(rel)}`, files: [{ path: rel, content: null }], message: `Remove ${rel}`, title: `Remove ${rel}`, body: 'Moderation: remove content.' });
}
