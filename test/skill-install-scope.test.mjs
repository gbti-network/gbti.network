// sow-449 (owner, 2026-10-08): the install box switches between All projects (the home folder) and This project (a
// folder inside the project), remembered like the tool; and a short description's `backticks` show as inline code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { installTabsFor, installTabsFromTools, skillInstallProblems, isProjectFolder } from '../membership/skill-install.mjs';
import { buildSkillInstallHtml, sharedFolderNote, SKILL_SCOPE_KEY, SKILL_TOOL_KEY } from '../src/lib/skill-page.mjs';
import { inlineCodeRuns, plainInline } from '../src/lib/inline-code.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const doc = yaml.load(read('house/skill-install.yml'));
const aiToolsDoc = yaml.load(read('house/ai-tools.yml'));
const tabsFor = (targets) => installTabsFor({ targets, name: 'qa', doc, aiToolsDoc }).tabs;

test('every tool on file keeps a one-project folder, inside the project, with {name}', () => {
  for (const [key, v] of Object.entries(doc.tools)) {
    if (v.local) assert.ok(isProjectFolder(v.local), `${key}: ${v.local}`);
  }
  assert.deepEqual(tabsFor(['Claude Code', 'Codex', 'OpenClaw']).map((t) => t.localMkdir), ['mkdir -p .claude/skills/qa', 'mkdir -p .agents/skills/qa', 'mkdir -p skills/qa']);
  assert.deepEqual(skillInstallProblems(doc, aiToolsDoc), [], 'the file as committed passes');
});

test('the check refuses a one-project value that is not a project folder', () => {
  const bad = (local) => skillInstallProblems({ tools: { 'claude-code': { folder: '~/.claude/skills/{name}', run: 'Type `/{name}`.', local } } }, aiToolsDoc);
  for (const v of ['Only want it in one project? Use `.claude/skills/{name}/` instead.', '~/.claude/skills/{name}', '/abs/{name}', '.claude/skills/qa']) {
    assert.ok(bad(v).some((p) => /local must be the one-project folder/.test(p)), v);
  }
  assert.deepEqual(bad('.claude/skills/{name}'), []);
  assert.deepEqual(bad(''), [], 'it stays optional');
});

