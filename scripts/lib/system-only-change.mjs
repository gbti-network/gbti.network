// A change the SYSTEM made to existing content is not an author's edit, so it must not re-check that content
// against rules that only apply to changed files (owner, 2026-09-29).
//
// Why this exists. The content check grandfathers older content by checking some rules only on the files a pull
// request or push changes: the from-the-author note (SOW-014), the tag shape (SOW-100) and tracking parameters
// (sow-364). sow-109 Phase 1 added `kind: prompt` to every prompt file, which made every one of them "changed". One
// member's published prompt predated two of those rules, failed them, and the after-publish check unpublished it
// (e5f00460). Nobody had edited it. The owner ruled that a system-only change does not count; a member's own edits
// are checked exactly as before.
//
// A file is skipped ONLY when its body is byte-identical and its frontmatter is the same apart from the fields
// below. Anything else, including a new file, a file git cannot show, or frontmatter that does not parse, is kept
// and checked. Failing towards checking is the safe direction: the worst case is today's behaviour.

import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

/**
 * Fields the system writes into EXISTING content, whose change alone is not an author's edit. Add a field here only
 * when a retrofit writes it across content the authors did not touch.
 *   kind   sow-109: every prompt item states prompt or skill (retrofitted onto all 27 on 2026-09-29)
 */
export const SYSTEM_FIELDS = Object.freeze(['kind']);

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parts(text) {
  const m = FM_RE.exec(String(text));
  if (!m) return null;
  let fm;
  try { fm = yaml.load(m[1]); } catch { return null; }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return null;
  return { fm, body: m[2] };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** True when `after` differs from `before` only in SYSTEM_FIELDS. Null or unparsable input is never system-only. */
export function isSystemOnlyChange(before, after, systemFields = SYSTEM_FIELDS) {
  if (typeof before !== 'string' || typeof after !== 'string') return false;
  const a = parts(before);
  const b = parts(after);
  if (!a || !b) return false;
  if (a.body !== b.body) return false;
  const keys = new Set([...Object.keys(a.fm), ...Object.keys(b.fm)]);
  for (const k of keys) {
    if (systemFields.includes(k)) continue;
    if (!same(a.fm[k], b.fm[k])) return false;
  }
  return true;
}

/** A file as it was at `base`, or null when git cannot show it (new in this change, or no such revision). */
function showAt(base, file, root) {
  const r = spawnSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/**
 * The changed files minus those whose change is system-only. Without a base there is nothing to compare against, so
 * every file is kept. `readBefore` and `readAfter` are injectable for tests.
 */
export function withoutSystemOnlyChanges(files, { base, root, readBefore, readAfter }) {
  if (!base) return [...files];
  const before = readBefore || ((f) => showAt(base, f, root));
  return files.filter((f) => {
    let after = null;
    try { after = readAfter(f); } catch { after = null; }
    return !isSystemOnlyChange(before(f), after);
  });
}
