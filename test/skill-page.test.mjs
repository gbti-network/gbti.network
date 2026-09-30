// sow-109 Phase 3: a skill's page on the website, and prompts told apart from skills in the directory and on cards.
//
// The install box and the skill file are built by src/lib/skill-page.mjs, so the published page and the workbench
// preview draw the same markup; those builders are exercised here. The page, the directory and the cards are Astro,
// which no unit test can render, so their wiring is pinned by source. Driven in a real browser before shipping: tab
// clicks and arrow keys, the remembered tool across a reload, Copy of the folder command and of SKILL.md, and a
// Download whose bytes equal the committed file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import { buildSkillInstallHtml, buildSkillFileHtml, sharedFolderNote, withoutNote, SKILL_SHELL } from '../src/lib/skill-page.mjs';
import { installTabsFor } from '../membership/skill-install.mjs';

const ROOT = new URL('../', import.meta.url);
const src = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const doc = yaml.load(src('house/skill-install.yml'));
const aiToolsDoc = yaml.load(src('house/ai-tools.yml'));
const tabsFor = (targets, name = 'farley') => installTabsFor({ targets, name, doc, aiToolsDoc });

test('sow-109: a skill made for several tools gets a tab per tool, the first one open', () => {
  const { tabs, without } = tabsFor(['Claude Code', 'Codex', 'OpenClaw', 'Paperclip']);
  const html = buildSkillInstallHtml({ tabs, without, fileHref: '/prompts/farley/SKILL.md' });
  assert.match(html, /role="tablist"/);
  assert.deepEqual([...html.matchAll(/data-skill-tool="([a-z-]+)"/g)].map((m) => m[1]), ['claude-code', 'codex', 'openclaw']);
  assert.deepEqual([...html.matchAll(/aria-selected="(true|false)"/g)].map((m) => m[1]), ['true', 'false', 'false']);
  // Only the first panel ships open; the rest are hidden until chosen.
  const panels = [...html.matchAll(/<div class="skill-panel" id="skill-panel-([a-z-]+)"[^>]*>/g)];
  assert.deepEqual(panels.map((m) => [m[1], / hidden>$/.test(m[0])]), [['claude-code', false], ['codex', true], ['openclaw', true]]);
  assert.match(html, /data-skill-copy-text="mkdir -p ~\/\.agents\/skills\/farley"/);
  assert.match(html, /<code>\$farley<\/code>/, "Codex's run step shows its command as code");
  assert.match(html, /href="\/prompts\/farley\/SKILL\.md" download="SKILL\.md"/);
  assert.match(html, /Also made for Paperclip\. Its install steps are not listed here yet/, 'a tool with no steps is named, not dropped');
});

test('sow-109: two tools that read one folder say so, so a reader does not install twice', () => {
  const { tabs } = tabsFor(['Claude Code', 'Codex', 'OpenClaw']);
  const [claude, codex, openclaw] = tabs;
  assert.equal(sharedFolderNote(claude, tabs), '', 'Claude Code has its own folder');
  assert.equal(sharedFolderNote(codex, tabs), 'OpenClaw reads this folder too, so one copy serves both.');
  assert.equal(sharedFolderNote(openclaw, tabs), 'Codex reads this folder too, so one copy serves both.');
  const three = [{ label: 'A', folder: 'x' }, { label: 'B', folder: 'x' }, { label: 'C', folder: 'x' }];
  assert.equal(sharedFolderNote(three[0], three), 'B and C read this folder too, so one copy serves them all.');
});

test('sow-109: one tool needs no tabs, and no tool with steps means no box at all', () => {
  const one = buildSkillInstallHtml(tabsFor(['Claude Code']));
  assert.ok(!one.includes('role="tablist"'), 'a single tool is not a choice');
  assert.match(one, /<p class="skill-tools-label">For Claude Code<\/p>/);
  assert.ok(!/ hidden>/.test(one), 'its only panel is open');
  assert.equal(buildSkillInstallHtml(tabsFor(['Paperclip'])), '', "the author's own text is the instructions then");
  assert.equal(buildSkillInstallHtml(tabsFor(['Claude Code'], '')), '', 'no usable name, no steps to fill in');
  assert.equal(withoutNote([]), '');
  assert.equal(withoutNote(['A', 'B']), "Also made for A and B. Their install steps are not listed here yet, so follow the author's notes below.");
});

