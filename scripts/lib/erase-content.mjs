// SOW-024 right-to-erasure for the member's REPOSITORY records: the KV grandfather grant removal and the one
// auto-merged PR that drafts their content and removes their members-index entry. Split out of
// scripts/lib/erase-member.mjs at the 900-line cap (2026-09-30); the code below moved verbatim, except that
// flipStatus is now imported from ./reconcile-enact.mjs (where it lives) rather than through scripts/reconcile.mjs,
// and the phase 2 comment names reconcile-enact.mjs as the home of enactContent.
// runErasure (erase-member.mjs) still runs it as the `content` step, and erase-member.mjs re-exports eraseContent
// and MEMBERS_INDEX_PATH. Must not import erase-member.mjs.

import yaml from 'js-yaml';
import { flipStatus } from './reconcile-enact.mjs';
import { writeOverrideToKvRest } from './kv-mirror.mjs'; // sow-213 Step 3: the grandfather grant is removed from the KV mirror on erasure, not a git file

export const MEMBERS_INDEX_PATH = 'house/members-index.yml';
const toBase64 = (str) => Buffer.from(str, 'utf8').toString('base64');

/**
 * Right-to-erasure for one member's REPOSITORY records. Two decoupled halves:
 *   - the KV grant removal (sow-213 Step 3): the grandfather grant is person-keyed edge state now
 *     (house/grandfathered.yml is deleted), so it is removed from the overrides mirror directly. No git, no
 *     GitHub client needed, so a member with no folder still gets their grant stripped.
 *   - ONE auto-merged git PR that flips every published file in the member's folder to draft and removes their
 *     members-index entry. Reversible (a re-subscribe / un-erase can re-publish); git history persists, disclosed
 *     in the TOS. Reported no-op without a GitHub client or any net git change. `files` is the member's content
 *     descriptors ([{ path, status }]) from buildRepoIndex; reading happens in the caller so this is testable
 *     with a fake github client.
 *
 * The GRANDFATHERED removal was added 2026-08-11 (SecurityMaster's adjudication). Until Step 3 it lived in a
 * PUBLIC git file carrying the github_id, login, a `reason` describing the commercial relationship, and an
 * `until`; the storage-boundary ruling moved that person-keyed record off the public chain into KV, and this
 * erasure follows it there. Fail LOUD on a KV write error: a GDPR erasure that could not remove a grant is
 * exactly the silent gap this must never have.
 */
