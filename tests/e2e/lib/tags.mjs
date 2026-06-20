// SOW-035 Phase 5: the E2E tag taxonomy. A cycle declares its tags; `runnable(tags)` decides whether it runs,
// from the E2E_TAGS env (a comma list). This lets CI run a fast read-only SMOKE subset separately from the full
// write-bearing suite, and lets self-cleaning be opt-in for any future MANUAL-CLEANUP cycle.
//
//   (unset)                 -> run everything EXCEPT manual-cleanup cycles (the default full, safe run)
//   E2E_TAGS=smoke          -> run only smoke-tagged cycles (read-only / fail-closed; no writes)
//   E2E_TAGS=full           -> run only full-tagged cycles
//   E2E_TAGS=full,manual-cleanup -> include cycles that cannot self-clean (run by hand)
//
// Convention: read-only / fail-closed checks are tagged 'smoke'; anything that writes (a PR, a KV toggle, a
// reconcile) is tagged 'full'. A cycle that CANNOT scrub itself adds 'manual-cleanup' (excluded by default).

export const SMOKE = 'smoke';
export const FULL = 'full';
export const MANUAL_CLEANUP = 'manual-cleanup';

/** Parse the requested tag set from env (injectable for tests). */
export function wanted(env = process.env) {
  return (env.E2E_TAGS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Should a cycle with these tags run, given the requested set? Pure. */
export function runnable(tags = [], env = process.env) {
  const want = wanted(env);
  if (want.length === 0) return !tags.includes(MANUAL_CLEANUP); // default: all except manual-cleanup
  return tags.some((t) => want.includes(t));
}
