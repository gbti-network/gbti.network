// The Cloudflare Workers KV REST helpers: delete, list by prefix, put, read (strict and plain), and a
// Workers-KV-shaped facade over them. Split out of scripts/lib/erase-member.mjs at the 900-line cap (2026-09-30);
// the code below moved verbatim. Mirrors scripts/lib/kv-mirror.mjs for the CF KV REST calls.
//
// A LEAF MODULE ON PURPOSE: it imports nothing at all. shoptalk-state.mjs, erase-prepared-listings.mjs and the
// scripts that need KV access import from here rather than from erase-member.mjs, which is what retired the old
// erase-member.mjs <-> shoptalk-state.mjs import ring. erase-member.mjs re-exports every name here.

/**
 * DELETE one key from the signup Worker's KV via the Cloudflare REST API. Returns { deleted, key, reason }.
 * Missing credentials (local dry-runs, tests) is a reported no-op, not a throw; a real API error throws.
 */
export async function deleteKvKey({ key, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    return { deleted: false, key, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { method: 'DELETE', headers: { Authorization: `Bearer ${apiToken}` } });
  if (!res || !res.ok) {
    const detail = res && res.text ? await res.text().catch(() => '') : '';
    throw new Error(`KV delete failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
  }
  return { deleted: true, key };
}

/**
 * List KV entries under a prefix via the REST API. Missing creds = a reported no-op.
 *
 * Returns `{ available, keys, entries, dropped }`. The KEY LIST is fail-closed: a failed page THROWS, because a
 * short list is indistinguishable from a short keyspace. The per-key VALUE READ must not throw, or one unreadable
 * record would fail an entire scan, so it is REPORTED instead: `keys` is every key that was listed, `entries` is
 * only those whose value read succeeded AND parsed as a JSON object, and `dropped` counts the difference.
 * `keys.length === entries.length + dropped` always holds.
 *
 * `dropped` SPLITS BY CAUSE into `unreadable` (the read failed, so we could not tell what the key holds) and
 * `unparsed` (the read succeeded and the value was not a JSON object). They are different facts and a caller
 * should treat them differently: `unreadable` is a blind spot an erasure MUST refuse on, while `unparsed` is a
 * schema mismatch that is often benign. A guard that fails closed on the combined count refuses on benign schema
 * drift, and a guard that cries wolf is a guard someone switches off.
 *
 * A CALLER THAT ERASES MUST CHECK `unreadable`. A key dropped that way is a record that was NOT scrubbed, and
 * reporting the scrub count on its own makes "we could not read whether this record names them" look exactly
 * like "it does not". A caller that only needs to know which keys exist should read `keys` and never fetch a
 * value at all.
 */
export async function listKvByPrefix({ prefix, env = process.env, fetchImpl = globalThis.fetch, keysOnly = false } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return { available: false, reason: 'CF creds not set', entries: [], keys: [], dropped: 0, unreadable: 0, unparsed: 0 };
  const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = { Authorization: `Bearer ${apiToken}` };
  const keys = [];
  let cursor = '';
  for (let page = 0; page < 100000; page++) {
    const url = `${apiBase}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchImpl(url, { headers });
    if (!res || !res.ok) throw new Error(`KV key list failed: ${res ? res.status : 'no response'}`);
    const json = await res.json();
    for (const k of json?.result ?? []) if (k?.name) keys.push(k.name);
    cursor = json?.result_info?.cursor || '';
    if (!cursor) break;
  }
  // A caller that only needs to know which keys EXIST skips the value loop entirely, as the doc above says it
  // should. eraseDraftImages does: it deletes by key, and each staged image value may be a full megabyte, so
  // fetching them to throw them away would move tens of megabytes for nothing. The key list stays fail-closed.
  if (keysOnly) return { available: true, entries: [], keys, dropped: 0, unreadable: 0, unparsed: 0 };
  const entries = [];
  let unreadable = 0;   // the read itself failed: we could not tell what is in this key
  let unparsed = 0;     // the read succeeded and the value was not a JSON object: a schema mismatch, not a blind spot
  for (const key of keys) {
    const res = await fetchImpl(`${apiBase}/values/${encodeURIComponent(key)}`, { headers });
    if (!res || !res.ok) { unreadable++; continue; }
    let value = null;
    try { value = await res.json(); } catch { value = null; }
    if (value && typeof value === 'object') entries.push({ key, value });
    else unparsed++;
  }
  return { available: true, entries, keys, dropped: unreadable + unparsed, unreadable, unparsed };
}

/** PUT a KV value via the REST API. Missing creds = a reported no-op. */
/**
 * Write one KV value. **REFUSES LOUDLY BY DEFAULT when the Cloudflare credentials are absent.**
 *
 * It used to return `{written: false, reason}` instead, which is the right shape for a reporting step and the
 * wrong one for every caller whose NEXT ACTION assumes the write happened. That made safety a property of the
 * CALLER: eight erasure writers in this file are safe only because each independently returns before reaching a
 * write when the creds are missing, and they do not even share a mechanism (seven gate on a prefix scan's
 * `available`, `minimizeCouponGrant` gates on a strict single-key read). Nothing enforced it, and
 * `await putKvValue(...)` looks identical at a guarded and an unguarded call site, so a ninth writer copying an
 * existing line would inherit the shape and not the protection. "All current callers are safe" was a fact about
 * today, not a property of the code (OnboardingMaster, 2026-08-22).
 *
 * So the guard is now the default and tolerance is what you write on purpose. Pass `allowMissingCreds: true`
 * only where a no-op is genuinely correct AND the return is inspected, e.g. a reporting step that prints
 * "SKIPPED (no creds)". A genuine PUT failure has always thrown and still does.
 */
export async function putKvValue({ key, value, env = process.env, fetchImpl = globalThis.fetch, allowMissingCreds = false } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    if (allowMissingCreds) return { written: false, reason: 'CF creds not set' };
    throw new Error(`KV put refused for ${key}: CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set. Pass allowMissingCreds:true only if a silent no-op is correct here and you inspect the result.`);
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { method: 'PUT', headers: { Authorization: `Bearer ${apiToken}` }, body: typeof value === 'string' ? value : JSON.stringify(value) });
  if (!res || !res.ok) throw new Error(`KV put failed: ${res ? res.status : 'no response'}`);
  return { written: true, key };
}

/** GET one raw KV value via the REST API (used for the shared coupon counter). Missing creds = null. */
/**
 * Read one KV value, keeping ABSENT and UNREADABLE apart. `readKvValue` collapses both to null, which is fine for
 * a caller asking "is there something here" and DANGEROUS for one that computes a new value FROM the old one: a
 * transient read failure then looks like a zero or empty prior state, and the write destroys real data.
 *
 * Returns `{ ok: true, value }` where a null value means genuinely absent (404), or `{ ok: false, status }` when
 * the read failed and we therefore know nothing about what the key holds.
 */
export async function readKvValueStrict({ key, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return { ok: false, value: null, status: null, reason: 'CF creds not set' };
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiToken}` } });
  if (res && res.status === 404) return { ok: true, value: null, status: 404 };   // genuinely absent
  if (!res || !res.ok) return { ok: false, value: null, status: res ? res.status : null };
  const text = res.text ? await res.text().catch(() => null) : null;
  if (text === null) return { ok: false, value: null, status: res.status ?? null };
  return { ok: true, value: text, status: res.status ?? 200 };
}

export async function readKvValue({ key, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiToken}` } });
  if (!res || !res.ok) return null;
  return res.text ? res.text().catch(() => null) : null;
}

