// sow-213 Phase 2b + 2c: the KV half of the governance dual-write, and the private moderation log.
//
// THE TRANSITION. Through Phase 2 a ban or grandfather grant lands in BOTH git and KV (owner ruling
// 2026-08-24). Git stays complete and authoritative, so rollback is "stop writing the KV half" with nothing to
// reconstruct. The git half is the safety net, which is why it is dual-written here and must NOT be for
// coupon codes (sow-291), where the git copy is the exposure rather than the net. Same pattern, opposite
// disposition, decided by what the git copy IS.
//
// Every rule below exists because of a specific way this write could go wrong quietly:
//
//   NEVER FABRICATE A MIRROR. If overrides:mirror is absent, unreadable or malformed, this refuses. Creating
//   one would mint a blob containing a single ban and a fresh generatedAt, which every reader would then
//   trust as a complete override set. An absent mirror already fails closed for the six readers; a fabricated
//   one fails OPEN for everyone missing from it.
//
//   NEVER TOUCH generatedAt. It is the freshness signal that the scheduled git-to-KV sync is alive, and six
//   read sites fail closed on it past 48 hours. If an admin action refreshed it, a dead sync would look
//   healthy for as long as admins kept working, which is the one failure the staleness gate exists to catch.
//   A stale mirror stays stale here, and the ban still lands in git.
//
//   MARK EVERY ENTRY source: 'kv'. kv-mirror.mergeOverridesSection preserves entries carrying that mark, so
//   the 6-hourly sync can add and update git-sourced entries but can never delete a KV-native one. Without
//   the mark, a ban written here would appear to work and then vanish within six hours, in the permissive
//   direction, with nothing reporting it.
//
//   A REMOVAL DROPS ONLY THE KV-NATIVE COPY. The git-sourced copy leaves the mirror when the git PR merges
//   and the next sync runs. Deleting it here would be undone by that same sync, so it would read as working
//   and silently revert.

import { OVERRIDES_KV_KEY } from './membership-content.mjs';

export { OVERRIDES_KV_KEY };
export const MODLOG_PREFIX = 'modlog:';
export const KV_SOURCE = 'kv';

/** The mirror sections this module may touch. `roles` is deliberately absent: roles.yml stays git-native by
 *  owner ruling as the root of trust for the anti-escalation model, so it has no KV half to write. */
export const OVERRIDE_SECTIONS = Object.freeze(['bans', 'grandfathered']);

const isSection = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const idOf = (e) => (e && e.github_id != null ? String(e.github_id) : null);

/**
 * PURE. Apply one governance entry to the mirror blob and return the new blob.
 * Returns { ok, next, changed, reason }. `ok:false` means the mirror is not in a state this may safely edit,
 * and the caller must NOT write anything.
 */
export function applyKvOverride(mirror, { section, githubId, entry = null, remove = false } = {}) {
  if (!OVERRIDE_SECTIONS.includes(section)) return { ok: false, reason: `unknown override section: ${section}` };
  const id = githubId != null ? String(githubId) : '';
  if (!id) return { ok: false, reason: 'githubId is required' };
  // Refuse rather than fabricate. Each of these is a real runtime state once KV is a live writer target.
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

/**
 * The IO half: read overrides:mirror, apply, write it back. Fails closed and never fabricates.
 * Returns { written, changed, reason }. A false `written` is NOT an error the caller should throw on: the git
 * half has already landed, so the ban is real and simply reaches KV at the next scheduled sync instead of now.
 * It must be REPORTED rather than swallowed, because it silently reopens the window this phase closes.
 */
export async function writeOverrideToKv({ kv, section, githubId, entry = null, remove = false } = {}) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    return { written: false, changed: false, reason: 'no KV binding' };
  }
  let mirror = null;
  try {
    mirror = await kv.get(OVERRIDES_KV_KEY, 'json');
  } catch (err) {
    // "We could not read the mirror" must never resolve to "the mirror is empty": that reading would drop
    // every existing ban on the next write.
    return { written: false, changed: false, reason: `could not read the overrides mirror (${err?.message || 'unknown'})` };
  }
  const applied = applyKvOverride(mirror, { section, githubId, entry, remove });
  if (!applied.ok) return { written: false, changed: false, reason: applied.reason };
  if (!applied.changed) return { written: false, changed: false, reason: 'already in that state in KV' };
  try {
    await kv.put(OVERRIDES_KV_KEY, JSON.stringify(applied.next));
  } catch (err) {
    return { written: false, changed: false, reason: `could not write the overrides mirror (${err?.message || 'unknown'})` };
  }
  return { written: true, changed: true, reason: null };
}

/**
 * sow-213 Phase 2c: the private moderation log.
 *
 * Owner decision 2026-08-27: this is built in the SAME pass as the writer inversion, so no window exists in
 * which a ban is enacted with no record of who did it and why. The ban REASON is retained here and is never
 * surfaced publicly, which is the whole point of moving these records off the public chain: the action stays
 * accountable to staff without the person's ban becoming a permanent public fact.
 *
 * APPEND-ONLY AS A PROPERTY, NOT A CONVENTION. The key carries the target, the timestamp and the actor, and a
 * collision is resolved by suffixing rather than by overwriting, so no write can erase an earlier record even
 * if two actions land in the same millisecond.
 */
export function moderationLogKey({ targetId, at, actorId, seq = 0 }) {
  const base = `${MODLOG_PREFIX}${targetId}:${at}:${actorId ?? 'unknown'}`;
  return seq > 0 ? `${base}:${seq}` : base;
}

export async function appendModerationLog({ kv, audit, maxProbe = 8 } = {}) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    return { written: false, key: null, reason: 'no KV binding' };
  }
  const targetId = audit?.target?.github_id;
  const at = audit?.at;
  if (!targetId || !at) return { written: false, key: null, reason: 'the audit entry has no target or timestamp' };
  const actorId = audit?.actor?.github_id ?? null;
  try {
    for (let seq = 0; seq < maxProbe; seq += 1) {
      const key = moderationLogKey({ targetId, at, actorId, seq });
      const existing = await kv.get(key);
      if (existing != null) continue; // never overwrite an existing record
      await kv.put(key, JSON.stringify(audit));
      return { written: true, key, reason: null };
    }
    return { written: false, key: null, reason: 'could not find a free moderation-log key' };
  } catch (err) {
    return { written: false, key: null, reason: `moderation log write failed (${err?.message || 'unknown'})` };
  }
}
