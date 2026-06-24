// SOW-058 P4: enqueue syndication items from GitHub Actions via the Cloudflare KV REST API. The content-publish
// workflow runs in Actions and cannot reach the Worker's in-process enqueue, so this wraps the SAME `enqueue()`
// (dedupe pointer + pending index + config-driven hold) behind a REST-backed KV adapter (get/put over
// api.cloudflare.com). ONE enqueue implementation, two transports (the Worker uses the real binding; Actions use
// this). Gated on CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN; a reported no-op when they are absent (local
// dry-runs, tests), mirroring scripts/lib/kv-mirror.mjs + favorite-counts.mjs.
import { enqueue } from '../../workers/signup/syndication-store.mjs';

/** A minimal KV binding (get/put) backed by the Cloudflare KV REST API, so the Worker `enqueue` runs unchanged. */
export function kvRestAdapter({ accountId, namespaceId, token, fetchImpl = fetch } = {}) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = { Authorization: `Bearer ${token}` };
  return {
    async get(key, type) {
      const res = await fetchImpl(`${base}/values/${encodeURIComponent(key)}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`KV GET ${key}: ${res.status}`);
      const text = await res.text();
      return type === 'json' ? (text ? JSON.parse(text) : null) : text;
    },
    async put(key, value) {
      const res = await fetchImpl(`${base}/values/${encodeURIComponent(key)}`, {
        method: 'PUT', headers, body: typeof value === 'string' ? value : JSON.stringify(value),
      });
      if (!res.ok) throw new Error(`KV PUT ${key}: ${res.status}`);
    },
  };
}

/**
 * Enqueue queue-item INPUTS (the buildQueueItem contract) via the KV REST API. Returns
 * { available, enqueued, results } — `available:false` is a reported no-op (no CF creds), never a throw. Each input
 * runs through the Worker `enqueue`, so the dedupe (a republish / retried Action never double-posts) is shared.
 */
export async function enqueueViaKvRest(inputs, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const token = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !token) {
    return { available: false, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set', enqueued: 0, results: [] };
  }
  const kv = kvRestAdapter({ accountId, namespaceId, token, fetchImpl });
  const results = [];
  for (const input of Array.isArray(inputs) ? inputs : []) {
    try {
      results.push(await enqueue({ SIGNUP_KV: kv }, input, { now }));
    } catch (e) {
      results.push({ enqueued: false, error: e?.message || String(e), targetSlug: input?.targetSlug });
    }
  }
  return { available: true, enqueued: results.filter((r) => r?.enqueued).length, results };
}
