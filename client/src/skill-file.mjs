// sow-109 Phase 5: a skill's own file, SKILL.md beside its index.md, travels with every publish. Node-free and pure, so
// the website publisher (src/lib/workbench-client.ts) and the npm / agent publisher (operations-publish.mjs) decide the
// same writes and deletes, and the tests exercise the decision rather than two copies of it.
//
// The rules mirror the content check (scripts/validate-content.mjs checkSkillFile), so a publish the client lets
// through is one the check accepts:
//   - a PUBLIC skill has a SKILL.md with a usable `name:` line;
//   - a MEMBERS-ONLY skill never carries a plaintext one (it would be readable by anyone in the repository). Since
//     Phase 7 its file is ENCRYPTED instead, beside its body, as `_enc/prompt-<slug>-skillfile.enc` (encSkillAssetFor),
//     and index.md points at it with `encryptedSkill`. The Worker holds the key, exactly as for a members-only body;
//   - a PROMPT has neither.
import { skillNameFrom } from '../../membership/skill-install.mjs';
import { encSkillAssetFor } from './member-content.mjs';

/** The SKILL.md path beside an item's index.md. */
export const skillPathFor = (indexPath) => String(indexPath || '').replace(/index\.md$/, 'SKILL.md');

/**
 * Whether a publish must read the item's current plaintext SKILL.md first: only when the item was a skill AND the file
 * has to move (a rename or an author move), go (it stops being a skill), or be encrypted (the skill is becoming
 * members-only). A plain edit of a public skill overwrites or keeps it without looking.
 */
export const needsOldSkillFile = ({ priorKind, kind, moved, visibility }) =>
  priorKind === 'skill' && (Boolean(moved) || kind !== 'skill' || visibility === 'members');

const NEEDS_FILE = 'A skill needs its skill file. Paste the whole SKILL.md into "The skill file".';
const NEEDS_NAME = 'The skill file needs a name: line in its frontmatter (lowercase letters, digits and dashes, for example name: farley). The install steps use it for the folder and the command.';
export const PUBLIC_NEEDS_FILE = 'To make a members-only skill public, send its skill file with the change, so it can be published as plain text.';

/**
 * The skill-file writes and deletes a publish makes, the file it must encrypt, or the reason it must refuse.
 *
 * @param {object} a
 * @param {string} a.kind           the kind being published ('prompt' | 'skill')
 * @param {string} [a.visibility]   'public' | 'members'
 * @param {string} [a.skillFile]    the skill file text the author sent; empty or absent means "not sent"
 * @param {string} a.newIndexPath   where the item's index.md is being written
 * @param {string|null} [a.oldIndexPath]  where it was, for an edit (equal to newIndexPath unless it moved)
 * @param {string} [a.priorKind]    the kind the item had before this publish
 * @param {string|null} [a.oldSkillText]  its current plaintext SKILL.md, read when needsOldSkillFile says so; null if none
 * @param {string|null} [a.oldEncPath]    its current `encryptedSkill` pointer, if it had one
 * @param {string|null} [a.oldEncText]    that envelope's raw text, read only for a move that sends no new file
 * @returns {{ files: Array<{ path: string, content: string | null }>, refusal: string | null,
 *             encrypt: { text: string, assetId: string, path: string } | null, pointer: string | null }}
 *   `pointer` is the `encryptedSkill` value index.md must carry after this publish (null: none).
 */
