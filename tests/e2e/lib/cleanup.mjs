// SOW-035: the E2E artifact registry + cleanup engine. Every spec that creates a LIVE artifact registers a
// teardown thunk; runCleanup() runs them in reverse creation order, best-effort and idempotent, and reports
// anything it could not remove so a human can finish. Two strategies, in preference order:
//
//   - SCRUB (preferred): delete the record entirely. KV activity/follows toggle or hard-delete via the Worker;
//     a content PR closes + its head branch and fork-staged draft delete via the GitHub API.
//   - HIDE (fallback): when a record cannot be scrubbed (a content PR that already merged, so the bytes are in
//     immutable git history), use a SUPERADMIN token to flip the content schema so it disappears from every
//     public surface: status -> draft (excluded from the build, the indexes, and the activity feed) and, belt
//     and suspenders, visibility -> members. The git history keeps the bytes; no UI ever renders them. This is
//     the SOW-035 "leverage superadmin to hide via schema if we cannot scrub" path.
//
// Pure of any service: a spec passes in its own teardown closure (which calls the Worker or GitHub). The engine
// only orders, runs, and reports. Node-free imports so it can be unit-tested later with fake teardowns.

export function createRegistry() {
  const items = [];
  return {
    /** Register a created artifact with how to remove it. strategy is 'scrub' (default) or 'hide'. */
    register(label, teardown, { strategy = 'scrub' } = {}) {
      items.push({ label, teardown, strategy });
      return label;
    },
    size() {
      return items.length;
    },
    /** Run every teardown in reverse order, best-effort. Returns { total, cleaned, leaked: [label] }. */
    async cleanup(log = () => {}) {
      const order = [...items].reverse();
      const leaked = [];
      let cleaned = 0;
      for (const it of order) {
        try {
          await it.teardown();
          cleaned += 1;
          log(`  cleaned [${it.strategy}] ${it.label}`);
        } catch (e) {
          leaked.push(it.label);
          log(`  LEAKED [${it.strategy}] ${it.label}: ${e?.message ?? e}`);
        }
      }
      return { total: items.length, cleaned, leaked };
    },
  };
}

/**
 * Build a HIDE teardown for a content item that could not be scrubbed: flip its frontmatter to status: draft and
 * visibility: members via an auto-merged superadmin PR, so it leaves every public surface. `flip` is injected
 * (the GitHub client or a thin wrapper) so this stays testable; it receives { path, frontmatter } and opens +
 * merges the PR. Used by content specs in the publish phase; recorded with strategy 'hide'.
 */
export function hideViaSchema(flip, path) {
  return async () => {
    await flip({ path, frontmatter: { status: 'draft', visibility: 'members' } });
  };
}
