#!/usr/bin/env node
// LOCAL ONLY. Answers "is sow-NNN free?" completely, which the directory listing cannot.
//
// WHY THIS EXISTS. A number can be claimed by shipped code that never got a document, so an absent document
// and an absent number look identical. Three collisions in about eight days each cost real time: one number
// naming two documents, one taken over by code seven days after being assigned (fourteen files frozen for a
// day), and one approved as a renumber target while already in use. None was caught by a person, across
// three sessions, because everybody checked the half of the question the folder can answer.
//
// WHY IT IS NOT IN CI, AND MUST NOT BE PUT THERE. `.data/` is gitignored, so the planning documents DO NOT
// EXIST in a fresh checkout. This guard in the build would find every cited number undocumented and fail
// every push; softened to a warning it reports the same alarming number forever and is learned to be
// ignored; softened again to "skip when .data/ is absent" it passes vacuously in the only place it runs,
// which is the failure class this repo has recorded repeatedly. It is a tool for this clone, run
// deliberately, in the family of `npm run reconcile` rather than `npm run check:content`.
//
// THE CASE BUG THIS WAS BUILT AROUND (sow-286, measured 2026-09-20). The hand run that cleared this backlog
// on 2026-09-08 searched for lowercase `sow-` only. Older work cites itself in capitals, and 100 of the 316
// cited numbers are ONLY ever written that way, so that run found six missing documents, wrote six records,
// reported the backlog clear, and missed three the original audit had already named by hand: 048, 093 and
// 133. Both sides of this check are case-insensitive for that reason, and a test pins it.
//
// THE OTHER DEFECT IN THE OLD BY-HAND COMMANDS. `find .data/sow -name "*<n>*"` matches a number ANYWHERE in
// a filename, so `sow-240-correction-to-sow-223-...` reads as a document for 223. That briefly looked like a
// live collision while this was being written. A document's number is the LEADING token of its basename,
// which is also why frontmatter is not the source: three older documents have no frontmatter at all.
//
// WHAT IT DOES NOT DO. It never renumbers anything: which side of a collision yields is a judgement call,
// and the cheap direction has already proven not to be the obvious one. It never fetches: it reads
// origin/main from the local object store, and prints how old that copy is, so a stale answer is visible
// rather than assumed.
//
//   node scripts/check-sow-numbers.mjs                 report both directions
//   node scripts/check-sow-numbers.mjs --next          print the next free number and stop
//   node scripts/check-sow-numbers.mjs --root <dir>    read the planning tree from another clone
//
// `--root` exists because this project does most of its committing from a DETACHED WORKTREE, and a worktree
// has no .data/ at all: the planning tree lives only in the main clone. Without it the tool would refuse to
// run in exactly the working state the repo uses most. It changes only where the DOCUMENTS are read from;
// the code side is always origin/main from the local object store.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOKEN = /^sow-\d{3}$/;

/** Normalize a raw token to the canonical lowercase form, or null if it is not one. */
export function normalizeToken(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  return TOKEN.test(t) ? t : null;
}

/**
 * The numbers cited in CODE at a ref. `run` is injected so the parsing is testable without a repository.
 *
 * git grep -I skips binary files. Without it, git prints a literal `binary file <ref>:<path> matches` line
 * INTO this output, and those words contain no token but the path might, which is how a wrong count nearly
 * reached the owner while the original audit was being written. Every line is therefore validated against
 * the token shape and anything else is returned as `junk` for the caller to refuse, rather than filtered
 * away quietly.
 */
