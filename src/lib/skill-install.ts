// sow-109: the build-time reader for the per-tool install steps (house/skill-install.yml) and the tool list they are
// keyed against (house/ai-tools.yml). Read once per build; the logic lives in membership/skill-install.mjs so the
// extension reader, the admin screen and the tests use the same rules.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { skillInstallEntries, installTabsFor, skillNameFrom } from '../../membership/skill-install.mjs';
import { aiToolEntries } from '../../membership/ai-tools.mjs';

let cache: { doc: unknown; aiToolsDoc: unknown } | null = null;

function load() {
  if (cache) return cache;
  const read = (rel: string) => yaml.load(fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8'));
  // A file that cannot be read fails the build loudly: a skill page without its steps must not ship quietly.
  cache = { doc: read('house/skill-install.yml'), aiToolsDoc: read('house/ai-tools.yml') };
  return cache;
}

/** The install tabs for one skill, from its targets and the name its SKILL.md declares. */
export function skillInstallTabs(targets: string[], name: string) {
  const { doc, aiToolsDoc } = load();
  return installTabsFor({ targets, name, doc, aiToolsDoc });
}

/** Every tool with steps, with its label, for the public /skill-install.json the extension reads. */
export function skillInstallTools() {
  const { doc, aiToolsDoc } = load();
  const labels = new Map(aiToolEntries(aiToolsDoc).map((t: { key: string; label: string }) => [t.key, t.label]));
  return skillInstallEntries(doc).map((e: { key: string; folder: string; run: string; local: string }) => ({ ...e, label: labels.get(e.key) ?? e.key }));
}

/**
 * A skill's own file, SKILL.md beside its index.md, with the name it declares. Null when there is none, which is
 * the case for every prompt and for a members-only skill (its file never sits in the repository as plain text).
 */
export function skillFileOf(entry: { filePath?: string }): { text: string; name: string } | null {
  if (!entry.filePath) return null;
  const file = path.resolve(process.cwd(), path.dirname(entry.filePath), 'SKILL.md');
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  return { text, name: skillNameFrom(text) };
}
