// sow-109: the install steps a skill page shows, one set per tool (house/skill-install.yml). Owner, 2026-09-29:
// "we expect GPT skills too (maybe openclaw, paperclip, etc). So we need broad support based on the model the skill
// is being created for."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import { skillInstallEntries, skillInstallProblems, skillNameFrom, installTabsFor, codeRuns, fillName } from '../membership/skill-install.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => yaml.load(fs.readFileSync(new URL(rel, ROOT), 'utf8'));
const doc = read('house/skill-install.yml');
const aiToolsDoc = read('house/ai-tools.yml');

test('sow-109: the shipped steps file is well formed and every tool in it is a known AI tool', () => {
  assert.deepEqual(skillInstallProblems(doc, aiToolsDoc), []);
  assert.deepEqual(skillInstallEntries(doc).map((e) => e.key), ['claude-code', 'codex', 'openclaw']);
});

test('sow-109: the shipped steps are the ones checked against each tool\'s own docs on 2026-09-29', () => {
  const by = Object.fromEntries(skillInstallEntries(doc).map((e) => [e.key, e]));
  assert.equal(by['claude-code'].folder, '~/.claude/skills/{name}');
  assert.equal(by.codex.folder, '~/.agents/skills/{name}', 'learn.chatgpt.com/docs/build-skills: $HOME/.agents/skills');
  assert.equal(by.openclaw.folder, '~/.agents/skills/{name}', 'docs.openclaw.ai/tools/skills: ~/.agents/skills');
  assert.match(by.codex.run, /`\$\{name\}`/, 'a Codex skill is called with $ and its name');
  assert.match(by['claude-code'].run, /`\/\{name\}`/);
  assert.ok(!('paperclip' in by), 'Paperclip has no confirmed steps yet, so it has no entry');
});

test('sow-109: a skill gets one tab per tool it is made for, in its own order, with its name filled in', () => {
  const { tabs, without } = installTabsFor({ targets: ['Codex', 'Claude Code', 'Paperclip'], name: 'farley', doc, aiToolsDoc });
  assert.deepEqual(tabs.map((t) => t.label), ['Codex', 'Claude Code']);
  assert.deepEqual(without, ['Paperclip'], 'a tool with no steps is reported, not silently dropped');
  assert.equal(tabs[0].mkdir, 'mkdir -p ~/.agents/skills/farley');
  assert.deepEqual(tabs[0].run.find((r) => r.code), { code: true, text: '$farley' });
  assert.equal(tabs[1].mkdir, 'mkdir -p ~/.claude/skills/farley');
  // sow-449: the This project folder, for the All projects / This project switch
  assert.equal(tabs[1].localFolder, '.claude/skills/farley');
  assert.equal(tabs[1].localMkdir, 'mkdir -p .claude/skills/farley');
  assert.equal(tabs[0].localMkdir, 'mkdir -p .agents/skills/farley');
});

test('sow-109: without a usable name there are no steps to fill in, so every tool is reported', () => {
  const { tabs, without } = installTabsFor({ targets: ['Claude Code'], name: '', doc, aiToolsDoc });
  assert.deepEqual(tabs, []);
  assert.deepEqual(without, ['Claude Code']);
});

test('sow-109: the skill name comes from SKILL.md and must be safe to put in a path or a command', () => {
  assert.equal(skillNameFrom('---\nname: farley\ndescription: x\n---\n# body'), 'farley');
  assert.equal(skillNameFrom('---\nname: "grok"\n---\n'), 'grok');
  assert.equal(skillNameFrom('---\nname: ../../etc\n---\n'), '', 'a path is refused');
  assert.equal(skillNameFrom('---\nname: a b; rm -rf\n---\n'), '', 'a command is refused');
  assert.equal(skillNameFrom('no frontmatter'), '');
});

test('sow-109: a broken steps file is refused in plain words', () => {
  const bad = { tools: { 'claude-code': { folder: '~/.claude/skills', run: 'x' }, madeup: { folder: '~/{name}', run: 'y' }, codex: { folder: '~/.agents/skills/{name}' } } };
  const p = skillInstallProblems(bad, aiToolsDoc).join('\n');
  assert.match(p, /"claude-code" folder must contain \{name\}/);
  assert.match(p, /"madeup" is not a tool in house\/ai-tools\.yml/);
  assert.match(p, /"codex" has no run step/);
  assert.match(skillInstallProblems({}, aiToolsDoc)[0], /lists no tools/);
});

test('sow-109: code runs and name filling are plain text operations', () => {
  assert.deepEqual(codeRuns('Start Codex and type `$x`. Done.'), [{ code: false, text: 'Start Codex and type ' }, { code: true, text: '$x' }, { code: false, text: '. Done.' }]);
  assert.equal(fillName('a/{name}/b/{name}', 'q'), 'a/q/b/q');
});
