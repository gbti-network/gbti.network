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

// SOW-053 NOTE: we deliberately base the publish branch on the FORK's main (below), not fresh upstream. Investigated
// "base on fresh upstream + force-reset on re-publish" and REJECTED it: the Contents API writes the WHOLE file, so on
// a fresh base any field another actor added to that same file since the member loaded it (e.g. SOW-008 contributor
// credits, a reconcile status flip) reads as a DELETION and gets clobbered by the merge. The stale base + the
// fresh-read-for-edit + GitHub's 3-way merge is exactly what preserves those concurrent edits. See SOW-053.
//
// SOW-106 Phase A: the fork's main is now kept fresh SERVER-SIDE instead. Right before the publish path CREATES
// a per-item branch, operations.syncForkIfCreatingBranch asks the Worker to merge-upstream the fork main (the
// publisher App's fork-installation token; the member token cannot: merge-upstream needs the workflows
// permission and create-ref off an unfetched upstream SHA 404s). An EXISTING branch is never synced or moved,
// so the SOW-053 protection above still holds for in-flight edits; a sync miss just falls back to this stale
// base + the needs-rebase surfacing. CLIENT-side syncing remains forbidden (the reverted 2026-07-03 attempt).

/**
 * SOW-082: commit files to a branch on the member's FORK, WITHOUT opening a PR. This is the fork+branch+commit
 * primitive shared by `saveDraft` (commit only) and `publishContent`/`publishFiles` (commit then openPull). Each
 * file is { path, content }; content === null deletes. Idempotent by branch: re-running updates the same branch
 * file in place. The SOW-053 stale-base behavior is preserved (base on the FORK's main + a fresh per-file blob-sha
 * read), so GitHub's 3-way merge keeps concurrent edits (contributor credits, reconcile status flips).
 *
 * @returns {Promise<{ fork: string, owner: string, branch: string, base: string }>}
 */
export async function commitToBranchOnFork({ repo, branch, files, message, resetStale = false }) {
  if (!branch) throw new Error('commitToBranchOnFork: a branch name is required');
  if (!Array.isArray(files) || files.length === 0) throw new Error('commitToBranchOnFork: at least one file change is required');

  const fork = await repo.ensureFork();                 // { full_name, owner }
  const base = await repo.getDefaultBranch(repo.upstream);
  const baseSha = await repo.getBranchSha(fork.full_name, base);
  // A publish branch LEFT OVER from a merged/closed PR still points at the old base; reusing it opens a
  // new PR that conflicts with upstream (hit live 2026-07-09, PRs #95/#96). When NO PR is open for the
  // branch, force-reset it to the (server-synced, SOW-106) fork main before committing. An OPEN PR blocks
  // the reset, so the SOW-053 in-flight-edit protection is untouched; drafts never pass resetStale.
  if (resetStale && repo.findOpenPull && repo.forceBranch) {
    let tip = null;
    try { tip = await repo.getBranchSha(fork.full_name, branch); } catch { tip = null; }
    if (tip && tip !== baseSha) {
      const open = await repo.findOpenPull({ head: `${fork.owner}:${branch}` });
      if (!open) await repo.forceBranch(fork.full_name, branch, baseSha);
    }
  }
  await repo.ensureBranch(fork.full_name, branch, baseSha);

  for (const f of files) {
    // CREATE vs UPDATE: the Contents API needs the existing blob sha to overwrite a file on the branch.
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

  return { fork: fork.full_name, owner: fork.owner, branch, base };
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

  const branch = branchName(change.type, change.slug);
  const { fork, owner, base } = await commitToBranchOnFork({
    repo,
    branch,
    files: [{ path: change.path, content: change.markdown }],
    message: message ?? defaultMessage(change),
    resetStale: true, // a leftover branch from a merged PR must not seed a conflicting new PR
  });

  const head = `${owner}:${branch}`;
  const existing = await repo.findOpenPull({ head });
  if (existing) {
    return { prNumber: existing.number, prUrl: existing.html_url, branch, fork, updated: true };
  }

  const pull = await repo.openPull({ title: title ?? defaultTitle(change), head, base, body: body ?? '' });
  return { prNumber: pull.number, prUrl: pull.html_url, branch, fork, updated: false };
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

  const { fork, owner, base } = await commitToBranchOnFork({ repo, branch, files, message, resetStale: true });

  const head = `${owner}:${branch}`;
  const existing = await repo.findOpenPull({ head });
  if (existing) return { prNumber: existing.number, prUrl: existing.html_url, branch, fork, updated: true };
  const pull = await repo.openPull({ title: title ?? message ?? 'Update', head, base, body: body ?? '' });
  return { prNumber: pull.number, prUrl: pull.html_url, branch, fork, updated: false };
}