export function planSkillFile({ kind, visibility, skillFile, newIndexPath, oldIndexPath = null, priorKind, oldSkillText = null, oldEncPath = null, oldEncText = null }) {
  const files = [];
  const out = (extra = {}) => ({ files, refusal: null, encrypt: null, pointer: null, ...extra });
  const refuse = (refusal) => ({ files: [], refusal, encrypt: null, pointer: null });
  const newPath = skillPathFor(newIndexPath);
  const oldPath = oldIndexPath ? skillPathFor(oldIndexPath) : null;
  const moved = Boolean(oldPath) && oldPath !== newPath;
  const sent = typeof skillFile === 'string' && skillFile.trim() ? skillFile : null;
  const dropOldEnc = (unless) => { if (oldEncPath && oldEncPath !== unless) files.push({ path: oldEncPath, content: null }); };

  if (kind !== 'skill') {
    // No longer a skill (or never was): its file goes, from wherever it was, plain or encrypted.
    if (oldSkillText != null) files.push({ path: oldPath ?? newPath, content: null });
    dropOldEnc(null);
    return out();
  }

  if (visibility === 'members') {
    const enc = encSkillAssetFor(newIndexPath);
    if (!enc) return refuse('This item cannot carry an encrypted skill file.');
    // The text to encrypt: what the author sent, else a plaintext file the item already had (it is going private).
    const text = sent ?? oldSkillText;
    if (text != null) {
      if (!skillNameFrom(text)) return refuse(NEEDS_NAME);
      if (oldSkillText != null) files.push({ path: oldPath ?? newPath, content: null }); // never left behind in plain text
      dropOldEnc(enc.path);
      return out({ encrypt: { text, assetId: enc.assetId, path: enc.path }, pointer: enc.path });
    }
    if (oldEncPath) {
      if (oldEncPath === enc.path) return out({ pointer: enc.path }); // a plain edit keeps the encrypted file
      // A move: the envelope moves byte for byte (it decrypts anywhere; nothing checks its asset id against the path).
      if (oldEncText == null) return refuse('The encrypted skill file could not be read to move it. Nothing was published; try again.');
      files.push({ path: enc.path, content: oldEncText }, { path: oldEncPath, content: null });
      return out({ pointer: enc.path });
    }
    return out(); // a members-only skill without a file: its page shows the body only
  }

  // Public. A skill keeps the plaintext file it already has when nothing new was sent and it is not moving.
  if (!sent && oldEncPath) return refuse(PUBLIC_NEEDS_FILE);
  const text = sent ?? (moved ? oldSkillText : null);
  const keepsExisting = !sent && !moved && priorKind === 'skill';
  if (text == null && !keepsExisting) return refuse(NEEDS_FILE);
  if (text != null) {
    if (!skillNameFrom(text)) return refuse(NEEDS_NAME);
    files.push({ path: newPath, content: text });
  }
  if (moved && oldSkillText != null) files.push({ path: oldPath, content: null });
  dropOldEnc(null); // it went public: the encrypted copy goes
  return out();
}

/**
 * The publish-time step both publishers run: read what the plan needs, plan, and encrypt through the Worker when it
 * says so. `readFile(path)` answers the committed text or null; `encrypt(plaintext, assetId)` returns the envelope and
 * throws MemberContentLockedError for a caller who is not paid (the publisher turns that into its upgrade message).
 * Returns { files, refusal, pointer }; the caller throws its own error type on a refusal and writes `pointer` into
 * index.md as `encryptedSkill`. Anything but a prompt has no skill file.
 */
export async function skillFilesForPublish({ type, built, oldIndexPath = null, priorKind, priorEncryptedSkill = null, moved = false, skillFile, readFile, encrypt }) {
  if (type !== 'prompt') return { files: [], refusal: null, pointer: null };
  const kind = built?.frontmatter?.kind;
  const visibility = built?.frontmatter?.visibility;
  const read = async (p) => { try { return (await readFile(p)) ?? null; } catch { return null; } };
  const oldEncPath = typeof priorEncryptedSkill === 'string' && priorEncryptedSkill ? priorEncryptedSkill : null;
  const oldSkillText = oldIndexPath && needsOldSkillFile({ priorKind, kind, moved, visibility }) ? await read(skillPathFor(oldIndexPath)) : null;
  const sent = typeof skillFile === 'string' && skillFile.trim();
  const newEnc = encSkillAssetFor(built?.path);
  const oldEncText = oldEncPath && !sent && kind === 'skill' && visibility === 'members' && newEnc && newEnc.path !== oldEncPath ? await read(oldEncPath) : null;
  const plan = planSkillFile({ kind, visibility, skillFile, newIndexPath: built.path, oldIndexPath, priorKind, oldSkillText, oldEncPath, oldEncText });
  if (plan.refusal) return { files: [], refusal: plan.refusal, pointer: null };
  const files = [...plan.files];
  if (plan.encrypt) {
    const envelope = await encrypt(plan.encrypt.text, plan.encrypt.assetId);
    files.push({ path: plan.encrypt.path, content: JSON.stringify(envelope) });
  }
  return { files, refusal: null, pointer: plan.pointer };
}

/**
 * `{ skillFile }` read from beside a skill's index.md, for an editor opening it; `{}` for anything else or no file. A
 * members-only skill's file is decrypted through `decrypt(encPath)` (the Worker; paid members only), when the host
 * supplies one; a failed decrypt answers `{}`, which a later publish treats as "keep the file it has".
 */
export async function skillFileBeside(indexPath, frontmatter, readFile, decrypt) {
  if (frontmatter?.kind !== 'skill' || !/\/prompts\/[^/]+\/index\.md$/.test(String(indexPath || ''))) return {};
  let text = null;
  if (typeof frontmatter?.encryptedSkill === 'string' && frontmatter.encryptedSkill) {
    if (typeof decrypt !== 'function') return {};
    try { text = (await decrypt(frontmatter.encryptedSkill)) ?? null; } catch { text = null; }
  } else {
    try { text = (await readFile(skillPathFor(indexPath))) ?? null; } catch { text = null; }
  }
  return text == null ? {} : { skillFile: text };
}
