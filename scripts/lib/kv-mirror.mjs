// SOW-015: mirror the git-native override files (bans / roles / grandfathered) into the signup Worker's
// SIGNUP_KV namespace, so GET /membership/key can apply ban > staff > grandfather SERVER-SIDE (it cannot read
// the repo at request time, and it must not trust the client to apply the ban). The reconcile calls this on
// each --apply run; the Worker reads the blob (overrides:mirror) and fails closed if it is missing or stale.
//
// Writes via the Cloudflare KV REST API, gated behind CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN. If
// those are not set (local dry-runs, tests), it is a no-op that reports the reason. Injected fetch for tests.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { toSyndicationMirror } from '../../membership/syndication-config.mjs';
import { toTopicsMirror, TOPICS_MIRROR_KEY } from '../../membership/topics-vocab.mjs';
import { toCouponsMirror, COUPONS_MIRROR_KEY } from '../../membership/coupons.mjs';

export const OVERRIDES_KV_KEY = 'overrides:mirror';
export const SYNDICATION_KV_KEY = 'synd:config';
export const CONTENT_CHANNELS_KV_KEY = 'synd:channels'; // SOW-087: house/content-channels.yml
export const TOPICS_KV_KEY = TOPICS_MIRROR_KEY; // SOW-087: house/topics.yml (the share category suggester)
export const COUPONS_KV_KEY = COUPONS_MIRROR_KEY; // SOW-119: house/coupons.yml (signup coupon validation)

/**
 * sow-213 Phase 2: KV-NATIVE ENTRIES SURVIVE THE SYNC.
 *
 * `buildOverridesMirror` used to rebuild the whole blob from git (`bans: raw?.bans ?? {}`), which is correct
 * only while git is the sole writer. The moment an admin action writes a ban straight to KV, the next run of
 * the 6-hourly cron ERASES IT: the ban appears to work, then quietly stops within six hours, silently and in
 * the permissive direction, with nothing reporting it. Inverting the writers before fixing this would have
 * been the most dangerous ordering in the whole migration, and it is also the obvious order to do it in,
 * which is exactly what makes it worth stating out loud.
 *
 * The fix is a PROPERTY RATHER THAN A DISCIPLINE: an entry marked `source: 'kv'` is preserved, so this writer
 * can add and update git-sourced entries but can never delete a KV-native one. Nobody has to remember a rule.
 *
 * A section is the PARSED YAML FILE OBJECT ({ bans: [...] }), not a bare array: the Worker passes it straight
 * to bansFromParsed and rejects anything that is not an object (membership-content.mjs isSection). Returning
 * the git section UNCHANGED when there is nothing KV-native to keep preserves the existing `{}` default for a
 * missing file exactly as before.
 *
 * AFTER PHASE 3 THIS MERGE IS DEAD CODE. Once the git files are gone, `raw.bans` and `raw.grandfathered` are
 * always empty and this writer should stop touching those fields entirely, leaving only `roles`, which stays
 * git-native by owner ruling as the root of trust for the anti-escalation model. Delete it then, rather than
 * leaving a merge that silently does nothing and still reads as load-bearing.
 */
const isSection = (x) => x != null && typeof x === 'object' && !Array.isArray(x);

/**
 * sow-213 Phase 3: which override sections GIT still owns, read from the real checkout.
 *
 * This is derived rather than configured on purpose. The flip is "delete two files", and anything that also
 * required someone to remember to change a flag would eventually be done half way, in the direction that
 * erases live entitlements.
 */
export function gitOwnedSections(root) {
  const has = (f) => fs.existsSync(path.join(root, 'house', f));
  return { bans: has('bans.yml'), grandfathered: has('grandfathered.yml') };
}