test('the box: a switch and both step 1s for a tool with a project folder, neither for one without', () => {
  const html = buildSkillInstallHtml({ tabs: tabsFor(['Claude Code']) });
  assert.match(html, /<section class="skill-install" data-skill-install data-scope="all"/, 'All projects first');
  assert.match(html, /<span id="skill-scope-l-claude-code" class="skill-tools-label">Install for<\/span><div class="skill-tools" role="radiogroup" aria-labelledby="skill-scope-l-claude-code"><button type="button" role="radio" aria-checked="true" tabindex="0" data-skill-scope="all">All projects<\/button><button type="button" role="radio" aria-checked="false" tabindex="-1" data-skill-scope="project">This project<\/button>/);
  assert.match(html, /data-scope-only="all"><p class="skill-step-t">Make the skill's folder\.<\/p><div class="skill-cmd"><code>mkdir -p ~\/\.claude\/skills\/qa<\/code>/);
  assert.match(html, /data-scope-only="project"><p class="skill-step-t">In your project's folder, make the skill's folder\.<\/p><div class="skill-cmd"><code>mkdir -p \.claude\/skills\/qa<\/code><button [^>]*data-skill-copy-text="mkdir -p \.claude\/skills\/qa"/, 'its own command and Copy');
  assert.doesNotMatch(html, /Only want it in one|skill-local/, 'the old line is gone');
  const none = buildSkillInstallHtml({ tabs: installTabsFromTools({ tools: [{ key: 'x', label: 'X', folder: '~/.x/{name}', run: 'Run it.' }], targets: ['X'], name: 'qa' }).tabs });
  assert.doesNotMatch(none, /data-skill-scope|data-scope-only/, 'no project folder, no switch');
  assert.match(none, /<div class="skill-step"><p class="skill-step-t">Make the skill's folder\.<\/p>/, 'and its step 1 always shows');
});

test('the shared-folder note is worked out for each scope', () => {
  const tabs = tabsFor(['Codex', 'OpenClaw']);
  assert.equal(sharedFolderNote(tabs[0], tabs), 'OpenClaw reads this folder too, so one copy serves both.', 'both use ~/.agents/skills');
  assert.equal(sharedFolderNote(tabs[0], tabs, 'localFolder'), '', 'in a project they differ (.agents/skills and skills)');
  const html = buildSkillInstallHtml({ tabs });
  const codexProject = html.slice(html.indexOf('data-scope-only="project"'), html.indexOf('</li>', html.indexOf('data-scope-only="project"')));
  assert.doesNotMatch(codexProject, /reads this folder too/);
});

test('the switch is wired once for the whole box, remembered beside the tool', () => {
  const s = read('src/lib/skill-page.mjs');
  assert.equal(SKILL_SCOPE_KEY, 'gbti-skill-scope');
  assert.notEqual(SKILL_SCOPE_KEY, SKILL_TOOL_KEY);
  assert.match(s, /box\.dataset\.scope = v;\n\s*scopes\.forEach\(\(b\) => \{ const on = b\.dataset\.skillScope === v; b\.setAttribute\('aria-checked', on \? 'true' : 'false'\); b\.tabIndex = on \? 0 : -1; \}\);/);
  assert.match(s, /if \(remember\) \{ try \{ storage\?\.setItem\(SKILL_SCOPE_KEY, v\); \}/);
  assert.match(s, /b\.addEventListener\('click', \(\) => setScope\(b\.dataset\.skillScope, true\)\);/);
  assert.match(s, /if \(savedScope && scopes\.length\) setScope\(savedScope, false\);/);
  assert.match(s, /if \(v !== 'all' && v !== 'project'\) return;/, 'a stored value that is neither is ignored');
  for (const p of ['src/styles/prompt-kind.css', 'src/lib/skill-box-css.mjs']) {
    const css = read(p);
    assert.match(css, /\[data-skill-install\]\[data-scope="project"\] \[data-scope-only="all"\], \[data-skill-install\]:not\(\[data-scope="project"\]\) \[data-scope-only="project"\] \{ display: none; \}/, p);
    assert.match(css, /\.skill-tools button\[aria-selected="true"\], \.skill-tools button\[aria-checked="true"\] \{/, `${p}: the pill style`);
    assert.doesNotMatch(css, /\.skill-local/, `${p}: the old line's styles are gone`);
  }
  assert.match(read('client-ui/src/elements/gbti-skill-install-manager.mjs'), /Folder for one project only <span class="muted">\(optional\)<\/span><\/label>[\s\S]{0,200}placeholder="\.claude\/skills\/\{name\}"/);
});

test('a short description: paired backticks become code, nothing else is Markdown', () => {
  assert.deepEqual(inlineCodeRuns('`/qa` is an agent skill'), [{ code: true, text: '/qa' }, { code: false, text: ' is an agent skill' }]);
  assert.deepEqual(inlineCodeRuns('run `a` then `b`'), [{ code: false, text: 'run ' }, { code: true, text: 'a' }, { code: false, text: ' then ' }, { code: true, text: 'b' }]);
  assert.deepEqual(inlineCodeRuns('an unpaired ` stays'), [{ code: false, text: 'an unpaired ` stays' }]);
  assert.deepEqual(inlineCodeRuns('`a` and a stray `'), [{ code: true, text: 'a' }, { code: false, text: ' and a stray `' }]);
  assert.deepEqual(inlineCodeRuns('empty `` stays'), [{ code: false, text: 'empty `` stays' }]);
  assert.deepEqual(inlineCodeRuns('**bold** [x](y)'), [{ code: false, text: '**bold** [x](y)' }]);
  assert.deepEqual(inlineCodeRuns(null), []);
  assert.equal(plainInline('`/qa` is a skill'), '/qa is a skill');
  const c = read('src/components/InlineCode.astro');
  assert.match(c, /\{runs\.map\(\(r\) => \(r\.code \? <code class="inline-code">\{r\.text\}<\/code> : r\.text\)\)\}/, 'Astro escapes every run');
  assert.doesNotMatch(c, /set:html/);
});

test('every place a prompt or project short description shows uses it, and the project page description is plain', () => {
  for (const [p, re] of [
    ['src/pages/prompts/[slug].astro', /<p class="lead mt20" style="max-width:70ch"><InlineCode text=\{d\.shortDescription \|\| d\.exampleOutput\} \/><\/p>/],
    ['src/components/home/HomePromptCard.astro', /<p class="hpc-desc"><InlineCode text=\{d\.shortDescription\} \/><\/p>/],
    ['src/components/projects/ProjectCard.astro', /<InlineCode text=\{d\.shortDescription\} \/><\/p>/],
    ['src/components/projects/FeaturedProject.astro', /<p class="lead"><InlineCode text=\{p\.data\.shortDescription \?\? ''\} \/><\/p>/],
    ['src/pages/projects/[slug].astro', /<p class="pd-pitch"><InlineCode text=\{d\.shortDescription\} \/><\/p>/],
    ['src/pages/projects/[slug].astro', /<p class="pd-gate-sub"><InlineCode text=\{d\.shortDescription\} \/><\/p>/],
    ['src/pages/projects/[slug].astro', /<BaseLayout title=\{d\.title\} description=\{plainInline\(d\.shortDescription\)\} /],
    ['src/components/feeds/FeedCard.astro', /<p class="feed-ex"><InlineCode text=\{it\.excerpt\} \/><\/p>/],
  ]) assert.match(read(p), re, p);
  assert.match(read('src/styles/gbti-v3.css'), /\.inline-code \{\n\s*font-family: var\(--f-mono\);/);
});
