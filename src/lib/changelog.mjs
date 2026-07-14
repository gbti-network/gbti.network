// SOW-118: the build-time changelog read. The source of truth is house/changelog.yml, the git-native,
// admin-CODEOWNED journal the deployment SOP appends to on every version bump or notable build. This module
// reads + validates it once at build, and is imported by BOTH src/pages/changelog.json.ts (the artifact the
// extension fetches) and src/pages/changelog.astro (the public /changelog page), so the two never diverge.
// It is a .mjs core so the node test suite exercises the normalizer directly (the repo's dual pattern, e.g.
// content-index.mjs).
//
// Validation is STRICT (it throws), the same choice as quotes.json.ts: a malformed changelog edit should fail
// the build loudly rather than ship a broken or partial history. A build note is never a secret; the whole
// list, including dev build notes, ships in the public artifact and the page hides build notes behind a
// client-side filter (they are dev-facing, not confidential).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

/**
 * Normalize + validate a parsed changelog document into a newest-first entry list. Pure (no filesystem), so
 * the test suite can feed it fixtures. Throws on any malformed entry.
 * @param {{ entries?: unknown }} parsed
 * @returns {Array<{ version: string, build: number, date: string, type: 'release'|'build', title: string, notes: string[] }>}
 */
export function normalizeChangelog(parsed) {
  const raw = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const seenBuild = new Set();
  const out = [];
  for (const e of raw) {
    const version = String(e?.version || '').trim();
    const build = Math.floor(Number(e?.build));
    // js-yaml parses an unquoted YYYY-MM-DD as a YAML timestamp (a Date). Accept that defensively and format
    // it back to an ISO date (UTC), so a forgotten pair of quotes in the yml does not break the build.
    const date = e?.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e?.date || '').trim();
    const type = String(e?.type || '').trim();
    const title = String(e?.title || '').trim();
    if (!version) throw new Error(`changelog.yml: an entry is missing a version (build ${e?.build})`);
    if (!Number.isFinite(build) || build < 1) throw new Error(`changelog.yml: entry "${title}" needs a positive integer build (got "${e?.build}")`);
    if (seenBuild.has(build)) throw new Error(`changelog.yml: duplicate build number ${build}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`changelog.yml: entry "${title}" needs a YYYY-MM-DD date (got "${date}")`);
    if (type !== 'release' && type !== 'build') throw new Error(`changelog.yml: entry "${title}" type must be release or build (got "${type}")`);
    if (!title) throw new Error(`changelog.yml: the build ${build} entry needs a title`);
    const notes = Array.isArray(e?.notes) ? e.notes.map((n) => String(n || '').trim()).filter(Boolean) : [];
    seenBuild.add(build);
    out.push({ version, build, date, type, title, notes });
  }
  // Newest first: by build descending, then by date as a tiebreak (builds are unique, so this is stable).
  out.sort((a, b) => b.build - a.build || b.date.localeCompare(a.date));
  return out;
}

/** The highest build across a normalized list (what the extension indicator shows), or 0 if empty. */
export function currentBuildOf(entries) {
  return entries.reduce((max, e) => Math.max(max, e.build), 0);
}

/** The version of the newest entry, or an empty string if the list is empty. */
export function currentVersionOf(entries) {
  return entries.length ? entries[0].version : '';
}

let cache = null;

function load() {
  if (cache) return cache;
  const file = path.resolve(process.cwd(), 'house', 'changelog.yml');
  const parsed = yaml.load(fs.readFileSync(file, 'utf8'));
  cache = normalizeChangelog(parsed);
  return cache;
}

/** Every changelog entry, newest first (releases and builds). Reads house/changelog.yml. */
export function allEntries() {
  return load();
}

/** Only the official releases, newest first. */
export function releases() {
  return load().filter((e) => e.type === 'release');
}

/** The highest build number across all entries (what the extension indicator shows), or 0 if empty. */
export function currentBuild() {
  return currentBuildOf(load());
}

/** The version of the newest entry (the current line), or an empty string if empty. */
export function currentVersion() {
  return currentVersionOf(load());
}