/**
 * sow-213 Phase 3: THE SECTION GIT NO LONGER OWNS IS PRESERVED VERBATIM, NOT REBUILT.
 *
 * `readYaml` returns {} for a missing file, so once bans.yml and grandfathered.yml are deleted, `raw.bans` and
 * `raw.grandfathered` are indistinguishable from "the file exists and is empty". Rebuilding from that would
 * write an EMPTY section over the live one, erasing every ban and grandfather grant in the store, with a green
 * workflow run and nothing reporting it. The 25 entries live there today carry no `source: 'kv'` mark (they
 * came from git), so mergeOverridesSection would not save them either.
 *
 * And a one-time migration marking them `source: 'kv'` does NOT work, which is worth recording because it is
 * the obvious move: while the files still exist, the next sync filters those entries back out as duplicates of
 * the git entries and rewrites the unmarked git version. The migration is undone before it is ever used.
 *
 * So the rule is a property. If git does not own the section, KV is the source and this writer does not touch
 * it. If there is nothing usable to preserve, the whole write ABORTS, because writing an empty section is the
 * exact erase this exists to prevent.
 *
 * What an abort costs, stated precisely rather than waved at: the blob stops being refreshed, so a transient
 * one is absorbed by the Worker's 48h freshness window and a PERSISTENT one ages the blob out and denies every
 * effective-paid member, superadmins included. That is the safe direction and it is LOUD (the 6-hourly job
 * exits non-zero, so it reds four times a day), which is the whole difference from the alternative: an erase
 * that lifts every ban and strips every grant on a GREEN run with nobody watching.
 */
function sectionFor(ownedByGit, gitSection, existingSection, listKey) {
  if (ownedByGit) return mergeOverridesSection(gitSection, existingSection, listKey);
  if (!isSection(existingSection) || !Array.isArray(existingSection[listKey])) {
    throw new Error(`refusing to write the overrides mirror: house/${listKey === 'bans' ? 'bans' : 'grandfathered'}.yml is absent and KV carries no usable ${listKey} section to preserve`);
  }
  return existingSection;
}

export function mergeOverridesSection(gitSection, existingSection, listKey) {
  const base = isSection(gitSection) ? gitSection : {};
  const git = Array.isArray(base[listKey]) ? base[listKey] : [];
  const existing = isSection(existingSection) && Array.isArray(existingSection[listKey]) ? existingSection[listKey] : [];
  const idOf = (e) => (e && e.github_id != null ? String(e.github_id) : null);
  const gitIds = new Set(git.map(idOf).filter(Boolean));
  // Preserve every KV-native entry git does not already carry. Anything NOT marked `source: 'kv'` is treated
  // as a stale copy of a git entry and dropped, which is what keeps a REMOVAL in git effective: unbanning
  // someone in git must still unban them, or this fix would trade one silent failure for another.
  const kvNative = existing.filter((e) => e?.source === 'kv' && idOf(e) && !gitIds.has(idOf(e)));
  if (kvNative.length === 0) return base;
  return { ...base, [listKey]: [...git, ...kvNative] };
}

/** Build the compact mirror blob the Worker reads. Stores the RAW parsed YAML (the Worker rebuilds Maps).
 *  `existing` is the blob currently in KV; pass it so KV-native entries are not clobbered (see above). */
export function buildOverridesMirror(raw, now = new Date(), existing = null, ownedByGit) {
  // sow-213 R9: `ownedByGit` is REQUIRED, and it used to DEFAULT to `{ bans: true, grandfathered: true }`. That
  // default IS the rebuild-from-git = ERASE direction, reachable by OMISSION: post-deletion a caller that forgot
  // the argument would rebuild bans/grandfathered from empty git and drop every KV-native entry, silently and on
  // a green run. Omission is exactly how silent data loss happens, so the fix makes it IMPOSSIBLE (a throw)
  // rather than improbable (a safe default that someone must remember). Every writer passes a REALITY-DERIVED
  // value via `gitOwnedSections(root)`; the no-write byte-count/dry-run paths pass an EXPLICIT
  // `{ bans: true, grandfathered: true }` to report the git-owned shape (safe: they write nothing, and git-owned
  // never throws, it just yields empty sections once the files are gone). The per-key `!== false` convention is
  // kept, so a partial `{ bans: false }` still means grandfathered stays git-owned.
  if (ownedByGit == null || typeof ownedByGit !== 'object') {
    throw new Error('buildOverridesMirror: ownedByGit is required (reality-derived via gitOwnedSections(root)); omitting it would rebuild bans/grandfathered from git and, once the files are deleted, erase every KV-native entry');
  }
  return {
    generatedAt: now.toISOString(),
    roles: raw?.roles ?? {}, // roles.yml stays git-native by owner ruling, so this section is always rebuilt
    bans: sectionFor(ownedByGit.bans !== false, raw?.bans ?? {}, existing?.bans, 'bans'),
    grandfathered: sectionFor(ownedByGit.grandfathered !== false, raw?.grandfathered ?? {}, existing?.grandfathered, 'grandfathered'),
  };
}

