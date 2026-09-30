// sow-109 Phase 6: Admin tools > Skill install, the Worker half. SUPERADMIN only: the install steps a skill page
// shows for each tool (house/skill-install.yml), and adding a tool to the list skills and prompts are made for
// (house/ai-tools.yml).
//
// Both writes are MULTI-FILE ops rather than CONFIG_OP rows, for two reasons the single-file path cannot meet:
//   - setting steps must check the tool against house/ai-tools.yml, a second file, so a key with no tool is refused
//     here instead of reddening the content check after the pull request merges;
//   - adding a tool edits house/ai-tools.yml as TEXT (one inserted line), because the config path re-serializes a
//     file and keeps only its top comment, and that file's grouping comments are for the people who maintain it.
// In its own file because membership-admin-author.mjs is past the size cap; that file only spreads these rows in.
//
// The rules themselves live in the node-free core (membership/skill-install-edits.mjs) and THROW; every build here
// catches them into a 400, because a thrown validator reaching the dispatch is the silent-200 failure sow-415 fixed.
import yaml from 'js-yaml';
import { authorizeSuperadmin } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { loadHouseYaml, leadingComment } from './membership-admin-author.mjs';
import { skillStepsInput, setSkillSteps, aiToolInput, addAiToolText, skillInstallPool } from '../../membership/skill-install-edits.mjs';
import { skillInstallProblems } from '../../membership/skill-install.mjs';
import { aiToolEntries } from '../../membership/ai-tools.mjs';

export const SKILL_INSTALL_PATH = 'house/skill-install.yml';
export const AI_TOOLS_PATH = 'house/ai-tools.yml';
export const SKILL_INSTALL_ACTIONS = Object.freeze(['skill-install-set', 'skill-install-tool-add']);

const bad = (message) => ({ response: { status: 400, body: { error: 'bad_request', message } } });
const failed = (load) => ({ response: { status: load.status, body: load.body } });

async function loadBoth({ fetchImpl, instToken, upstream }) {
  const [steps, tools] = await Promise.all([
    loadHouseYaml(fetchImpl, instToken, upstream, SKILL_INSTALL_PATH),
    loadHouseYaml(fetchImpl, instToken, upstream, AI_TOOLS_PATH),
  ]);
  return { steps, tools };
}

/** The steps file after an edit, with its top comment kept (its header says the admin screen keeps only that). */
const stepsFile = (load, next) => ({ path: SKILL_INSTALL_PATH, content: leadingComment(load.raw) + yaml.dump(next, { lineWidth: 100, noRefs: true }) });

/** skill-install-set: set or clear one tool's steps. */
export async function buildSkillInstallSet(payload, deps) {
  let args;
  try { args = skillStepsInput(payload); } catch (e) { return bad(e.message); }
  const { steps, tools } = await loadBoth(deps);
  if (!steps.ok) return failed(steps);
  if (!tools.ok) return failed(tools);
  const tool = aiToolEntries(tools.parsed).find((t) => t.key === args.key);
  // Clearing is allowed for a key the list no longer has: that is how a stale entry is removed.
  if (!tool && !args.clear) return bad(`"${args.key}" is not in the tool list, so no skill could be made for it. Add the tool first.`);
  const r = setSkillSteps(steps.parsed, args);
  if (!r.changed) return { response: { status: 200, body: { ok: true, noop: true, message: 'no change (those are already its steps)' } } };
  const problems = skillInstallProblems(r.next, tools.parsed);
  if (problems.length) return bad(`the steps file would fail the content check: ${problems[0]}`);
  const name = tool?.label ?? args.key;
  return { files: [stepsFile(steps, r.next)], slug: `skill-install-${args.key}`, title: `Skill install: ${args.clear ? 'clear' : 'set'} the ${name} steps` };
}

/** skill-install-tool-add: add a tool to the list, and optionally give it steps in the same pull request. */
export async function buildSkillInstallToolAdd(payload, deps) {
  let tool;
  try { tool = aiToolInput(payload); } catch (e) { return bad(e.message); }
  const wantsSteps = ['folder', 'run', 'local'].some((k) => typeof payload?.[k] === 'string' && payload[k].trim());
  let stepArgs = null;
  if (wantsSteps) {
    try { stepArgs = skillStepsInput({ key: tool.key, folder: payload.folder, run: payload.run, local: payload.local }); } catch (e) { return bad(e.message); }
  }
  const { steps, tools } = await loadBoth(deps);
  if (!steps.ok) return failed(steps);
  if (!tools.ok) return failed(tools);
  let raw;
  try { raw = addAiToolText(tools.raw, tool, tools.parsed); } catch (e) { return bad(e.message); }
  // The text edit must read back as the old list plus exactly this tool; anything else is refused, never committed.
  let back = null;
  try { back = yaml.load(raw); } catch { back = null; }
  const before = aiToolEntries(tools.parsed).map((t) => t.key);
  const after = aiToolEntries(back).map((t) => t.key);
  if (back?.tools?.[tool.key]?.label !== tool.label || after.length !== before.length + 1 || before.some((k) => !after.includes(k))) {
    return { response: { status: 500, body: { error: 'internal', message: 'the tool could not be added to the list cleanly, so nothing was saved' } } };
  }
  const files = [{ path: AI_TOOLS_PATH, content: raw }];
  if (stepArgs) {
    const r = setSkillSteps(steps.parsed, stepArgs);
    const problems = skillInstallProblems(r.next, back);
    if (problems.length) return bad(`the steps file would fail the content check: ${problems[0]}`);
    files.push(stepsFile(steps, r.next));
  }
  return { files, slug: `skill-install-tool-${tool.key}`, title: `Skill install: add ${tool.label}${stepArgs ? ' with its steps' : ''}` };
}

/** The MULTI_OP rows, ready to spread into the table; `rank` is the caller's ROLE_RANK.superadmin. */
export function skillInstallMultiOps(rank) {
  return {
    'skill-install-set': { rank, build: buildSkillInstallSet },
    'skill-install-tool-add': { rank, build: buildSkillInstallToolAdd },
  };
}

/**
 * The manager's READ: every tool in the list with its steps, from main. SUPERADMIN (cookie or bearer), read-only,
 * fail-closed; a GET carries no CSRF. Mirrors getSkillInstallPool in client/src/admin-ops.mjs, so the one element
 * renders the same on every host.
 */
export async function membershipAdminSkillInstallPool(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeSuperadmin, allowCookie = false,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  const who = await authorize(request, env, { ...deps, allowCookie });
  if (!who.ok) return { status: who.status, body: who.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const { steps, tools } = await loadBoth({ fetchImpl, instToken, upstream });
  if (!steps.ok) return { status: steps.status, body: steps.body };
  if (!tools.ok) return { status: tools.status, body: tools.body };
  return { status: 200, body: { ok: true, tools: skillInstallPool(steps.parsed, tools.parsed) } };
}
