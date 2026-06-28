// SOW-076 Phase 3 (post-publish content validation + auto-flip-to-draft remediation): the PURE planner. content-check
// already runs validate-content on push to main, so invalid published content is caught + alarmed; but an item that
// auto-merged BEFORE its PR content-check finished can still reach main. This plans the REMEDIATION: flip the offending
// PUBLISHED content back to DRAFT (reversible -- the author fixes + republishes) and ALERT on errors not tied to a
// single flippable file (a draft, a non-content file, or a cross-file/global error). Pure + side-effect-free; the IO
// (run validate-content --json, read each item's status, flip via the bot PR, notify) wraps it.

// A content item that CAN be flipped to draft: members/<user>/{posts,products,prompts}/<slug>/index.md or house/...
const CONTENT_FILE = /^(members\/[^/]+|house)\/(posts|products|prompts)\/[^/]+\/index\.md$/;

/** Parse a `validate-content` error string ("<repo-relative-path>: <message>" or a global message) into { file,
 *  message }. file is '' when the error is not prefixed by a content path. */
export function parseError(str) {
  const s = String(str || '');
  const i = s.indexOf(': ');
  if (i > 0) {
    const file = s.slice(0, i);
    if (CONTENT_FILE.test(file)) return { file, message: s.slice(i + 2) };
  }
  return { file: '', message: s };
}

/**
 * Plan the remediation from the validation errors + the set of currently-published content files.
 * @param {object} a
 * @param {Array<{file:string,message:string}|string>} a.errors  validation errors (objects or raw strings).
 * @param {Set<string>|string[]} [a.publishedFiles]  content files currently status:published (ONLY these are flipped).
 * @returns {{ flip: string[], alertOnly: Array<{file:string,message:string}> }}
 *   flip = published content files to draft (deduped); alertOnly = everything not auto-remediable (still surfaced).
 */
export function planRemediation({ errors = [], publishedFiles = [] } = {}) {
  const published = publishedFiles instanceof Set ? publishedFiles : new Set(publishedFiles);
  const flip = new Set();
  const alertOnly = [];
  for (const raw of errors) {
    const e = typeof raw === 'string' ? parseError(raw) : (raw && typeof raw === 'object' ? raw : null);
    if (!e || !e.message) continue;
    if (e.file && CONTENT_FILE.test(e.file) && published.has(e.file)) flip.add(e.file);
    else alertOnly.push({ file: e.file || '', message: e.message });
  }
  return { flip: [...flip], alertOnly };
}
