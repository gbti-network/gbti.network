// sow-109 / sow-424: every prompt item says whether it is a prompt or a skill. Required on every item (owner,
// 2026-09-29), so a skill saved without it cannot quietly show as a prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { promptKindProblems, PROMPT_KINDS } from '../membership/prompt-kind.mjs';
import { promptSchema } from '../client/src/schemas.mjs';
import { buildContentFile } from '../client/src/content-ops.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

function prompts() {
  const out = [];
  for (const m of fs.readdirSync(path.join(ROOT, 'members'))) {
    const dir = path.join(ROOT, 'members', m, 'prompts');
    if (!fs.existsSync(dir)) continue;
    for (const slug of fs.readdirSync(dir)) {
      const file = path.join(dir, slug, 'index.md');
      if (!fs.existsSync(file)) continue;
      const fm = yaml.load(fs.readFileSync(file, 'utf8').split('\n---')[0].replace(/^---\n/, ''));
      out.push({ file: path.relative(ROOT, file), fm });
    }
  }
  return out;
}

test('sow-424: every prompt item we ship states its kind, and every skill names its tools', () => {
  const all = prompts();
  assert.ok(all.length >= 27, `only ${all.length} prompt items found, so this proves little`);
  for (const { file, fm } of all) assert.deepEqual(promptKindProblems(fm), [], file);
  const skills = all.filter((p) => p.fm.kind === 'skill').map((p) => p.fm.slug).sort();
  assert.deepEqual(skills, [
    'ci-health-check-skill-for-claude-code', 'farley-file-skill-for-claude-code', 'grok-skill-for-claude-code',
    'kimi2-skill-for-claude-code', 'qa-skill-for-claude-code-and-codex', 'scope-of-work-manager-claude-code-skill',
  ]);
});

test('sow-109: a missing, unknown or tool-less kind is refused in plain words', () => {
  assert.match(promptKindProblems({ targets: ['ChatGPT'] })[0], /kind is missing/);
  assert.match(promptKindProblems({ kind: 'agent' })[0], /not one of: prompt, skill/);
  assert.match(promptKindProblems({ kind: 'skill', targets: [] })[0], /must name the tools it is made for/);
  assert.match(promptKindProblems({ kind: 'skill' })[0], /must name the tools/);
  assert.deepEqual(promptKindProblems({ kind: 'prompt' }), [], 'a prompt may leave targets empty');
  assert.deepEqual(promptKindProblems({ kind: 'skill', targets: ['Claude Code'] }), []);
  assert.deepEqual(PROMPT_KINDS, ['prompt', 'skill']);
});

test('sow-109: the content check runs the rule on every prompt, in the branch a prompt reaches', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/validate-content.mjs'), 'utf8');
  const call = src.indexOf("if (type === 'prompt') for (const problem of promptKindProblems(fm))");
  assert.ok(call > 0, 'the rule is called');
  const branch = src.indexOf("if (type === 'post' || type === 'project' || type === 'prompt' || type === 'applet') {");
  const other = src.indexOf("} else if (type === 'comment' || type === 'share') {", branch);
  assert.ok(branch > 0 && call > branch && call < other, 'the call sits in the post/project/prompt branch');
});

test('sow-109: the site schema requires kind, and a file the authoring tools build always carries it', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'src/content.config.ts'), 'utf8');
  assert.match(cfg, /kind: z\.enum\(\['prompt', 'skill'\]\),/, 'required in the site schema (no default)');
  assert.match(cfg, /pattern: \['members\/\*\/prompts\/\*\/index\.md'/, 'the prompt reader names index.md only');
  // An older client or an agent sends no kind: the file still states one.
  const built = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 't', shortDescription: 'd', status: 'draft' }, body: 'x' });
  assert.match(built.markdown ?? built.content ?? '', /\nkind: prompt\n/);
  const skill = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 't', shortDescription: 'd', status: 'draft', kind: 'skill', targets: ['Claude Code'] }, body: 'x' });
  assert.match(skill.markdown ?? skill.content ?? '', /\nkind: skill\n/);
  assert.equal(promptSchema.safeParse({ title: 'T', slug: 't', shortDescription: 'd', author: 'a', kind: 'other' }).success, false);
});

test('sow-109: the content validator stays under the 900-line cap, with the house settings checks in their own file', () => {
  // sow-109 took scripts/validate-content.mjs past 900 lines. The house/*.yml checks moved, unchanged, to
  // scripts/lib/validate-house-config.mjs (every function byte-identical, the same output on the real tree and on
  // broken settings files). This keeps both halves under the cap and keeps the call where the checks always ran.
  for (const f of ['scripts/validate-content.mjs', 'scripts/lib/validate-house-config.mjs']) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').length;
    assert.ok(lines <= 900, `${f} is ${lines} lines; the cap is 900`);
  }
  const src = fs.readFileSync(path.join(ROOT, 'scripts/validate-content.mjs'), 'utf8');
  assert.match(src, /^validateHouseConfig\(\{ root: ROOT, errors, aiToolsDoc: AI_TOOLS_DOC, licensesDoc: LICENSES_DOC \}\);$/m);
  assert.ok(src.indexOf('validateHouseConfig({') < src.lastIndexOf('if (errors.length) {'), 'the settings checks report before the verdict');
});