/**
 * PUT the mirror to Cloudflare KV. Returns { written, key, bytes, reason }. Throws only on a real API error
 * (so the reconcile can fail the run); a missing-credentials situation is a reported no-op, not a throw.
 */
export async function mirrorOverridesToKv({ raw, env = process.env, now = new Date(), fetchImpl = globalThis.fetch, key = OVERRIDES_KV_KEY, ownedByGit } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    // sow-213 R9: byte-count for the no-op report only, this path WRITES NOTHING. Pass explicit git-owned so it
    // reports the git-owned shape and never throws (a reality-derived value with no `existing` to preserve would
    // abort); once the files are gone the git shape is honestly empty. The real write below uses `ownedByGit`.
    const noop = JSON.stringify(buildOverridesMirror(raw, now, null, { bans: true, grandfathered: true }));
    return { written: false, key, bytes: noop.length, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;

  // sow-213 Phase 2: READ BEFORE WRITE, so the merge above has something to preserve. A read failure ABORTS
  // the write rather than falling back to a git-only blob: proceeding blind is precisely the erase this change
  // exists to prevent, and "we could not read the current bans" must never resolve to "overwrite them". A
  // SKIPPED sync is harmless, because the Worker's 48h freshness window absorbs it and then fails closed. A
  // blind overwrite is not harmless, because it looks like success.
  let existing = null;
  try {
    const cur = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiToken}` } });
    if (cur?.ok) existing = await cur.json();
    else if (cur && cur.status !== 404) throw new Error(`status ${cur.status}`); // 404 is the legitimate first write
  } catch (err) {
    throw new Error(`KV mirror read failed, refusing to overwrite an unknown ban list: ${err?.message || 'unknown'}`);
  }

  const blob = buildOverridesMirror(raw, now, existing, ownedByGit);
  const body = JSON.stringify(blob);
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'text/plain' },
    body,
  });
  if (!res || !res.ok) {
    const detail = res && res.text ? await res.text().catch(() => '') : '';
    throw new Error(`KV mirror write failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
  }
  return { written: true, key, bytes: body.length };
}

/**
 * SOW-058: PUT the secret-free syndication config mirror (toSyndicationMirror: { enabled, require_approval,
 * hold_minutes, upvote_threshold, channels }) to KV key synd:config, so the Worker drain reads the live
 * house/syndication-config.yml WITHOUT a redeploy. `raw` is the parsed YAML; toSyndicationMirror normalizes it.
 * Same REST + creds-gated no-op pattern as the overrides mirror; throws only on a real API error.
 */
export async function mirrorSyndicationConfigToKv({ raw, env = process.env, fetchImpl = globalThis.fetch, key = SYNDICATION_KV_KEY } = {}) {
  return putKvJson({ label: 'syndication config', body: JSON.stringify(toSyndicationMirror(raw ?? {})), env, fetchImpl, key });
}

