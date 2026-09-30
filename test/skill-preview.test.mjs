// sow-425: the WorkBench Preview showed a skill as a prompt page (no install box, the body in a prompt block). A skill
// now previews as the page it publishes as: the SKILL label, the install box built from /skill-install.json and the
// draft's own file, the author's text, and "The skill file". Driven here against a stand-in document, and in a browser
// for the layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillSkillPreview } from '../src/lib/preview-shells.mjs';
import { _resetSkillSteps } from '../client-ui/src/skill-reader.mjs';
import { previewSource } from './lib/preview-source.mjs';

const FILE = '---\nname: qa\ndescription: Ask first.\n---\n# /qa <b>\n';
const TOOLS = { tools: [
  { key: 'claude-code', label: 'Claude Code', folder: '~/.claude/skills/{name}', run: 'Open Claude Code and type `/{name}`.' },
  { key: 'codex', label: 'Codex', folder: '~/.agents/skills/{name}', run: 'Start Codex and type `${name}`.' },
] };
const stepsFetch = (ok = true) => { const calls = []; const f = async (url) => { calls.push(String(url)); return ok ? { ok: true, json: async () => TOOLS } : { ok: false, status: 503, json: async () => ({}) }; }; f.calls = calls; return f; };
function fakeDoc() {
  const slots = { '[data-pv-skill-box]': { html: null, removed: false }, '[data-pv-skill-file]': { html: null, removed: false } };
  const el = (k) => ({ set outerHTML(v) { slots[k].html = v; }, remove() { slots[k].removed = true; } });
  return { slots, querySelector: (s) => (s in slots ? el(s) : null), querySelectorAll: () => [] };
}
const box = (d) => d.slots['[data-pv-skill-box]'];
const file = (d) => d.slots['[data-pv-skill-file]'];

test('a skill draft with its file previews the install box and the file', async () => {
  _resetSkillSteps();
  const doc = fakeDoc(); const f = stepsFetch();
  assert.equal(await fillSkillPreview(doc, { fm: { targets: ['Claude Code', 'Codex'] }, skillFile: FILE, site: 'https://x', fetchImpl: f }), true);
  assert.deepEqual(f.calls, ['https://x/skill-install.json']);
  assert.match(box(doc).html, /data-skill-install/);
  assert.match(box(doc).html, /mkdir -p ~\/\.claude\/skills\/qa/, 'the name comes from the file');
  assert.match(box(doc).html, /Codex/, 'a tab for each tool it is made for');
  assert.match(file(doc).html, /The skill file/);
  assert.match(file(doc).html, /# \/qa &lt;b&gt;/, 'the file is shown escaped');
});

test('with no file anywhere, the preview shows the author\'s text only', async () => {
  _resetSkillSteps();
  const doc = fakeDoc(); const f = stepsFetch();
  assert.equal(await fillSkillPreview(doc, { fm: { targets: ['Claude Code'] }, skillFile: '  ', site: 'https://x', fetchImpl: f }), false);
  assert.equal(box(doc).removed, true);
  assert.equal(file(doc).removed, true);
  assert.deepEqual(f.calls, [], 'no steps fetched for nothing');
});

test('a committed draft reads the file beside it', async () => {
  _resetSkillSteps();
  const doc = fakeDoc(); let asked = 0;
  await fillSkillPreview(doc, { fm: { targets: ['Claude Code'] }, readSkillFile: async () => { asked += 1; return FILE; }, site: 'https://x', fetchImpl: stepsFetch() });
  assert.equal(asked, 1);
  assert.match(file(doc).html, /The skill file/);
  const sent = fakeDoc(); let unused = 0;
  await fillSkillPreview(sent, { fm: {}, skillFile: FILE, readSkillFile: async () => { unused += 1; return 'other'; }, site: 'https://x', fetchImpl: stepsFetch() });
  assert.equal(unused, 0, 'the draft\'s own file wins');
});

test('if the steps cannot load, the file still shows and no wrong box is drawn', async () => {
  _resetSkillSteps();
  const doc = fakeDoc();
  await fillSkillPreview(doc, { fm: { targets: ['Claude Code'] }, skillFile: FILE, site: 'https://x', fetchImpl: stepsFetch(false) });
  assert.equal(box(doc).removed, true);
  assert.match(file(doc).html, /The skill file/);
});

test('the preview wires it: a skill is not wrapped in the prompt block, and the page passes the draft\'s file', () => {
  const shells = readFileSync(new URL('../src/lib/preview-shells.mjs', import.meta.url), 'utf8');
  assert.match(shells, /if \(isSkill && povw\?\.parentElement\) \{[\s\S]*?void fillSkillPreview\(document, \{ fm, skillFile, readSkillFile \}\);\n    \} else if \(povw\?\.parentElement\) \{\n      povw\.insertAdjacentHTML\('beforebegin', buildPromptBlockHtml/);
  assert.match(shells, /const kindBadge = isSkill \?/);
  assert.match(shells, /!fm\.encryptedSkill \?/, 'a members-only skill\'s file is never fetched in the clear');
  assert.match(previewSource(), // the page plus src/lib/preview-page.ts, where the call now lives
    /applyPreviewShell\(document, \{ type, fm, slug, cats, labels, catPath, hero, esc, asset, itemPath, skillFile: draft\.skillFile, signupBase: base, ref: contentSha \|\| '' \}\);/);
});
