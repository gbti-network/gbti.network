// sow-109 Phase 6: the superadmin edits behind Admin tools > Skill install. One tool's install steps are set or
// cleared in house/skill-install.yml, and a new tool can be added to house/ai-tools.yml at the same time.
//
// Node-free and pure, like the other house edit cores, so the Worker, the admin screen and the tests share one set of
// rules. The validators THROW on bad input and return the clean arguments; the Worker wraps them in fromCore.
//
// house/ai-tools.yml is edited as TEXT, one inserted line, never re-serialized. Its grouping comments ("Assistants and
// agents", "Image and media") and the reasoning at its top are for the people who maintain it, and a parse-and-dump
// would strip every one of them. house/skill-install.yml is the opposite: its header says the admin screen rewrites
// it and keeps only the top comment, which is what the Worker's config writer does.
import { aiToolEntries } from './ai-tools.mjs';
import { skillInstallEntries } from './skill-install.mjs';

export const SKILL_STEP_LIMITS = Object.freeze({ folder: 200, run: 400, local: 400, label: 40 });

/** A tool key, as house/ai-tools.yml writes them: lowercase letters, digits and dashes. */
export const TOOL_KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const DASHES = /[—–]/;

function text(v, field, { required, max }) {
  if (v === undefined || v === null) {
    if (required) throw new Error(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') throw new Error(`${field} must be text`);
  const s = v.trim();
  if (required && !s) throw new Error(`${field} is required`);
  if (s.length > max) throw new Error(`${field} is too long (at most ${max} characters)`);
  if (/[\r\n]/.test(s)) throw new Error(`${field} must be one line`);
  if (DASHES.test(s)) throw new Error(`${field} carries a long dash our writing conventions do not use; use a comma, a colon or a full stop`);
  return s;
}

/**
 * One tool's steps, from the admin screen. `{ key, clear: true }` removes the tool's steps (its skills then show the
 * author's own text); otherwise folder and run are required and the folder must hold {name}.
 */
export function skillStepsInput(p) {
  const key = typeof p?.key === 'string' ? p.key.trim() : '';
  if (!TOOL_KEY_RE.test(key)) throw new Error('a tool key is required (lowercase letters, digits and dashes)');
  if (p?.clear === true) return { key, clear: true };
  const folder = text(p?.folder, 'the folder', { required: true, max: SKILL_STEP_LIMITS.folder });
  if (!folder.includes('{name}')) throw new Error('the folder must contain {name}, where the skill\'s own name goes');
  const run = text(p?.run, 'how to run it', { required: true, max: SKILL_STEP_LIMITS.run });
  const local = text(p?.local, 'the one-project note', { required: false, max: SKILL_STEP_LIMITS.local });
  return { key, folder, run, ...(local ? { local } : {}) };
}

/** Set or clear one tool's steps. Returns { next, changed }; the other tools are untouched and keep their order. */
export function setSkillSteps(parsed, args) {
  const doc = parsed && typeof parsed === 'object' ? parsed : {};
  const tools = doc.tools && typeof doc.tools === 'object' && !Array.isArray(doc.tools) ? doc.tools : {};
  const prev = tools[args.key];
  const nextTools = { ...tools };
  if (args.clear) delete nextTools[args.key];
  else nextTools[args.key] = { folder: args.folder, run: args.run, ...(args.local ? { local: args.local } : {}) };
  const changed = JSON.stringify(prev ?? null) !== JSON.stringify(nextTools[args.key] ?? null);
  return { next: { ...doc, tools: nextTools }, changed };
}

/** The key a new tool's label becomes: `Claude Code` -> `claude-code`. Empty when nothing usable is left. */
export function toolKeyFor(label) {
  return String(label ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

/** A new tool, from the admin screen: its label as authors and readers see it, and the key it is filed under. */
export function aiToolInput(p) {
  const label = text(p?.label, 'the tool name', { required: true, max: SKILL_STEP_LIMITS.label });
  if (/[{}[\]#:,"\\]/.test(label)) throw new Error('the tool name may use letters, digits, spaces and . + - ( ) & \' only');
  const key = typeof p?.key === 'string' && p.key.trim() ? p.key.trim() : toolKeyFor(label);
  if (!TOOL_KEY_RE.test(key)) throw new Error('the tool name needs at least one letter or digit');
  return { key, label };
}

const ENTRY_LINE = /^ {2}[a-z0-9][a-z0-9-]*:\s/;

/**
 * house/ai-tools.yml with one tool added, as text. The line goes after the last entry of the FIRST group under
 * `tools:` (the assistants and agents), because a tool a skill is made for is an assistant or an agent. Refuses a
 * key or a label (in any letter case) that is already there, since the label is what content stores.
 */
export function addAiToolText(raw, { key, label }, aiToolsDoc) {
  const existing = aiToolEntries(aiToolsDoc);
  if (existing.some((t) => t.key === key)) throw new Error(`${label} is already in the tool list`);
  if (existing.some((t) => t.label.toLowerCase() === label.toLowerCase())) throw new Error(`${label} is already in the tool list`);
  const lines = String(raw ?? '').split('\n');
  const start = lines.findIndex((l) => /^tools:\s*$/.test(l));
  if (start < 0) throw new Error('house/ai-tools.yml has no tools: map to add to');
  let i = start + 1;
  while (i < lines.length && !ENTRY_LINE.test(lines[i])) i += 1; // the group's comment, if any
  if (i >= lines.length) throw new Error('house/ai-tools.yml lists no tools to add beside');
  while (i + 1 < lines.length && ENTRY_LINE.test(lines[i + 1])) i += 1;
  const safe = /^[A-Za-z0-9][A-Za-z0-9 .+()&'-]*$/.test(label) && !/ $/.test(label);
  const line = `  ${key}: { label: ${safe ? label : JSON.stringify(label)} }`;
  lines.splice(i + 1, 0, line);
  return lines.join('\n');
}

/**
 * The admin screen's view of the tools: every tool in the list, in file order, with its steps when it has any.
 * `[{ key, label, steps: { folder, run, local } | null }]`.
 */
export function skillInstallPool(doc, aiToolsDoc) {
  const steps = new Map(skillInstallEntries(doc).map((e) => [e.key, { folder: e.folder, run: e.run, local: e.local }]));
  return aiToolEntries(aiToolsDoc).map((t) => ({ key: t.key, label: t.label, steps: steps.get(t.key) ?? null }));
}
