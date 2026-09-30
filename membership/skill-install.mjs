// sow-109: the install steps a skill page shows, one set per tool a skill can be made for (house/skill-install.yml).
//
// Owner, 2026-09-29: "we expect GPT skills too (maybe openclaw, paperclip, etc). So we need broad support based on
// the model the skill is being created for." So the box is not one Claude-only set of steps: a skill's `targets`
// (the tools it is made for, checked against house/ai-tools.yml) pick which tabs it shows, and each tab's steps
// come from here, written once by an admin rather than by every author.
//
// Every box has the same three steps, so an entry holds only what differs by tool:
//   folder   where the skill file goes, with {name} for the skill's own name (from its SKILL.md `name:` line)
//   run      how to start using it; `backticks` mark a command the page shows as code
//   local    optional: how to install it for one project only
// Step 1 is always "make the folder", step 2 is always "save SKILL.md into it".
//
// Node-free and pure over already-parsed documents, so the site build, the extension reader, the admin screen and
// the tests all read the steps the same way.

import { aiToolEntries } from './ai-tools.mjs';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** A skill's name as it may appear in a folder or a command: the same shape Claude Code and Codex accept. */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Every tool that has steps, as { key, folder, run, local }, in file order. An entry without a folder or run is dropped. */
export function skillInstallEntries(doc) {
  const tools = isObj(doc) ? doc.tools : null;
  if (!isObj(tools)) return [];
  const out = [];
  for (const [key, v] of Object.entries(tools)) {
    if (!isObj(v)) continue;
    const folder = str(v.folder);
    const run = str(v.run);
    if (!key || !folder || !run) continue;
    out.push({ key: String(key), folder, run, local: str(v.local) });
  }
  return out;
}

/** What is wrong with the steps file, as plain sentences (used by the content check and the admin save). */
export function skillInstallProblems(doc, aiToolsDoc) {
  const problems = [];
  const tools = isObj(doc) ? doc.tools : null;
  if (!isObj(tools)) return ['lists no tools (it needs a tools: map), so no skill page would show install steps'];
  const known = new Map(aiToolEntries(aiToolsDoc).map((t) => [t.key, t.label]));
  for (const [key, v] of Object.entries(tools)) {
    if (!known.has(key)) problems.push(`"${key}" is not a tool in house/ai-tools.yml, so no skill could ever be made for it`);
    if (!isObj(v)) { problems.push(`"${key}" needs folder and run`); continue; }
    if (!str(v.folder)) problems.push(`"${key}" has no folder`);
    else if (!str(v.folder).includes('{name}')) problems.push(`"${key}" folder must contain {name}, the skill's own name`);
    if (!str(v.run)) problems.push(`"${key}" has no run step`);
    for (const f of ['folder', 'run', 'local']) {
      if (/[—–]/.test(str(v[f]))) problems.push(`"${key}" ${f} carries a dash our writing conventions do not use`);
    }
  }
  return problems;
}

/** The `name:` a SKILL.md declares in its frontmatter, or '' when it has none that is safe to put in a path. */
export function skillNameFrom(skillMd) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(skillMd ?? ''));
  if (!m) return '';
  const line = m[1].split(/\r?\n/).find((l) => /^name:\s*/.test(l));
  const name = line ? line.replace(/^name:\s*/, '').replace(/^['"]|['"]$/g, '').trim() : '';
  return SKILL_NAME_RE.test(name) ? name : '';
}

/** A step's text with {name} filled in. */
export const fillName = (text, name) => String(text ?? '').split('{name}').join(name);

/** A step's text split into plain and `code` runs, so a page can render the code parts without a Markdown parser. */
export function codeRuns(text) {
  const out = [];
  const parts = String(text ?? '').split('`');
  parts.forEach((p, i) => { if (p) out.push({ code: i % 2 === 1, text: p }); });
  return out;
}

/**
 * The install tabs for one skill: one per target that has steps, in the order the skill lists them, each with its
 * steps filled in. Targets with no steps come back in `without`, so the page can say so rather than drop them.
 */
export function installTabsFor({ targets, name, doc, aiToolsDoc }) {
  const byLabel = new Map(aiToolEntries(aiToolsDoc).map((t) => [t.label, t.key]));
  const steps = new Map(skillInstallEntries(doc).map((e) => [e.key, e]));
  const tabs = [];
  const without = [];
  for (const label of Array.isArray(targets) ? targets : []) {
    const key = byLabel.get(label);
    const e = key ? steps.get(key) : null;
    if (!e || !name) { without.push(label); continue; }
    const folder = fillName(e.folder, name);
    tabs.push({
      key, label,
      folder,
      mkdir: `mkdir -p ${folder}`,
      run: codeRuns(fillName(e.run, name)),
      local: codeRuns(fillName(e.local, name)),
    });
  }
  return { tabs, without };
}