export async function eraseContent({ github = null, githubId, username, files = [], base = 'main', now = new Date(), env = process.env, fetchImpl = globalThis.fetch, removeGrant = null } = {}) {
  const id = String(githubId);
  const decode = (b) => Buffer.from(b, 'base64').toString('utf8');
  const safeYaml = (text) => { try { return yaml.load(text) || {}; } catch { return null; } };

  // sow-213 Step 3: remove the grandfather grant from the KV mirror, decoupled from the git PR below. Idempotent
  // (a no-op if the id has no grant: writeOverrideToKvRest reports "already in that state"). Any OTHER failure is
  // a grantError surfaced loudly. applyKvOverride REMOVE drops only source:'kv' entries, and post-deletion the
  // preserve-mark marks every entry, so this reaches them.
  let grantRemoved = false;
  let grantError = null;
  const doRemoveGrant = removeGrant || ((args) => writeOverrideToKvRest({ env, fetchImpl, ...args }));
  const gr = await doRemoveGrant({ section: 'grandfathered', githubId: id, remove: true });
  if (gr.written) grantRemoved = true;
  else if (gr.reason && !/already in that state/.test(gr.reason)) grantError = gr.reason;

  if (!github) {
    // No GitHub client: the git half cannot run, but the KV grant removal above did.
    if (grantError) return { error: `could not remove the grandfather grant from KV: ${grantError}` };
    if (grantRemoved) return { grantRemoved, flipped: 0, indexRemoved: false, pr: null };
    return { skipped: true, reason: 'no GitHub client (set GITHUB_BOT_TOKEN + GITHUB_CONTENT_REPO), and no KV grant to remove' };
  }

  // Phase 1 -- DECIDE the GIT changes from the base branch (content flips + members-index removal). Cheap reads;
  // the no-op case creates no branch. The shas read here are NOT used to commit (that would be a TOCTOU).
  const toFlip = [];
  for (const f of files) {
    const existing = await github.getContent(f.path, base);
    if (!existing?.content) continue;
    const current = decode(existing.content);
    if (flipStatus(current, 'draft') !== current) toFlip.push(f.path);
  }
  let wantIndexRemoval = false;
  const idxBase = await github.getContent(MEMBERS_INDEX_PATH, base);
  if (idxBase?.content) {
    const parsed = safeYaml(decode(idxBase.content));
    if (parsed?.members && Object.prototype.hasOwnProperty.call(parsed.members, id)) wantIndexRemoval = true;
  }
  if (toFlip.length === 0 && !wantIndexRemoval) {
    // No git changes. Return based on the KV grant outcome above.
    if (grantError) return { error: `could not remove the grandfather grant from KV: ${grantError}` };
    if (grantRemoved) return { grantRemoved, flipped: 0, indexRemoved: false, pr: null };
    return { skipped: true, reason: 'no published content, members-index entry, or grandfather grant to change' };
  }

  // Phase 2 -- COMMIT on a fresh branch, reading each target FROM THE BRANCH so the blob sha is authoritative
  // even if the base advanced since phase 1 (no TOCTOU; mirrors scripts/lib/reconcile-enact.mjs enactContent's order).
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) return { error: `cannot resolve base head sha for ${base}` };
  const branch = `erase/${id}-${now.getTime()}`;
  await github.createRef(branch, baseSha);

  let flipped = 0;
  for (const path of toFlip) {
    const onBranch = await github.getContent(path, branch);
    if (!onBranch?.content) continue;
    const current = decode(onBranch.content);
    const next = flipStatus(current, 'draft');
    if (next === current) continue; // a concurrent flip beat us to it: skip
    await github.putContent(path, { message: `erase: draft ${path}`, content: toBase64(next), branch, sha: onBranch.sha });
    flipped++;
  }

  let indexRemoved = false;
  if (wantIndexRemoval) {
    const onBranch = await github.getContent(MEMBERS_INDEX_PATH, branch);
    const parsed = onBranch?.content ? safeYaml(decode(onBranch.content)) : null;
    if (parsed?.members && Object.prototype.hasOwnProperty.call(parsed.members, id)) {
      delete parsed.members[id]; // removes ONLY this github_id; every other member is preserved by the round-trip
      await github.putContent(MEMBERS_INDEX_PATH, {
        message: `erase: remove members-index entry for github_id ${id}`,
        content: toBase64(yaml.dump(parsed, { lineWidth: 100, noRefs: true })),
        branch, sha: onBranch.sha,
      });
      indexRemoved = true;
    }
  }

  if (flipped === 0 && !indexRemoved) {
    // The decided git changes were applied concurrently between phase 1 and phase 2 (practically never for an
    // erasure target). Skip the diff-less PR (GitHub rejects those); the KV grant removal above still stands.
    if (grantError) return { error: `could not remove the grandfather grant from KV: ${grantError}` };
    return { skipped: true, reason: 'content already drafted / records already removed concurrently', grantRemoved };
  }

  const removals = [
    indexRemoved ? 'the members-index entry' : null,
    grantRemoved ? 'the grandfather grant (KV)' : null,
  ].filter(Boolean);
  const pull = await github.createPull({
    title: `erase: draft ${username ?? `github_id ${id}`} content + remove house records`,
    head: branch,
    base,
    body:
      `Automated SOW-024 right-to-erasure for github_id ${id}: flips ${flipped} file(s) -> draft` +
      `${removals.length ? ` and removes ${removals.join(' and ')}` : ''}. Reversible; git history persists ` +
      '(disclosed in the TOS).',
  });
  await github.mergePull(pull.number, { method: 'squash' });
  // Surface a grant-removal error even alongside a successful content PR: the erasure is not fully done if the
  // grant could not be removed from KV.
  if (grantError) return { pr: pull.number, flipped, indexRemoved, grantRemoved, grantError };
  return { pr: pull.number, flipped, indexRemoved, grantRemoved };
}
