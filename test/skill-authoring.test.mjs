// sow-109 Phase 5: authoring a skill. A skill's SKILL.md travels with every publish, draft, read-back and rename on both
// publishers (the website client and the npm / agent host), from one shared rule (client/src/skill-file.mjs); the
// Worker judges a SKILL.md by its item; and the editor offers the Prompt or Skill choice from the approved canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { planSkillFile, needsOldSkillFile, skillPathFor, skillFilesForPublish, skillFileBeside, MEMBERS_REFUSAL } from '../client/src/skill-file.mjs';
import { publish, saveDraft, readDraft, publishDraft, getContentItem, renameContent, authorContent } from '../client/src/operations.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';
import { applyDraftPut } from '../membership/member-drafts.mjs';
import { pathsNeedingApproval } from '../membership/hosted-author.mjs';
import { audienceRefusal } from '../workers/signup/membership-audience.mjs';
import { draftRecordForEditor } from '../src/lib/workbench-client-core.mjs';
import { madeForRows, toggleTarget, mainHeading, mainHeadingHtml, kindSectionHtml, skillSectionsHtml, skillFileFrom, siteFor, normalizeKind } from '../client-ui/src/editor-skill.mjs';
import { FIELDS } from '../client/src/form-fields.mjs';

const src = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const FILE = '---\nname: farley\ndescription: remembers people\n---\n# Farley\n';
const IDX = 'members/alice/prompts/farley/index.md';
const SK = 'members/alice/prompts/farley/SKILL.md';

test('the rule: write, keep, move, remove or refuse', () => {
  const plan = (a) => planSkillFile({ newIndexPath: IDX, ...a });
  assert.deepEqual(plan({ kind: 'skill', skillFile: FILE }), { files: [{ path: SK, content: FILE }], refusal: null }, 'a new skill writes its file');
  assert.match(plan({ kind: 'skill' }).refusal, /needs its skill file/, 'a new skill without one is refused');
  assert.match(plan({ kind: 'skill', skillFile: '---\nname: Bad Name\n---\n' }).refusal, /name: line/);
  assert.deepEqual(plan({ kind: 'skill', oldIndexPath: IDX, priorKind: 'skill' }).files, [], 'an edit that sends no file keeps the one it has');
  assert.deepEqual(plan({ kind: 'skill', skillFile: '   ', oldIndexPath: IDX, priorKind: 'skill' }).files, [], 'blank counts as not sent');
  assert.deepEqual(plan({ kind: 'skill', skillFile: FILE, oldIndexPath: IDX, priorKind: 'skill' }).files, [{ path: SK, content: FILE }]);
  const NEW = 'members/alice/prompts/farley-2/index.md';
  assert.deepEqual(planSkillFile({ kind: 'skill', newIndexPath: NEW, oldIndexPath: IDX, priorKind: 'skill', oldSkillText: FILE }).files,
    [{ path: skillPathFor(NEW), content: FILE }, { path: SK, content: null }], 'a rename carries the file and deletes the old one');
  assert.match(planSkillFile({ kind: 'skill', newIndexPath: NEW, oldIndexPath: IDX, priorKind: 'skill', oldSkillText: null }).refusal, /needs its skill file/,
    'a rename whose old file cannot be found is refused, never published without one');
  assert.deepEqual(planSkillFile({ kind: 'skill', skillFile: 'x\n' + FILE.replace('farley', 'farley2'), newIndexPath: NEW, oldIndexPath: IDX, priorKind: 'skill', oldSkillText: FILE }).refusal,
    planSkillFile({ kind: 'skill', skillFile: 'x', newIndexPath: NEW }).refusal, 'a file without frontmatter first is refused the same way anywhere');
  assert.deepEqual(plan({ kind: 'prompt', oldIndexPath: IDX, priorKind: 'skill', oldSkillText: FILE }).files, [{ path: SK, content: null }], 'a skill turned prompt loses its file');
  assert.deepEqual(plan({ kind: 'prompt', skillFile: FILE }).files, [], 'a prompt never writes one');
  assert.deepEqual(plan({ kind: 'prompt', oldIndexPath: IDX, priorKind: 'skill', oldSkillText: null }).files, [], 'only a file known to exist is deleted');
  assert.equal(plan({ kind: 'skill', visibility: 'members', skillFile: FILE }).refusal, MEMBERS_REFUSAL);
  assert.equal(plan({ kind: 'skill', visibility: 'members', oldIndexPath: IDX, priorKind: 'skill', oldSkillText: FILE }).refusal, MEMBERS_REFUSAL, 'switching to members-only never throws the file away');
  assert.deepEqual(plan({ kind: 'skill', visibility: 'members' }), { files: [], refusal: null }, 'a members-only skill with no plain file is fine');
});

