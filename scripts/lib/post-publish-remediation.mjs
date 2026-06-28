// SOW-076 Phase 3 (post-publish content validation + auto-flip-to-draft remediation): the PURE planner. content-check
// already runs validate-content on push to main, so invalid published content is caught + alarmed; but an item that
// auto-merged BEFORE its PR content-check finished can still reach main. This plans the REMEDIATION: flip the offending
// PUBLISHED content back to DRAFT (reversible -- the author fixes + republishes) and ALERT on errors not tied to a
// single flippable file (a draft, a non-content file, or a cross-file/global error). Pure + side-effect-free; the IO
// (run validate-content --json, read each item's status, flip via the bot PR, notify) wraps it.

import { flipStatus } from '../reconcile.mjs'; // SOW-076 Phase 3: reuse the SOW-005 status flip (status: published -> draft)

// A content item that CAN be flipped to draft: members/<user>/{posts,products,prompts}/<slug>/index.md or house/...
const CONTENT_FILE = /^(members\/[^/]+|house)\/(posts|products|prompts)\/[^/]+\/index\.md$/;
const toB64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const fromB64 = (b) => Buffer.from(b, 'base64').toString('utf8');

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

/**
 * Flip the given content files status: published -> draft via ONE auto-merged bot PR (reversible; the author fixes +
 * re-publishes). Mirrors erase-member.mjs eraseContent: a phase-1 base read decides what changes (already-draft /
 * missing are skipped, so a no-op opens no PR), then a phase-2 commit reads each target FROM THE BRANCH (no TOCTOU).
 * Reported no-op without a GitHub client. Injectable, so it unit-tests with a fake github.
 */
export async function flipFilesToDraft({ github = null, files = [], reason = 'failed post-publish validation', base = 'main', now = new Date() } = {}) {
  if (!github) return { skipped: true, reason: 'no GitHub client (set GITHUB_BOT_TOKEN + GITHUB_CONTENT_REPO)' };
  const toFlip = [];
  for (const f of files) {
    const existing = await github.getContent(f, base);
    if (!existing?.content) continue;
    const current = fromB64(existing.content);
    if (flipStatus(current, 'draft') !== current) toFlip.push(f);
  }
  if (!toFlip.length) return { flipped: 0, reason: 'nothing to flip (already draft or missing)' };

  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) return { error: `cannot resolve ${base} head sha` };
  const branch = `remediate/${now.getTime()}`;
  await github.createRef(branch, baseSha);

  let flipped = 0;
  for (const f of toFlip) {
    const onBranch = await github.getContent(f, branch);
    if (!onBranch?.content) continue;
    const current = fromB64(onBranch.content);
    const next = flipStatus(current, 'draft');
    if (next === current) continue; // a concurrent flip beat us: skip
    await github.putContent(f, { message: `remediate: draft ${f} (${reason})`, content: toB64(next), branch, sha: onBranch.sha });
    flipped++;
  }
  if (!flipped) return { flipped: 0, reason: 'content already drafted concurrently' };

  const pull = await github.createPull({
    title: `remediate: draft ${flipped} invalid published item(s)`,
    head: branch, base,
    body: `Automated SOW-076 post-publish remediation: ${flipped} item(s) FAILED content validation after publishing and were flipped to draft (${reason}). Fix the content and re-publish. Reversible; git history persists.`,
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { pr: pull.number, flipped };
}