export function collectCited({ ref = 'origin/main', run } = {}) {
  const exec = run || ((args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  let out = '';
  try {
    out = exec(['grep', '-I', '-ohiE', 'sow-[0-9]{3}', ref, '--', ':!.data']);
  } catch (e) {
    // git grep exits 1 when nothing matched, which is a real (if alarming) answer, not a failure.
    if (e?.status === 1) out = String(e.stdout ?? '');
    else throw e;
  }
  const cited = new Set();
  const junk = [];
  for (const line of String(out).split('\n')) {
    if (!line.trim()) continue;
    const t = normalizeToken(line);
    if (t) cited.add(t);
    else junk.push(line.trim());
  }
  return { cited, junk };
}

/**
 * The numbers that HAVE a document, keyed by the leading token of each basename (see the header note on why
 * not frontmatter, and why not "anywhere in the name"). `files` is injected for testing.
 */
export function collectDocuments({ sowDir, files } = {}) {
  const list = files || (fs.existsSync(sowDir) ? walk(sowDir) : []);
  const documents = new Map(); // token -> [paths]
  for (const f of list) {
    const m = /^(sow-\d{3})/i.exec(path.basename(f));
    if (!m) continue;
    const t = m[1].toLowerCase();
    if (!documents.has(t)) documents.set(t, []);
    documents.get(t).push(f);
  }
  return documents;
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/**
 * Compare the two sides. Pure over its inputs, so every case below is unit-tested without a repository or a
 * planning folder (which does not exist in CI, where these tests run).
 *
 * Returns { errors, notes, docless, unreferenced, duplicates, nextFree, gaps }.
 */
export function checkSowNumbers({ cited, documents, opsMentions = new Set(), sowDirExists = true } = {}) {
  const errors = [];
  const notes = [];

  // Refuse to run blind. A guard that reports success on an empty corpus is worse than no guard, and this is
  // the exact way this one would fail if it were ever wired into a build.
  if (!sowDirExists) {
    errors.push('.data/sow does not exist, so this check had no documents to compare against and proved nothing. It is a LOCAL tool and needs the planning tree; it must never be wired into CI, where .data/ is absent by design.');
    return { errors, notes, docless: [], unreferenced: [], duplicates: [], nextFree: null, gaps: [] };
  }
  if (documents.size === 0) {
    errors.push('.data/sow holds no SOW documents, so every cited number would read as undocumented. Refusing to report that as a finding: a pass or a flood here would both be a result about nothing.');
    return { errors, notes, docless: [], unreferenced: [], duplicates: [], nextFree: null, gaps: [] };
  }

  const docless = [...cited].filter((t) => !documents.has(t)).sort();
  const unreferenced = [...documents.keys()].filter((t) => !cited.has(t)).sort();
  const duplicates = [...documents.entries()].filter(([, paths]) => paths.length > 1).map(([t, paths]) => ({ token: t, paths }));

  for (const t of docless) {
    const ops = opsMentions.has(t)
      ? ' (mentioned in ops or specs, which is NOT a document: it does not say what the number was)'
      : '';
    errors.push(`${t} is claimed by code at origin/main and has no document${ops}`);
  }
  for (const d of duplicates) {
    errors.push(`${d.token} names ${d.paths.length} documents: ${d.paths.join(', ')}`);
  }

  // Informational. Plenty of SOWs are pure planning and never cited, so this is not a defect; it is what
  // makes a number LOOK free when it is not, which is how one of the three collisions happened.
  if (unreferenced.length) notes.push(`${unreferenced.length} document${unreferenced.length === 1 ? '' : 's'} are not cited by any code (normal for planning-only work)`);

  const taken = new Set([...cited, ...documents.keys()]);
  const nums = [...taken].map((t) => Number(t.slice(4))).sort((a, b) => a - b);
  const highest = nums.length ? nums[nums.length - 1] : 0;
  // The next free number is the one ABOVE the highest in use, not the lowest gap. A gap may be a number
  // claimed somewhere this check cannot see, and reusing one is how a collision starts.
  const nextFree = `sow-${String(highest + 1).padStart(3, '0')}`;
  const gaps = [];
  for (let n = 1; n < highest; n += 1) {
    const t = `sow-${String(n).padStart(3, '0')}`;
    if (!taken.has(t)) gaps.push(t);
  }

  return { errors, notes, docless, unreferenced, duplicates, nextFree, gaps };
}

/** Numbers mentioned anywhere under .data OUTSIDE .data/sow, which is usage rather than documentation. */
export function collectOpsMentions(root) {
  const mentions = new Set();
  for (const sub of ['ops', 'specs', 'coms', 'schemas']) {
    const dir = path.join(root, '.data', sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of walk(dir)) {
      let text = '';
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (const m of text.matchAll(/sow-\d{3}/gi)) mentions.add(m[0].toLowerCase());
    }
  }
  return mentions;
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootFlag = process.argv.indexOf('--root');
  const ROOT = rootFlag >= 0 && process.argv[rootFlag + 1]
    ? path.resolve(process.argv[rootFlag + 1])
    : path.resolve(fileURLToPath(import.meta.url), '../..');
  const SOW_DIR = path.join(ROOT, '.data', 'sow');
  const wantNext = process.argv.includes('--next');

  const { cited, junk } = collectCited({});
  if (junk.length) {
    console.error(`✗ the code scan returned ${junk.length} line(s) that are not sow numbers, so its output cannot be trusted:`);
    for (const j of junk.slice(0, 5)) console.error('  - ' + j);
    process.exit(1);
  }
  const documents = collectDocuments({ sowDir: SOW_DIR });
  const opsMentions = collectOpsMentions(ROOT);
  const r = checkSowNumbers({ cited, documents, opsMentions, sowDirExists: fs.existsSync(SOW_DIR) });

  if (wantNext) {
    if (r.errors.length && !r.nextFree) { for (const e of r.errors) console.error('✗ ' + e); process.exit(1); }
    console.log(r.nextFree);
    process.exit(0);
  }

  // How stale is the copy of origin this answer came from. The whole class of bug here is state that moved
  // after somebody looked, so the age of the look is part of the answer.
  try {
    const when = execFileSync('git', ['log', '-1', '--format=%h %cr', 'origin/main'], { cwd: ROOT, encoding: 'utf8' }).trim();
    console.log(`· read from origin/main at ${when} (no fetch was made; pull first if that is old)`);
  } catch { console.log('· could not read origin/main; the code side may be empty or stale'); }

  for (const n of r.notes) console.log('· ' + n);
  if (r.errors.length) {
    console.error(`✗ sow number check failed (${r.errors.length}):`);
    for (const e of r.errors) console.error('  - ' + e);
    console.error(`  next free number: ${r.nextFree}`);
    process.exit(1);
  }
  console.log(`✓ every one of the ${cited.size} numbers cited in code has a document (${documents.size} documents on file)`);
  console.log(`  next free number: ${r.nextFree}${r.gaps.length ? `; unused gaps: ${r.gaps.join(', ')}` : ''}`);
}