test('the old file is read only when it has to move, go, or be checked', () => {
  assert.equal(needsOldSkillFile({ priorKind: 'skill', kind: 'skill', moved: false }), false);
  assert.equal(needsOldSkillFile({ priorKind: 'skill', kind: 'skill', moved: true }), true);
  assert.equal(needsOldSkillFile({ priorKind: 'skill', kind: 'prompt' }), true);
  assert.equal(needsOldSkillFile({ priorKind: 'skill', kind: 'skill', visibility: 'members' }), true);
  assert.equal(needsOldSkillFile({ priorKind: 'prompt', kind: 'prompt', moved: true }), false);
  assert.equal(needsOldSkillFile({ priorKind: undefined, kind: 'skill' }), false);
});

test('the shared step reads only what the plan needs, and never throws on a failed read', async () => {
  const reads = [];
  const readFile = async (p) => { reads.push(p); return FILE; };
  const built = { path: IDX, frontmatter: { kind: 'skill', visibility: 'public' } };
  assert.deepEqual((await skillFilesForPublish({ type: 'prompt', built, oldIndexPath: IDX, priorKind: 'skill', skillFile: FILE, readFile })).files, [{ path: SK, content: FILE }]);
  assert.deepEqual(reads, [], 'a plain edit does not read');
  assert.deepEqual(await skillFilesForPublish({ type: 'post', built, skillFile: FILE, readFile }), { files: [], refusal: null });
  const failing = async () => { throw new Error('offline'); };
  const r = await skillFilesForPublish({ type: 'prompt', built: { path: IDX, frontmatter: { kind: 'prompt' } }, oldIndexPath: IDX, priorKind: 'skill', readFile: failing });
  assert.deepEqual(r, { files: [], refusal: null }, 'a read that fails deletes nothing');
  assert.deepEqual(await skillFileBeside(IDX, { kind: 'skill' }, async () => FILE), { skillFile: FILE });
  assert.deepEqual(await skillFileBeside(IDX, { kind: 'prompt' }, async () => FILE), {});
  assert.deepEqual(await skillFileBeside('members/alice/posts/x/index.md', { kind: 'skill' }, async () => FILE), {}, 'only a prompt folder');
});

// ---- the npm / agent host, end to end against a fake network ----------------------------------------------------

