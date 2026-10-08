// sow-109 Phase 4: prompts and skills told apart in the extension. The reader shows a public skill's install box (the
// website's own markup, steps and styles), every prompt item's badge says prompt or skill, the card chip says Skill,
// and the Prompts & Skills tab has the website's All / Prompts / Skills switch, remembered per browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import { SKILL_BOX_CSS, SKILL_TOKENS } from '../src/lib/skill-box-css.mjs';
import { installTabsFor, installTabsFromTools, skillInstallEntries } from '../membership/skill-install.mjs';
import { aiToolEntries } from '../membership/ai-tools.mjs';
import { loadSkillBox, promptSlugOf, _resetSkillSteps, SKILL_READER_CSS, READER_TOKEN_ALIASES } from '../client-ui/src/skill-reader.mjs';
import { promptKindCounts, filterPromptKind, normalizePromptKind, promptKindSwitchHtml, PROMPT_KIND_KEY } from '../client-ui/src/prompt-kind-filter.mjs';
import { toIndexItem } from '../src/lib/content-index.mjs';

const ROOT = new URL('../', import.meta.url);
const src = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const doc = yaml.load(src('house/skill-install.yml'));
const aiToolsDoc = yaml.load(src('house/ai-tools.yml'));
// What /skill-install.json serves (src/lib/skill-install.ts skillInstallTools): each entry with its label.
const labels = new Map(aiToolEntries(aiToolsDoc).map((t) => [t.key, t.label]));
const JSON_TOOLS = skillInstallEntries(doc).map((e) => ({ ...e, label: labels.get(e.key) }));

test('the website stylesheet carries the shared label and box rules verbatim, with the same colours', () => {
  const css = src('src/styles/prompt-kind.css');
  assert.ok(css.includes(SKILL_BOX_CSS), 'prompt-kind.css and skill-box-css.mjs have drifted apart; edit both together');
  const block = (sel) => {
    const i = css.indexOf(`${sel} {`);
    return Object.fromEntries([...css.slice(i, css.indexOf('}', i)).matchAll(/--([a-z-]+): ([^;]+);/g)].map((m) => [m[1], m[2]]));
  };
  assert.deepEqual(block(':root'), { ...SKILL_TOKENS.light });
  assert.deepEqual(block('[data-theme="dark"]'), { ...SKILL_TOKENS.dark });
});

