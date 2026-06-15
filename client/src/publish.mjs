// Publish orchestration (SOW-006): turn a validated content change (from content-ops buildContentFile)
// into a pull request, via the member's fork. This is the managed abstraction the CMS UI and the MCP
// `open_pr` tool both call. It never bypasses the gate: the PR goes through the exact same SOW-005 gate as
// a hand-authored one. Idempotent by branch: re-publishing the same item updates its existing branch + PR
// rather than opening duplicates.

import { toBase64 } from './github-repo.mjs';

/** Deterministic branch name for a content item, so re-publishing reuses the same branch + PR. */
export function branchName(type, slug) {
  return type === 'profile' ? 'gbti/profile' : `gbti/${type}-${slug}`;
}

function defaultMessage(change) {
  return change.type === 'profile'
    ? 'Update profile'
    : `${change.slug ? 'Update' : 'Add'} ${change.type}: ${change.slug ?? ''}`.trim();
}

function defaultTitle(change) {
  return change.type === 'profile'
    ? `Update ${change.username}'s profile`
    : `${change.type}: ${change.slug}`;
}

/**
 * Publish a content change as (or into) a PR.
 *
 * @param {object} a
 * @param {object} a.repo     a github-repo client (createRepoClient).
 * @param {object} a.change   a buildContentFile result: { path, markdown, type, slug, username }.
 * @param {string} [a.message] commit message; defaults from the change.
 * @param {string} [a.title]   PR title; defaults from the change.
 * @param {string} [a.body]    PR body.
 * @returns {Promise<{prNumber, prUrl, branch, fork, updated}>}
 */
export async function publishContent({ repo, change, message, title, body }) {
  if (!change?.path || !change?.markdown) throw new Error('publishContent: a built content change is required');

  const fork = await repo.ensureFork();                 // { full_name, owner }
  const base = await repo.getDefaultBranch(repo.upstream);
  const baseSha = await repo.getBranchSha(fork.full_name, base);
  const branch = branchName(change.type, change.slug);

  await repo.ensureBranch(fork.full_name, branch, baseSha);

  // CREATE vs UPDATE: the Contents API needs the existing blob sha to overwrite a file on the branch.
  const existingSha = await repo.getFileSha(fork.full_name, change.path, branch);
  await repo.putFile(fork.full_name, change.path, {
    message: message ?? defaultMessage(change),
    contentBase64: toBase64(change.markdown),
    branch,
    sha: existingSha ?? undefined,
  });

  const head = `${fork.owner}:${branch}`;
  const existing = await repo.findOpenPull({ head });
  if (existing) {
    return { prNumber: existing.number, prUrl: existing.html_url, branch, fork: fork.full_name, updated: true };
  }

  const pull = await repo.openPull({ title: title ?? defaultTitle(change), head, base, body: body ?? '' });
  return { prNumber: pull.number, prUrl: pull.html_url, branch, fork: fork.full_name, updated: false };
}

/**
 * General multi-file PR primitive (used by the admin/superadmin tools, which edit house/*.yml or another
 * member's content rather than the author's own folder). Each file is { path, content }; content === null
 * deletes the file. Idempotent by branch: re-running updates the same branch + PR.
 *
 * @returns {Promise<{prNumber, prUrl, branch, fork, updated}>}
 */
export async function publishFiles({ repo, branch, files, message, title, body }) {
  if (!branch) throw new Error('publishFiles: a branch name is required');
  if (!Array.isArray(files) || files.length === 0) throw new Error('publishFiles: at least one file change is required');

  const fork = await repo.ensureFork();
  const base = await repo.getDefaultBranch(repo.upstream);
  const baseSha = await repo.getBranchSha(fork.full_name, base);
  await repo.ensureBranch(fork.full_name, branch, baseSha);

  for (const f of files) {
    const existingSha = await repo.getFileSha(fork.full_name, f.path, branch);
    if (f.content === null) {
      if (existingSha) await repo.deleteFile(fork.full_name, f.path, { message: message ?? `Remove ${f.path}`, branch, sha: existingSha });
    } else {
      await repo.putFile(fork.full_name, f.path, {
        message: message ?? `Update ${f.path}`,
        contentBase64: toBase64(f.content),
        branch,
        sha: existingSha ?? undefined,
      });
    }
  }

  const head = `${fork.owner}:${branch}`;
  const existing = await repo.findOpenPull({ head });
  if (existing) return { prNumber: existing.number, prUrl: existing.html_url, branch, fork: fork.full_name, updated: true };
  const pull = await repo.openPull({ title: title ?? message ?? 'Update', head, base, body: body ?? '' });
  return { prNumber: pull.number, prUrl: pull.html_url, branch, fork: fork.full_name, updated: false };
}