const SKILL_MD = (extra = {}) => {
  const fm = { type: 'prompt', kind: 'skill', title: 'Farley', slug: 'farley', author: 'alice', status: 'published', visibility: 'public', publishedAt: '2026-07-02T00:00:00.000Z', shortDescription: 'remembers people', targets: ['Claude Code'], categories: ['ai', 'prompts'], ...extra };
  return `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `\n${v.map((x) => `  - ${x}`).join('\n')}` : JSON.stringify(v)}`).join('\n')}\n---\n\nThe page text.\n`;
};
const INPUT = { title: 'Farley', slug: 'farley', shortDescription: 'remembers people', targets: ['Claude Code'], categories: ['ai', 'prompts'], visibility: 'public' };

function network(drafts = []) {
  const authored = [];
  const draftWrites = [];
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetch = async (url, init = {}) => {
    const p = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    if (p === '/membership/author') { authored.push(body); return ok({ ok: true, number: 1, html_url: 'u', branch: 'b' }); }
    if (p === '/membership/drafts') { if (body) draftWrites.push(body); return ok({ ok: true, drafts }); }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, authored, draftWrites, files: () => authored.flatMap((a) => a.files) };
}
const ctxFor = (net, files = {}) => ({
  identity: () => ({ username: 'alice' }),
  getRepoClient: () => ({ upstream: 'gbti-network/gbti.network', async getFileContent(p) { return files[p] ?? null; } }),
  membership: async () => 'paid',
  reader: { readFile: async (rel) => files[rel] ?? null, get: async (_u, rel) => (files[rel] ? { path: rel, ...parseContentFile(files[rel]) } : null) },
  store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
  fetch: net.fetch,
});
const skillEntry = (net, p = SK) => net.files().find((f) => f.path === p);

test('npm publish: a new skill carries its file; one without a file is refused before anything is sent', async () => {
  const net = network();
  await publish(ctxFor(net), { type: 'prompt', input: { ...INPUT, kind: 'skill' }, body: 'The page text.', skillFile: FILE });
  assert.equal(skillEntry(net)?.content, FILE);
  const none = network();
  await assert.rejects(publish(ctxFor(none), { type: 'prompt', input: { ...INPUT, kind: 'skill' }, body: 'x' }), /needs its skill file/);
  assert.equal(none.authored.length, 0);
});

test('npm publish: an edit keeps the file, a new file replaces it, a rename moves it, a prompt drops it', async () => {
  const repo = { [IDX]: SKILL_MD(), [SK]: FILE };
  const keep = network();
  await publish(ctxFor(keep, repo), { type: 'prompt', input: INPUT, body: 'edited', path: IDX });
  assert.equal(skillEntry(keep), undefined, 'nothing about SKILL.md is sent');
  assert.equal(parseContentFile(keep.files().find((f) => f.path === IDX).content).frontmatter.kind, 'skill');

  const move = network();
  await publish(ctxFor(move, repo), { type: 'prompt', input: { ...INPUT, slug: 'farley-file' }, body: 'x', path: IDX });
  assert.equal(skillEntry(move, 'members/alice/prompts/farley-file/SKILL.md')?.content, FILE);
  assert.equal(skillEntry(move, SK)?.content, null, 'the old one is deleted in the same request');

  const drop = network();
  await publish(ctxFor(drop, repo), { type: 'prompt', input: { ...INPUT, kind: 'prompt' }, body: 'x', path: IDX });
  assert.equal(skillEntry(drop)?.content, null);

  const members = network();
  await assert.rejects(publish(ctxFor(members, repo), { type: 'prompt', input: { ...INPUT, visibility: 'members' }, body: 'x', path: IDX }), /members-only skill/);
});

test('npm drafts: the skill file is saved, read back and published with the draft', async () => {
  const net = network();
  await saveDraft(ctxFor(net), { type: 'prompt', input: { ...INPUT, kind: 'skill' }, body: 'x', skillFile: FILE });
  assert.equal(net.draftWrites.find((w) => w.op === 'put').draft.skillFile, FILE);
  const rec = { type: 'prompt', slug: 'farley', path: IDX, frontmatter: { ...INPUT, kind: 'skill' }, body: 'x', skillFile: FILE };
  assert.equal((await readDraft(ctxFor(network([rec])), { type: 'prompt', slug: 'farley' })).skillFile, FILE);
  const pub = network([rec]);
  await publishDraft(ctxFor(pub), { type: 'prompt', slug: 'farley' });
  assert.equal(skillEntry(pub)?.content, FILE);
  const viaAgent = network();
  await authorContent(ctxFor(viaAgent), { type: 'prompt', status: 'published', input: { ...INPUT, kind: 'skill' }, body: 'x', skillFile: FILE });
  assert.equal(skillEntry(viaAgent)?.content, FILE, 'the agent entry forwards it');
});

test('npm read-back and the standalone rename carry the skill file', async () => {
  const repo = { [IDX]: SKILL_MD(), [SK]: FILE };
  assert.equal((await getContentItem(ctxFor(network(), repo), { path: IDX })).skillFile, FILE);
  const net = network();
  await renameContent(ctxFor(net, repo), { path: IDX, newSlug: 'farley-file' });
  assert.equal(skillEntry(net, 'members/alice/prompts/farley-file/SKILL.md')?.content, FILE);
  assert.equal(skillEntry(net, SK)?.content, null);
});

test('the draft store keeps a skill file on the author-note terms, for prompts only', () => {
  const put = (state, d) => applyDraftPut(state, { type: 'prompt', slug: 'farley', frontmatter: {}, body: '', ...d }, { now: () => 't' });
  const s1 = put({}, { skillFile: FILE });
  assert.equal(s1.items['prompt:farley'].skillFile, FILE);
  assert.equal(put(s1, {}).items['prompt:farley'].skillFile, FILE, 'absent keeps it (the preview saves without it)');
  assert.ok(!('skillFile' in put(s1, { skillFile: '' }).items['prompt:farley']), 'an empty string clears it');
  const post = applyDraftPut({}, { type: 'post', slug: 'x', skillFile: FILE }, { now: () => 't' });
  assert.ok(!('skillFile' in post.items['post:x']));
  assert.equal(draftRecordForEditor({ skillFile: FILE }, 'alice').skillFile, FILE);
  assert.equal(draftRecordForEditor({}, 'alice').skillFile, null);
});

// ---- the Worker's audience rule ----------------------------------------------------------------------------------

test('the Worker judges SKILL.md by its item, never by its own frontmatter', async () => {
  const idx = (vis, extra = '') => `---\ntype: prompt\nkind: skill\nvisibility: ${vis}\n${extra}---\nbody\n`;
  const spoof = '---\nname: farley\nvisibility: members\n---\n# x\n';
  const P = 'members/alice/prompts/';
  assert.deepEqual(pathsNeedingApproval([{ path: SK, content: spoof }], 'alice'), [{ path: IDX, type: 'prompt', priorPaths: [] }], 'a members line in SKILL.md waves nothing through');
  assert.deepEqual(pathsNeedingApproval([{ path: IDX, content: idx('public') }, { path: SK, content: spoof }], 'alice'), [{ path: IDX, type: 'prompt', priorPaths: [] }], 'one entry per item');
  assert.deepEqual(pathsNeedingApproval([{ path: IDX, content: idx('members') }, { path: SK, content: FILE }], 'alice'), [{ path: IDX, type: 'prompt', priorPaths: [] }], 'a plain file beside a members-only index still needs the item approved');
  const rename = [{ path: `${P}farley-file/index.md`, content: idx('public', 'redirectFrom:\n  - /prompts/farley/\n') }, { path: `${P}farley-file/SKILL.md`, content: FILE }, { path: SK, content: null }];
  assert.deepEqual(pathsNeedingApproval(rename, 'alice'), [{ path: `${P}farley-file/index.md`, type: 'prompt', priorPaths: [IDX] }]);
  assert.deepEqual(pathsNeedingApproval([{ path: SK, content: null }], 'alice'), [], 'a delete publishes nothing');
  const membersRename = [{ path: `${P}farley-file/index.md`, content: idx('members', 'redirectFrom:\n  - /prompts/farley/\n') }, { path: `${P}farley-file/SKILL.md`, content: FILE }];
  assert.deepEqual(pathsNeedingApproval(membersRename, 'alice'), [{ path: `${P}farley-file/index.md`, type: 'prompt', priorPaths: [IDX] }], 'the item\'s own rename history counts for its file');

  const approved = new Set([IDX]);
  const check = async ({ paths }) => paths.every((p) => approved.has(p));
  const run = (files) => audienceRefusal({ files, folders: ['alice'], tier: 'member', approvedCheck: check });
  assert.equal(await run(rename), null, 'renaming an approved skill is allowed');
  assert.equal(await run([{ path: SK, content: spoof }]), null, 'editing the file of an approved skill is allowed');
  const fresh = [{ path: `${P}new/index.md`, content: idx('members') }, { path: `${P}new/SKILL.md`, content: spoof }];
  assert.equal((await run(fresh))?.status, 403, 'a new skill cannot publish its file without approval');
  assert.equal(await audienceRefusal({ files: fresh, folders: ['alice'], tier: 'creator', approvedCheck: check }), null, 'a trusted author can');
});

// ---- the website client ------------------------------------------------------------------------------------------

test('the website publisher runs the same rule, before encrypting, and carries the file through drafts and reads', () => {
  const w = src('src/lib/workbench-client.ts');
  const at = w.indexOf('const skillPlan = await skillFilesForPublish({ type, built, oldIndexPath: origin && oldFm ? origin.oldPath : null, priorKind: oldFm?.kind, moved, skillFile, readFile: readOwnFile });');
  assert.ok(at > 0);
  assert.ok(at < w.indexOf('const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });'), 'a refusal costs no encryption');
  assert.match(w, /if \(skillPlan\.refusal\) throw new WorkbenchClientError\('invalid-content', skillPlan\.refusal\);/);
  assert.match(w, /files\.push\(\.\.\.skillPlan\.files\);/);
  assert.match(w, /async function publish\(\{ type, input = \{\}, body = '', authorNote, path, scope, authorTarget, skillFile \}: any\)/);
  assert.match(w, /const skill = await skillFileBeside\(path, frontmatter, readOwnFile\);/, 'read-back, so repo drafts get it too');
  assert.match(w, /async saveDraft\(\{ type, input = \{\}, body = '', path, authorNote, authorTarget, skillFile \}: any\)[\s\S]{0,1400}\.\.\.\(typeof skillFile === 'string' \? \{ skillFile \} : \{\}\),/);
  assert.match(w, /\.\.\.\(typeof rec\.skillFile === 'string' \? \{ skillFile: rec\.skillFile \} : \{\}\), \/\/ sow-109: the skill file publishes with it/);
});

// ---- the editor --------------------------------------------------------------------------------------------------

test('the Made for list: tools with steps first, notes from the steps list, nothing ticked is ever dropped', () => {
  const allTools = [{ key: 'claude', label: 'Claude' }, { key: 'claude-code', label: 'Claude Code' }, { key: 'codex', label: 'Codex' }, { key: 'paperclip', label: 'Paperclip' }];
  const rows = madeForRows({ allTools, stepKeys: ['codex', 'claude-code'], targets: ['Codex', 'Retired Tool'] });
  assert.deepEqual(rows.map((r) => r.label), ['Claude Code', 'Codex', 'Claude', 'Paperclip', 'Retired Tool']);
  assert.deepEqual(rows.map((r) => r.note), ['Standard steps', 'Standard steps', 'No standard steps yet', 'No standard steps yet', 'Not in the tool list']);
  assert.deepEqual(rows.map((r) => r.on), [false, true, false, false, true]);
  assert.deepEqual(toggleTarget(['Codex'], 'Claude Code'), ['Codex', 'Claude Code']);
  assert.deepEqual(toggleTarget(['Codex', 'Claude Code'], 'Codex'), ['Claude Code']);
});

test('the choice, the headings and the skill file field', () => {
  assert.equal(normalizeKind(undefined), 'prompt');
  assert.equal(mainHeading('skill').title, 'Commands and usage');
  assert.equal(mainHeading('prompt').title, 'The prompt');
  assert.match(mainHeadingHtml('prompt'), /<span class="dsub-opt" data-main-opt hidden>Optional<\/span>/, 'present but hidden, so a switch to skill can show it');
  assert.match(mainHeadingHtml('skill'), /<span class="dsub-opt" data-main-opt>Optional<\/span>/);
  assert.match(kindSectionHtml('skill'), /<input data-key="kind" data-kind="enum" type="hidden" value="skill" \/>/);
  assert.match(kindSectionHtml(undefined), /value="prompt"/, 'a new item starts as a prompt');
  assert.equal((kindSectionHtml('skill').match(/aria-checked="true"/g) || []).length, 1);
  assert.equal((skillSectionsHtml({ kind: 'prompt' }).match(/data-skill-only hidden/g) || []).length, 3, 'all three skill blocks hidden for a prompt');
  assert.match(skillSectionsHtml({ kind: 'skill', skillFile: '<b>' }), /<textarea id="skillfile"[^>]*>&lt;b&gt;<\/textarea>/, 'the file is escaped');
  const root = (kind, value) => ({ querySelector: (s) => (s === 'input[data-key="kind"]' ? { value: kind } : s === '#skillfile' ? { value } : null) });
  assert.equal(skillFileFrom(root('skill', FILE)), FILE);
  assert.equal(skillFileFrom(root('prompt', FILE)), undefined, 'a prompt sends no file');
  assert.equal(siteFor({ protocol: 'https:', hostname: 'preview.gbti.network', origin: 'https://preview.gbti.network' }), 'https://preview.gbti.network');
  assert.equal(siteFor({ protocol: 'chrome-extension:', hostname: 'abc', origin: 'chrome-extension://abc' }), 'https://gbti.network');
});

test('the editor and workspace carry kind and the skill file end to end', () => {
  assert.equal(FIELDS.prompt[0].key, 'kind');
  assert.equal(FIELDS.prompt.find((f) => f.key === 'targets').label, 'Works with');
  const ed = src('client-ui/src/elements/gbti-content-editor.mjs');
  assert.match(ed, /prompt: new Set\(\['kind'\]\)/, 'kind renders as the cards, not in the hidden block');
  assert.match(ed, /const skillFile = this\.type === 'prompt' \? skillFileFrom\(this\.root\) : undefined;/);
  assert.equal((ed.match(/const \{ type, input, body, skillFile \} = this\.gather\(\);/g) || []).length, 2, 'publish and draft both read it');
  assert.match(ed, /authorTarget, \.\.\.\(skillFile !== undefined \? \{ skillFile \} : \{\}\) \}\);/);
  assert.match(ed, /skillFile: typeof skillFile === 'string' \? skillFile : null \};/, 'load keeps it on the preset');
  assert.match(ed, /if \(this\.type === 'prompt'\) wireSkillEditor\(this\);/);
  assert.match(ed, /\.fld\[hidden\] \{ display:none; \}/, 'a hidden rail field really hides; .fld sets display:flex, which beats the attribute');
  const ws = src('client-ui/src/elements/gbti-workspace.mjs');
  assert.match(ws, /authorNote: e\.authorNote \?\? null, skillFile: e\.skillFile \?\? null \}\);/);
  assert.equal((ws.match(/skillFile: typeof full\.skillFile === 'string' \? full\.skillFile : null/g) || []).length, 2, 'an item and a draft both open with it');
  const page = src('src/pages/skill-install.json.ts');
  assert.match(page, /allTools: aiToolsAll\(\)/, 'the tick list reads every tool');
});
