// sow-109 Phase 5: a skill's own file, SKILL.md beside its index.md, travels with every publish. Node-free and pure, so
// the website publisher (src/lib/workbench-client.ts) and the npm / agent publisher (operations-publish.mjs) decide the
// same writes and deletes, and the tests exercise the decision rather than two copies of it.
//
// The rules mirror the content check (scripts/validate-content.mjs checkSkillFile), so a publish the client lets
// through is one the check accepts:
//   - a PUBLIC skill has a SKILL.md with a usable `name:` line;
//   - a MEMBERS-ONLY item never carries a plaintext one (its file would be readable by anyone in the repository);
//   - a PROMPT has none.
import { skillNameFrom } from '../../membership/skill-install.mjs';

/** The SKILL.md path beside an item's index.md. */
export const skillPathFor = (indexPath) => String(indexPath || '').replace(/index\.md$/, 'SKILL.md');

/**
 * Whether a publish must read the item's current SKILL.md first: only when the item was a skill AND the file has to
 * move (a rename or an author move), go (it stops being a skill), or be checked (the skill is becoming members-only,
 * which cannot carry a plaintext file). A plain edit of a public skill overwrites or keeps it without looking.
 */
export const needsOldSkillFile = ({ priorKind, kind, moved, visibility }) =>
  priorKind === 'skill' && (Boolean(moved) || kind !== 'skill' || visibility === 'members');

// Until members-only skill files are encrypted (sow-109 Phase 7), the only honest advice covers both kinds of author: a
// regular member cannot choose public (a superadmin decides that, sow-323), so "make it public" alone would strand them.
export const MEMBERS_REFUSAL = 'A members-only skill cannot carry a skill file yet, because the file would be readable by anyone. For now, leave the skill file empty and include it in the page text, or ask a superadmin to make the skill public.';

/**
 * The SKILL.md writes and deletes a publish makes, or the reason it must refuse.
 *
 * @param {object} a
 * @param {string} a.kind           the kind being published ('prompt' | 'skill')
 * @param {string} [a.visibility]   'public' | 'members'
 * @param {string} [a.skillFile]    the skill file text the author sent; empty or absent means "not sent"
 * @param {string} a.newIndexPath   where the item's index.md is being written
 * @param {string|null} [a.oldIndexPath]  where it was, for an edit (equal to newIndexPath unless it moved)
 * @param {string} [a.priorKind]    the kind the item had before this publish
 * @param {string|null} [a.oldSkillText]  its current SKILL.md, read when needsOldSkillFile says so; null if none
 * @returns {{ files: Array<{ path: string, content: string | null }>, refusal: string | null }}
 */
export function planSkillFile({ kind, visibility, skillFile, newIndexPath, oldIndexPath = null, priorKind, oldSkillText = null }) {
  const files = [];
  const newPath = skillPathFor(newIndexPath);
  const oldPath = oldIndexPath ? skillPathFor(oldIndexPath) : null;
  const moved = Boolean(oldPath) && oldPath !== newPath;
  const sent = typeof skillFile === 'string' && skillFile.trim() ? skillFile : null;

  if (kind !== 'skill') {
    // No longer a skill (or never was): its file goes, from wherever it was.
    if (oldSkillText != null) files.push({ path: oldPath ?? newPath, content: null });
    return { files, refusal: null };
  }

  // A skill keeps the file it already has when nothing new was sent and it is not moving.
  const text = sent ?? (moved ? oldSkillText : null);
  const keepsExisting = !sent && !moved && priorKind === 'skill';
  if (visibility === 'members') {
    // A plaintext SKILL.md beside a members-only item would publish the file its page locks, so the check refuses it.
    // Refused rather than deleted, so switching a skill to members-only never throws its file away.
    if (sent || oldSkillText != null) return { files: [], refusal: MEMBERS_REFUSAL };
    return { files, refusal: null };
  }
  if (text == null && !keepsExisting) {
    return { files: [], refusal: 'A skill needs its skill file. Paste the whole SKILL.md into "The skill file".' };
  }
  if (text != null) {
    if (!skillNameFrom(text)) {
      return { files: [], refusal: 'The skill file needs a name: line in its frontmatter (lowercase letters, digits and dashes, for example name: farley). The install steps use it for the folder and the command.' };
    }
    files.push({ path: newPath, content: text });
  }
  if (moved && oldSkillText != null) files.push({ path: oldPath, content: null });
  return { files, refusal: null };
}

/**
 * The publish-time step both publishers run: read the item's current SKILL.md only when the plan needs it, then plan.
 * `readFile(path)` answers the committed text or null. Returns planSkillFile's { files, refusal }; the caller throws
 * its own error type on a refusal. Anything but a prompt has no skill file.
 */
export async function skillFilesForPublish({ type, built, oldIndexPath = null, priorKind, moved = false, skillFile, readFile }) {
  if (type !== 'prompt') return { files: [], refusal: null };
  const kind = built?.frontmatter?.kind;
  const visibility = built?.frontmatter?.visibility;
  let oldSkillText = null;
  if (oldIndexPath && needsOldSkillFile({ priorKind, kind, moved, visibility })) {
    try { oldSkillText = (await readFile(skillPathFor(oldIndexPath))) ?? null; } catch { oldSkillText = null; }
  }
  return planSkillFile({ kind, visibility, skillFile, newIndexPath: built.path, oldIndexPath, priorKind, oldSkillText });
}

/** `{ skillFile }` read from beside a skill's index.md, for an editor opening it; `{}` for anything else or no file. */
export async function skillFileBeside(indexPath, frontmatter, readFile) {
  if (frontmatter?.kind !== 'skill' || !/\/prompts\/[^/]+\/index\.md$/.test(String(indexPath || ''))) return {};
  let text = null;
  try { text = (await readFile(skillPathFor(indexPath))) ?? null; } catch { text = null; }
  return text == null ? {} : { skillFile: text };
}