/** Shared creds-gated KV REST PUT (the overrides-mirror pattern). Throws only on a real API error. */
export async function putKvJson({ label, body, env = process.env, fetchImpl = globalThis.fetch, key }) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    return { written: false, key, bytes: body.length, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'text/plain' },
    body,
  });
  if (!res || !res.ok) {
    const detail = res && res.text ? await res.text().catch(() => '') : '';
    throw new Error(`${label} mirror write failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
  }
  return { written: true, key, bytes: body.length };
}

/** SOW-087: the category -> Discord-channel map mirror ({ generatedAt, channels }). `raw` is parsed YAML. */
export function buildContentChannelsMirror(raw, now = new Date()) {
  return { generatedAt: now.toISOString(), channels: Array.isArray(raw?.channels) ? raw.channels : [] };
}

/** SOW-087: PUT house/content-channels.yml -> KV synd:channels, so the drain routes category posts live. */
export async function mirrorContentChannelsToKv({ raw, env = process.env, now = new Date(), fetchImpl = globalThis.fetch, key = CONTENT_CHANNELS_KV_KEY } = {}) {
  return putKvJson({ label: 'content channels', body: JSON.stringify(buildContentChannelsMirror(raw, now)), env, fetchImpl, key });
}

/** SOW-087: PUT house/topics.yml -> KV topics:vocab, so the Worker's share category suggester sees the live vocabulary. */
export async function mirrorTopicsToKv({ raw, env = process.env, now = new Date(), fetchImpl = globalThis.fetch, key = TOPICS_KV_KEY } = {}) {
  return putKvJson({ label: 'topics vocabulary', body: JSON.stringify(toTopicsMirror(raw, () => now.toISOString())), env, fetchImpl, key });
}

/**
 * sow-291 Phase 2: does GIT still own the coupon registry, and is the file READABLE?
 *
 * Two states that a bare `try { load } catch { {} }` collapses into one, in the direction that erases the
 * registry. ABSENT is the Phase 2 flip: KV is the source and the mirror must preserve rather than rebuild.
 * UNPARSEABLE is a bad edit, and it must ABORT: a YAML syntax error merged into house/coupons.yml would
 * otherwise mirror an empty registry over the live one at the next six-hourly tick, taking every coupon down
 * within six hours, silently, on a green run. Derived from the checkout so the flip needs no flag to be
 * remembered, exactly as gitOwnedSections is.
 *
 * @returns `{ raw, ownedByGit }`. Throws on an unreadable-but-present file.
 */
export function loadCouponsRaw(root) {
  const file = path.join(root, 'house', 'coupons.yml');
  if (!fs.existsSync(file)) return { raw: {}, ownedByGit: false };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    throw new Error(`refusing to mirror coupons: house/coupons.yml exists but could not be read: ${err?.message || 'unknown'}`);
  }
  try { return { raw: yaml.load(text) || {}, ownedByGit: true }; } catch (err) {
    throw new Error(`refusing to mirror coupons: house/coupons.yml exists but is not valid YAML: ${err?.message || 'unknown'}`);
  }
}

/**
 * SOW-119: PUT house/coupons.yml -> KV coupons:config, so signup validates coupon codes against live values.
 *
 * sow-291 Phase 2: READ BEFORE WRITE, for the reason mirrorOverridesToKv does. A read failure ABORTS rather
 * than falling back to a git-only blob, because "we could not read the current coupons" must never resolve to
 * "overwrite them". A skipped sync is absorbed by the Worker's 48h freshness window; a blind overwrite is not
 * harmless, because it looks like success.
 */
export async function mirrorCouponsToKv({ raw, env = process.env, now = new Date(), fetchImpl = globalThis.fetch, key = COUPONS_KV_KEY, ownedByGit = true } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    return { written: false, key, bytes: 0, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  let existing = null;
  try {
    const cur = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiToken}` } });
    if (cur?.ok) existing = await cur.json();
    else if (cur && cur.status !== 404) throw new Error(`status ${cur.status}`); // 404 is the legitimate first write
  } catch (err) {
    throw new Error(`coupons mirror read failed, refusing to overwrite an unknown coupon registry: ${err?.message || 'unknown'}`);
  }
  return putKvJson({ label: 'coupons', body: JSON.stringify(toCouponsMirror(raw, now, existing, ownedByGit)), env, fetchImpl, key });
}