test('every site token the shared rules read exists in the reader, by alias or by name', () => {
  const tokens = src('client-ui/src/tokens.mjs');
  const used = [...new Set([...SKILL_BOX_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
  const missing = used.filter((t) => !/^--(skill|kind)-/.test(t) && !READER_TOKEN_ALIASES.includes(`${t}:`) && !new RegExp(`${t}:`).test(tokens));
  assert.deepEqual(missing, []);
  assert.match(SKILL_READER_CSS, /^:host \{ --f-mono:/);
  assert.match(SKILL_READER_CSS, /:host-context\(\[data-theme="dark"\]\) \{ --kind-prompt-fg: #cdbcff;/);
});

test('the reader gets exactly the tabs the website shows, from the public steps list', () => {
  for (const targets of [['Claude Code'], ['Codex', 'Claude Code', 'OpenClaw', 'Paperclip'], ['Paperclip']]) {
    assert.deepEqual(installTabsFromTools({ tools: JSON_TOOLS, targets, name: 'farley' }), installTabsFor({ targets, name: 'farley', doc, aiToolsDoc }));
  }
  assert.deepEqual(installTabsFromTools({ tools: JSON_TOOLS, targets: ['Codex'], name: '../x' }).tabs, [], 'an unsafe name fills in nothing');
});

const fakeFetch = (routes) => async (url) => {
  const r = routes[url];
  if (r instanceof Error) throw r;
  // A real 404 has a body (the site's not-found page), so the check on `ok` is what keeps it out, not a thrown error.
  if (!r) return { ok: false, status: 404, json: async () => ({}), text: async () => '<!doctype html><title>Page not found</title>' };
  return { ok: true, status: 200, json: async () => r, text: async () => r };
};

test('a public skill loads its box and file; a missing file or a failed fetch shows no box', async () => {
  const site = 'https://example.test';
  const file = '---\nname: farley\ndescription: x\n---\n# Farley\n';
  _resetSkillSteps();
  const box = await loadSkillBox({ site, slug: 'farley-x', targets: ['Claude Code', 'Codex'], fileHref: () => 'blob:1', fetchImpl: fakeFetch({ [`${site}/skill-install.json`]: { tools: JSON_TOOLS }, [`${site}/prompts/farley-x/SKILL.md`]: file }) });
  assert.equal(box.text, file);
  assert.match(box.html, /data-skill-tool="claude-code"/);
  assert.match(box.html, /mkdir -p ~\/\.agents\/skills\/farley/);
  assert.match(box.html, /href="blob:1" download="SKILL\.md"/, 'Download saves a local copy, since a download link to another origin is ignored');
  _resetSkillSteps();
  assert.equal(await loadSkillBox({ site, slug: 'gone', targets: ['Claude Code'], fetchImpl: fakeFetch({ [`${site}/skill-install.json`]: { tools: JSON_TOOLS } }) }), null);
  _resetSkillSteps();
  assert.equal(await loadSkillBox({ site, slug: 'x', targets: ['Claude Code'], fetchImpl: fakeFetch({ [`${site}/skill-install.json`]: new Error('offline') }) }), null);
  assert.equal(await loadSkillBox({ site, slug: '', targets: ['Claude Code'], fetchImpl: fakeFetch({}) }), null);
  assert.equal(promptSlugOf('/prompts/farley-x/'), 'farley-x');
  assert.equal(promptSlugOf('/articles/x/'), '');
});

test('the reader: a kind badge on every prompt item, the box only for a public skill, no Copy prompt on a skill', () => {
  const r = src('client-ui/src/elements/gbti-reader.mjs');
  assert.match(r, /return \(it\.kind \|\| this\._fm\?\.kind\) === 'skill' \? 'skill' : 'prompt';/, 'a deep link reads the frontmatter');
  // sow-109 Phase 7: a members-only skill gets the box only from its ENCRYPTED file, through the Worker, never a public fetch.
  assert.match(r, /if \(String\(it\.visibility \|\| fm\.visibility \|\| 'public'\) !== 'public'\) \{[\s\S]{0,400}if \(typeof fm\.encryptedSkill !== 'string' \|\| !fm\.encryptedSkill \|\| typeof this\.client\?\.decrypt !== 'function'\) return null;[\s\S]{0,300}loadMembersSkillBox\(/, 'members-only: decrypted file or no box');
  assert.match(r, /<span class="badge kind-badge kind-\$\{kind\}">/);
  assert.match(r, /const copyAll = \(it\.type === 'prompt' && this\._rawBody && this\._kind\(it\) !== 'skill'\)/);
  assert.match(r, /\$\{meta\}\$\{cover\}\$\{body\}\$\{skillBox\}/, 'the box follows the author text, as on the site (sow-448)');
  assert.match(r, /if \(this\._skill\) wireSkillPage\(this\.root\);/);
  assert.match(r, /URL\.revokeObjectURL\(this\._skillUrl\)/, 'the previous local copy is released on the next open');
});

test('the Prompts & Skills switch counts, narrows and remembers', () => {
  const rows = [{ type: 'prompt', kind: 'skill' }, { type: 'prompt', kind: 'prompt' }, { type: 'prompt' }, { type: 'post' }];
  assert.deepEqual(promptKindCounts(rows), { all: 3, prompt: 2, skill: 1 }, 'an item without a kind is a prompt');
  assert.equal(filterPromptKind(rows, 'skill').length, 2, 'the skill, and the post passes through');
  assert.equal(filterPromptKind(rows, 'prompt').length, 3);
  assert.equal(filterPromptKind(rows, 'all'), rows);
  assert.equal(normalizePromptKind('nonsense'), 'all', 'a stale stored value never hides the tab');
  const html = promptKindSwitchHtml('skill', { all: 3, prompt: 2, skill: 1 });
  assert.match(html, /class="ks-btn on" aria-pressed="true" data-kind-val="skill">.*<span>Skills<\/span><span class="ks-n">1<\/span>/);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  const nt = src('extension/src/newtab.mjs');
  assert.match(nt, /renderKindSwitch\(TYPE === 'prompt' \? promptKindCounts\(rows\) : null\);\n\s*if \(TYPE === 'prompt'\) rows = filterPromptKind\(rows, PROMPT_KIND\);/);
  assert.match(nt, /localStorage\.setItem\(PROMPT_KIND_KEY, PROMPT_KIND\)/);
  assert.equal(PROMPT_KIND_KEY, 'gbti-prompt-kind');
  const page = src('extension/newtab.html');
  assert.match(page, /<div class="kind-switch" data-kinds role="group" aria-label="Show prompts, skills or both" hidden><\/div>/);
  assert.match(page, /\.kind-switch\[hidden\] \{ display: none; \}/, 'the display rule must not un-hide it');
});

test('the extension indexes carry a prompt item\'s kind and tools, and nothing new for other types', () => {
  const item = toIndexItem({ data: { slug: 's', title: 'T', author: 'a', kind: 'skill', targets: ['Codex'], categories: [] } }, 'prompt');
  assert.equal(item.kind, 'skill');
  assert.deepEqual(item.targets, ['Codex']);
  assert.equal(toIndexItem({ data: { slug: 's', title: 'T', author: 'a', categories: [] } }, 'prompt').kind, 'prompt');
  const post = toIndexItem({ data: { slug: 's', title: 'T', author: 'a', kind: 'skill', categories: [] } }, 'post');
  assert.ok(!('kind' in post) && !('targets' in post));
  assert.match(src('src/pages/activity-index.json.ts'), /\.\.\.promptFields\(p\.data\), \/\/ sow-109/);
});