/**
 * A Workers-KV-shaped facade over the REST helpers above, so the SCRIPT side and the WORKER side run the SAME
 * erasure logic (`eraseSubscriberMail`) instead of two implementations that can drift. An erasure path is the
 * worst possible place for two implementations, because the failure mode is silent: records that were never
 * deleted look exactly like records that were.
 *
 * `get` honours the TYPE ARGUMENT because mail-store.mjs uses both forms (`kv.get(k, 'json')` at the issue,
 * send, pending and subscriber reads, plain `kv.get(k)` at the existence checks). A shim that ignored it would
 * hand back a raw string where an object was expected, every parse would yield null, and the erasure would
 * report success having deleted nothing.
 *
 * `list` is keys-only ON PURPOSE and does not reuse listKvByPrefix, which fetches every value and then DROPS
 * any entry whose value is not a JSON object. That filter is harmless where it is used; here it would silently
 * skip an issue whose body failed to parse, and with it that issue's send record for this person. Enumerating
 * keys without reading values is both cheaper and the only version that cannot lose a key.
 */
export function kvRestShim({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return null;
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = { Authorization: `Bearer ${apiToken}` };
  return {
    async get(key, type) {
      // THROWS on an unreadable key, returns null only for a genuine miss. Real Workers KV behaves this way, and
      // the whole point of this shim is that the script side and the Worker side run the SAME erasure logic. The
      // previous version swallowed a failed read into null, which made findMemberSubscriberHashes' fail-closed
      // catch DEAD on the script path: an unreadable subscriber record was silently reported as a clean scan.
      const read = await readKvValueStrict({ key, env, fetchImpl });
      if (!read.ok) throw new Error(`KV read failed for ${key}: ${read.status ?? read.reason ?? 'no response'}`);
      const text = read.value;
      if (text == null) return null;
      if (type !== 'json') return text;
      try { return JSON.parse(text); } catch { return null; }
    },
    async put(key, value) {
      return putKvValue({ key, value, env, fetchImpl });
    },
    async delete(key) {
      return deleteKvKey({ key, env, fetchImpl });
    },
    async list({ prefix, cursor } = {}) {
      const url = `${base}/keys?prefix=${encodeURIComponent(prefix ?? '')}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await fetchImpl(url, { headers });
      if (!res || !res.ok) throw new Error(`KV key list failed: ${res ? res.status : 'no response'}`);
      const json = await res.json();
      const next = json?.result_info?.cursor || '';
      return {
        keys: (json?.result ?? []).filter((k) => k?.name).map((k) => ({ name: k.name })),
        list_complete: !next,
        cursor: next || undefined,
      };
    },
  };
}
