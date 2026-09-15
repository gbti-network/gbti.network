// sow-323 Phase 3: what APPROVING an item writes. Pure: the caller reads the files, decrypts the members-only body
// with the Worker-held key, calls this, and commits what comes back.
//
// Approval is a change of AUDIENCE, and nothing else. Three things it must not do, each of which is a real defect
// the WorkBench "Make this public" control had:
//   1. it must not leave the locked-page flag beside `visibility: public` (scripts/validate-content.mjs refuses the
//      two together, and the merge gate does not wait for that check, so it would merge and turn main red);
//   2. it must not leave the encrypted body file behind, orphaned, when the whole item becomes public;
//   3. it must not restamp the dates. The owner ruled on 2026-09-12 that an approved item keeps its original date
//      in the feed, so `publishedAt` and `updatedAt` are carried through untouched.
//
// A SECTION THE AUTHOR MARKED MEMBERS-ONLY STAYS MEMBERS-ONLY. Approval reassembles the body the author wrote: for
// an item gated whole there is no marker and everything becomes public; for one with a teaser, the marker comes
// back with it, so the item becomes a public page with a members-only section (SOW-016 Mode C) and its ciphertext
// is rewritten rather than deleted.
import { MEMBER_MARKER, splitMemberMarkdown } from '../client/src/member-content.mjs';

/**
 * The author's body as they wrote it, from the stored public part and the decrypted members-only part. Mirrors
 * reassembleMemberBody in src/lib/workbench-client-core.mjs, which the editor uses for the same question.
 */
export function authoredBody(frontmatter, indexBody, memberText) {
  const gated = String(memberText ?? '');
  const pub = String(indexBody ?? '').trim();
  if (!gated) return pub;
  if ((frontmatter?.visibility ?? 'public') === 'members' && !pub) return gated; // gated whole: no teaser to restore
  return pub ? `${pub}\n\n${MEMBER_MARKER}\n\n${gated}` : `${MEMBER_MARKER}\n\n${gated}`;
}

/**
 * Plan the approval of one item.
 *
 * @param frontmatter the item's stored frontmatter
 * @param indexBody   the body stored in index.md (a teaser, or the whole body for a public item)
 * @param memberText  the decrypted members-only body, or '' when the item has none
 * @returns { frontmatter, body, gated, encPath, removeEnc, alreadyPublic }
 *          `gated` is the section to re-encrypt (null when there is none), `encPath` where its ciphertext lives,
 *          and `removeEnc` true when the old ciphertext must be deleted.
 */
export function planApproval({ frontmatter = {}, indexBody = '', memberText = '' } = {}) {
  const fm = { ...frontmatter };
  const encPath = typeof fm.encryptedBody === 'string' && fm.encryptedBody ? fm.encryptedBody : null;
  if ((fm.visibility ?? 'public') === 'public') {
    return { frontmatter: fm, body: String(indexBody ?? ''), gated: null, encPath, removeEnc: false, alreadyPublic: true };
  }
  const whole = authoredBody(frontmatter, indexBody, memberText);
  const { publicPart, memberPart } = splitMemberMarkdown(whole);
  fm.visibility = 'public';
  delete fm.publicStub; // never beside public: the content check refuses the pair
  if (memberPart) {
    fm.encryptedBody = encPath; // the section stays gated, and its ciphertext is rewritten in place
    return { frontmatter: fm, body: publicPart, gated: memberPart, encPath, removeEnc: false, alreadyPublic: false };
  }
  delete fm.encryptedBody;
  return { frontmatter: fm, body: publicPart, gated: null, encPath, removeEnc: !!encPath, alreadyPublic: false };
}