test('sow-109: nothing interpolated is trusted as markup', () => {
  const tabs = [{ key: 'x', label: '<b>X</b>', folder: 'f', mkdir: 'mkdir -p "<f>"', run: [{ code: true, text: '<script>' }], local: [] }];
  const html = buildSkillInstallHtml({ tabs, without: ['<i>Y</i>'], fileHref: '/a"b' });
  assert.ok(!html.includes('<b>') && !html.includes('<script>') && !html.includes('<i>'));
  assert.match(html, /For &lt;b&gt;X&lt;\/b&gt;/);
  assert.match(html, /href="\/a&quot;b"/);
  const file = buildSkillFileHtml({ text: '---\nname: x\n---\n<script>alert(1)</script> & more' });
  assert.match(file, /<pre class="prompt-raw" data-skill-raw>---\nname: x\n---\n&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more<\/pre>/);
  assert.match(file, /data-open="false"/, 'the file starts collapsed');
  assert.match(file, /aria-expanded="false">Show the whole file</);
});

test('sow-109: the skill page renders the box, the author text and the file, and a prompt page is unchanged', () => {
  const page = src('src/pages/prompts/[slug].astro');
  assert.match(page, /const skillFile = isSkill && !stub \? skillFileOf\(prompt\) : null;/, 'a members-only skill keeps the prompt layout');
  assert.match(page, /buildSkillInstallHtml\(\{ \.\.\.install, fileHref: `\/prompts\/\$\{d\.slug\}\/SKILL\.md` \}\)/);
  assert.match(page, /\{skillView \? \(\s*<>\s*<Fragment set:html=\{installHtml\} \/>\s*<div class="skill-notes" data-gbti-region="body">/);
  assert.match(page, /<Fragment set:html=\{skillFileHtml\} \/>\s*<\/>\s*\) : \(/);
  assert.match(page, /\{isSkill \? 'Made for' : 'Works with'\}/);
  assert.match(page, /<span class=\{`kind-badge kind-\$\{d\.kind\}`\}>/, 'every prompt page says which it is');
  assert.match(page, /^\s*wireSkillPage\(document\);/m);
  for (const cls of Object.values(SKILL_SHELL)) assert.match(src('src/styles/prompt-kind.css'), new RegExp(`\\.${cls}\\b`), `.${cls} has styles`);
});

test('sow-109: the skill file is served only for a published, public skill', () => {
  const ep = src('src/pages/prompts/[slug]/SKILL.md.ts');
  assert.match(ep, /\.filter\(\(p\) => p\.data\.kind === 'skill' && isPublic\(p\)\)/);
  assert.match(ep, /return file \? \[\{ params: \{ slug: p\.data\.slug \}, props: \{ text: file\.text \} \}\] : \[\];/);
  assert.match(src('src/lib/content-gating.mjs'), /return d\.status === 'published' && d\.visibility === 'public';/, 'isPublic still means published and public');
});

test('sow-109: the directory filters by kind, and an old ?cat=skill link opens the Skills view', () => {
  const s = src('src/pages/prompts/index.astro');
  assert.match(s, /data-kind-val="all"/);
  assert.match(s, /data-kind-val="prompt"/);
  assert.match(s, /data-kind-val="skill"/);
  assert.match(s, /if \(show && kind !== 'all'\) show = c\.getAttribute\('data-kind'\) === kind;/);
  // The old link is mapped BEFORE the category handling, or it would reach the "category not found" notice.
  const map = s.indexOf("if (cat === 'skill') {");
  assert.ok(map > 0 && map < s.indexOf('if (cat && allCatKeys[cat]) {'));
  assert.ok(s.indexOf('if (kindParam) setKind(kindParam, false);') > s.indexOf('if (target && targetItems'));
  assert.match(s, /<p class="ps-label">Works with<\/p>/);
  assert.match(src('src/components/prompts/PromptCard.astro'), /data-kind=\{d\.kind\}/, 'the filter reads the card');
});

test('sow-109: every card that shows a prompt says prompt or skill', () => {
  for (const f of ['src/components/prompts/PromptCard.astro', 'src/components/home/HomePromptCard.astro']) {
    assert.match(src(f), /<span class=\{`kind-badge kind-\$\{d\.kind\}`\}>/, f);
  }
  const items = src('src/lib/feed-items.ts');
  assert.match(items, /promptKind: kind === 'prompt' \? d\.kind : undefined,/);
  assert.match(items, /return it\.kind === 'prompt' && it\.promptKind === 'skill' \? 'skill' : it\.kind;/);
  assert.match(src('src/components/feeds/FeedCard.astro'), /data-kind=\{it\.kind\}/, "the feed's type filter still reads 'prompt' for a skill");
  assert.match(src('src/components/feeds/FeedCard.astro'), /kt-\$\{typeWord\(it\)\}/);
});
