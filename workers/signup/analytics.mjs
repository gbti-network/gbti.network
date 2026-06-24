// SOW-061: the usage-analytics seam. recordUsage writes ONE aggregate data point per instrumented event to the
// Workers Analytics Engine dataset (the EXT_ANALYTICS binding). Fire-and-forget: writeDataPoint adds no latency and
// is never awaited, and a thrown analytics error can NEVER affect the request (wrapped in try/catch). A no-op when
// the binding is absent (local dev, tests, or before the dataset is provisioned).
//
// PII-FREE BY CONSTRUCTION: the only recorded fields are the tier bucket, the event name, the extension version, and
// the environment. NEVER a github_id / login / email / IP / URL / slug. The closed vocabularies in usage-bucket.mjs
// bound the cardinality, and an out-of-vocabulary tier/event is dropped so a bug cannot write a junk dimension.

import { isUsageEvent, USAGE_BUCKETS } from '../../membership/usage-bucket.mjs';

const KNOWN_BUCKET = new Set(USAGE_BUCKETS);
// A sane version string (e.g. "1.4.2"); anything else collapses to 'unknown' so a spoofed header cannot blow up
// the cardinality of the extVersion dimension.
const VERSION_RE = /^[0-9]{1,3}(\.[0-9]{1,3}){0,3}$/;

function extVersion(request) {
  try {
    const v = request?.headers?.get?.('X-GBTI-Ext-Version');
    return v && VERSION_RE.test(v) ? v : 'unknown';
  } catch { return 'unknown'; }
}

function environmentOf(env) {
  try { return /signup\.gbti\.network/.test(String(env?.PUBLIC_BASE_URL || '')) ? 'production' : 'sandbox'; }
  catch { return 'sandbox'; }
}

/**
 * Record ONE usage event. `tier` must be a known bucket and `event` a known event, else it is dropped (so a bug can
 * never write a junk / unbounded dimension). No-op + never throws when EXT_ANALYTICS is unbound.
 * @param env     the Worker env (carries the EXT_ANALYTICS binding + PUBLIC_BASE_URL).
 * @param tier    a USAGE_BUCKETS value (the effective cohort).
 * @param event   a USAGE_EVENTS value.
 * @param request the inbound Request (read-only, for the X-GBTI-Ext-Version header). Optional.
 */
export function recordUsage(env, { tier, event, request } = {}) {
  try {
    const ds = env?.EXT_ANALYTICS;
    if (!ds || typeof ds.writeDataPoint !== 'function') return; // unbound: a clean no-op
    if (!KNOWN_BUCKET.has(tier) || !isUsageEvent(event)) return; // out-of-vocabulary: drop
    ds.writeDataPoint({
      blobs: [tier, event, extVersion(request), environmentOf(env)],
      doubles: [1],
      indexes: [tier], // index by tier so GROUP BY blob1 (tier) is cheap; AE allows one index
    });
  } catch { /* analytics must never affect the request */ }
}
