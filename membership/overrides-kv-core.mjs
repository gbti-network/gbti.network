// sow-213 Step 3: the PURE overrides-mirror mutation core, shared by every writer of the KV override store.
//
// Extracted from workers/signup/membership-override-kv.mjs so the two IO halves reuse ONE mutation semantics:
//   - the Worker binding half (writeOverrideToKv, in membership-override-kv.mjs) for W1/W2 (the hosted admin path)
//   - the Cloudflare REST half (writeOverrideToKvRest, in scripts/lib/kv-mirror.mjs) for W3/W4 (reconcile + the
//     manual erase-member CLI), which run outside the Worker and cannot bind SIGNUP_KV directly.
// A single mutation core is the point: a ban applied from reconcile and the same ban applied from the Worker
// must mark, keep and remove entries identically, or the two paths would drift in the permissive direction.
//
// This file has NO imports on purpose. membership-override-kv.mjs pulls in membership-content.mjs (Stripe,
// crypto, oauth) for one constant, so importing the mutation from there into a script would drag that whole
// graph into reconcile. The pure core carries no such cost and cannot form a cycle.
//
// THE ONE RULE THAT MAKES THE STORE SAFE: MARK EVERY WRITTEN ENTRY source: 'kv'. kv-mirror.mergeOverridesSection
// preserves entries carrying that mark, so the 6-hourly git-to-KV sync can add and update git-sourced entries
// but can never delete a KV-native one. And REMOVE below drops ONLY marked entries, so an UNMARKED entry
// survives a removal permanently: post-migration that is exactly where an unban silently no-ops on a member.
// The mark is the whole mechanism; nobody has to remember a discipline.

export const KV_SOURCE = 'kv';

/** The mirror sections this core may touch. `roles` is deliberately absent: roles.yml stays git-native by owner
 *  ruling as the root of trust for the anti-escalation model, so it has no KV half to write. */
export const OVERRIDE_SECTIONS = Object.freeze(['bans', 'grandfathered']);

const isSection = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const idOf = (e) => (e && e.github_id != null ? String(e.github_id) : null);

/**
 * PURE. Apply one governance entry to the mirror blob and return the new blob.
 * Returns { ok, next, changed, reason }. `ok:false` means the mirror is not in a state this may safely edit,
 * and the caller must NOT write anything (each of these is a real runtime state once KV is a live writer target;
 * fabricating a mirror would fail OPEN for everyone missing from it).
 *
 * A REMOVE drops ONLY the KV-native copy (source: 'kv'). A git-sourced copy leaves the mirror when the git PR
 * merges and the next sync runs, so deleting it here would be undone by that sync and read as working while
 * silently reverting. Once the git files are gone (sow-213 Step 3), every carried entry is marked source: 'kv'
 * by the preserve-mark in kv-mirror.sectionFor, so REMOVE reaches them.
 */
export function applyKvOverride(mirror, { section, githubId, entry = null, remove = false } = {}) {
  if (!OVERRIDE_SECTIONS.includes(section)) return { ok: false, reason: `unknown override section: ${section}` };
  const id = githubId != null ? String(githubId) : '';
  if (!id) return { ok: false, reason: 'githubId is required' };
  // Refuse rather than fabricate.
  if (!isSection(mirror)) return { ok: false, reason: 'the overrides mirror is absent or not an object' };
  if (!mirror.generatedAt) return { ok: false, reason: 'the overrides mirror has no generatedAt' };
  if (!isSection(mirror[section])) return { ok: false, reason: `the overrides mirror has no ${section} section` };

  const list = Array.isArray(mirror[section][section]) ? mirror[section][section] : [];
  const kept = list.filter((e) => !(idOf(e) === id && e?.source === KV_SOURCE));
  let nextList;
  if (remove) {
    nextList = kept;
  } else {
    if (!entry) return { ok: false, reason: 'an entry is required unless removing' };
    nextList = [...kept, { ...entry, github_id: id, source: KV_SOURCE }];
  }
  const changed = JSON.stringify(nextList) !== JSON.stringify(list);
  // Spread the mirror and the section so generatedAt, roles and any unknown field pass through untouched.
  const next = { ...mirror, [section]: { ...mirror[section], [section]: nextList } };
  return { ok: true, next, changed, reason: null };
}
