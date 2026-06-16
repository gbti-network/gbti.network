// SOW-028 P2: parse a GitHub unified `patch` string (the per-file diff) into renderable rows for the
// contribution review view. Pure (no DOM), so node --test covers the line classification. GitHub's per-file
// patch begins at the first @@ hunk header (it omits the ---/+++ file header), so a leading +/- is always a
// real change line; we still treat a +++/--- header defensively as a hunk line. Each row is { cls, text }
// where cls is 'add' | 'del' | 'hunk' | 'ctx'.
export function diffRows(patch) {
  if (!patch || typeof patch !== 'string') return [];
  return patch.split('\n').map((line) => {
    if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) return { cls: 'hunk', text: line };
    if (line.startsWith('+')) return { cls: 'add', text: line };
    if (line.startsWith('-')) return { cls: 'del', text: line };
    return { cls: 'ctx', text: line };
  });
}

/** Total added / removed lines across a set of files (each carrying additions/deletions counts). */
export function diffTotals(files) {
  return (files || []).reduce(
    (t, f) => ({ additions: t.additions + (f.additions || 0), deletions: t.deletions + (f.deletions || 0) }),
    { additions: 0, deletions: 0 },
  );
}
