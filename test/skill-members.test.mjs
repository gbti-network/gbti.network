// sow-109 Phase 7: a members-only skill's own file, ENCRYPTED. The file travels beside the body as
// `_enc/prompt-<slug>-skillfile.enc` (the Worker holds the key), index.md points at it with `encryptedSkill`, and it
// is written, kept, moved, re-encrypted, published or removed by the same rule as a public skill's plain SKILL.md.
// The five places the plumbing survey found would break without this each have a test here: the merge gate, the
// approval to public, the content check, the build guard, and moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { planSkillFile, skillFilesForPublish, skillFileBeside, PUBLIC_NEEDS_FILE } from '../client/src/skill-file.mjs';
import { encSkillAssetFor } from '../client/src/member-content.mjs';
import { publish, renameContent, getContentItem } from '../client/src/operations.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';
import { contentTypesTouched, requiredTierFor, TYPE_OTHER } from '../membership/classify-pr.mjs';
import { TIER } from '../membership/tiers.mjs';
import { buildApproval } from '../workers/signup/membership-editorial.mjs';
import { encryptAsset } from '../client/src/crypto-assets.mjs';
import { checkBuildSecrets } from '../scripts/check-build-secrets.mjs';
import { lockedTargets } from '../client-ui/src/elements/gbti-locked-content.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FILE = '---\nname: farley\ndescription: remembers people\n---\n# Farley\n';
const IDX = 'members/alice/prompts/farley/index.md';
const SK = 'members/alice/prompts/farley/SKILL.md';
const ENC = 'members/alice/_enc/prompt-farley-skillfile.enc';
const IDX2 = 'members/alice/prompts/farley-file/index.md';
const ENC2 = 'members/alice/_enc/prompt-farley-file-skillfile.enc';

test('the file is named from the item, and its asset id says what it is', () => {
  assert.deepEqual(encSkillAssetFor(IDX), { assetId: 'prompt:farley:skillfile', path: ENC });
  assert.equal(encSkillAssetFor('members/alice/posts/x/index.md'), null);
  assert.equal(encSkillAssetFor('members/../prompts/x/index.md'), null);
});

test('the rule, members-only: encrypt what is sent or what was plain, keep, move byte for byte, never leave plain text', () => {
  const plan = (a) => planSkillFile({ kind: 'skill', visibility: 'members', newIndexPath: IDX, ...a });
  assert.deepEqual(plan({ skillFile: FILE }), { files: [], refusal: null, encrypt: { text: FILE, assetId: 'prompt:farley:skillfile', path: ENC }, pointer: ENC }, 'a new members-only skill is encrypted');
  const toMembers = plan({ oldIndexPath: IDX, priorKind: 'skill', oldSkillText: FILE });
  assert.deepEqual(toMembers.files, [{ path: SK, content: null }], 'going members-only deletes the plain file');
  assert.equal(toMembers.encrypt.text, FILE, '...and encrypts it, even when the author sent nothing');
  assert.deepEqual(plan({ oldIndexPath: IDX, priorKind: 'skill', oldEncPath: ENC }), { files: [], refusal: null, encrypt: null, pointer: ENC }, 'a plain edit keeps it');
  const moved = planSkillFile({ kind: 'skill', visibility: 'members', newIndexPath: IDX2, oldIndexPath: IDX, priorKind: 'skill', oldEncPath: ENC, oldEncText: '{"v":1}' });
  assert.deepEqual(moved.files, [{ path: ENC2, content: '{"v":1}' }, { path: ENC, content: null }]);
  assert.equal(moved.pointer, ENC2);
  assert.match(planSkillFile({ kind: 'skill', visibility: 'members', newIndexPath: IDX2, oldIndexPath: IDX, priorKind: 'skill', oldEncPath: ENC }).refusal, /could not be read to move/, 'never a move that loses the file');
  const movedNew = planSkillFile({ kind: 'skill', visibility: 'members', skillFile: FILE, newIndexPath: IDX2, oldIndexPath: IDX, priorKind: 'skill', oldEncPath: ENC });
  assert.deepEqual(movedNew.files, [{ path: ENC, content: null }], 'a new file at a new place: the old ciphertext goes');
  assert.equal(movedNew.encrypt.path, ENC2);
  assert.match(plan({ skillFile: '---\nname: Bad\n---\n' }).refusal, /name: line/);
});

test('the rule, leaving members-only: public needs the file sent, and a prompt drops the ciphertext', () => {
  assert.equal(planSkillFile({ kind: 'skill', visibility: 'public', newIndexPath: IDX, oldIndexPath: IDX, priorKind: 'skill', oldEncPath: ENC }).refusal, PUBLIC_NEEDS_FILE);
  assert.deepEqual(planSkillFile({ kind: 'skill', visibility: 'public', skillFile: FILE, newIndexPath: IDX, oldIndexPath: IDX, priorKind: 'skill', oldEncPath: ENC }).files,
    [{ path: SK, content: FILE }, { path: ENC, content: null }], 'published plain, and the ciphertext goes');
  assert.deepEqual(planSkillFile({ kind: 'prompt', newIndexPath: IDX, oldIndexPath: IDX, priorKind: 'skill', oldEncPath: ENC }).files, [{ path: ENC, content: null }]);
});

test('the shared step encrypts through the Worker and reads the old ciphertext only for a move', async () => {
  const reads = [];
  const readFile = async (p) => { reads.push(p); return p === ENC ? '{"v":1,"moved":true}' : null; };
  const encrypt = async (plaintext, assetId) => ({ v: 1, kid: '1', iv: 'i', aad: assetId, ct: `len${plaintext.length}` });
  const built = (p) => ({ path: p, frontmatter: { kind: 'skill', visibility: 'members' } });
  const fresh = await skillFilesForPublish({ type: 'prompt', built: built(IDX), skillFile: FILE, readFile, encrypt });
  assert.equal(fresh.pointer, ENC);
  assert.deepEqual(JSON.parse(fresh.files[0].content), { v: 1, kid: '1', iv: 'i', aad: 'prompt:farley:skillfile', ct: `len${FILE.length}` });
  assert.deepEqual(reads, []);
  const move = await skillFilesForPublish({ type: 'prompt', built: built(IDX2), oldIndexPath: IDX, priorKind: 'skill', priorEncryptedSkill: ENC, moved: true, readFile, encrypt });
  assert.deepEqual(move.files, [{ path: ENC2, content: '{"v":1,"moved":true}' }, { path: ENC, content: null }]);
  assert.ok(reads.includes(ENC));
  const locked = async () => { const e = new Error('locked'); e.name = 'MemberContentLockedError'; throw e; };
  await assert.rejects(skillFilesForPublish({ type: 'prompt', built: built(IDX), skillFile: FILE, readFile, encrypt: locked }), /locked/, 'a refused encrypt is passed on, never swallowed');
  assert.deepEqual(await skillFileBeside(IDX, { kind: 'skill', encryptedSkill: ENC }, async () => 'plain', async (p) => `decrypted ${p}`), { skillFile: `decrypted ${ENC}` });
  assert.deepEqual(await skillFileBeside(IDX, { kind: 'skill', encryptedSkill: ENC }, async () => 'plain'), {}, 'no decrypt, no file: never the plain read');
  assert.deepEqual(await skillFileBeside(IDX, { kind: 'skill', encryptedSkill: ENC }, async () => 'plain', async () => { throw new Error('403'); }), {});
});

// ---- the npm / agent publisher end to end, against a fake Worker ----------------------------------------------

const MEMBERS_MD = (extra = '') => `---\ntype: prompt\nkind: skill\ntitle: Farley\nslug: farley\nauthor: alice\nstatus: published\nvisibility: members\npublicStub: true\npublishedAt: 2026-07-02T00:00:00.000Z\nshortDescription: remembers people\ntargets:\n  - Claude Code\ncategories:\n  - ai\n  - prompts\n${extra}---\n\nThe teaser.\n`;
const INPUT = { title: 'Farley', slug: 'farley', shortDescription: 'remembers people', targets: ['Claude Code'], categories: ['ai', 'prompts'], visibility: 'members', publicStub: true, kind: 'skill' };
function network() {
  const authored = [];
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetch = async (url, init = {}) => {
    const p = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    if (p === '/membership/author') { authored.push(body); return ok({ ok: true, number: 1, html_url: 'u', branch: 'b' }); }
    if (p === '/membership/encrypt') return ok({ ok: true, envelope: { v: 1, kid: '1', iv: 'i', aad: body.assetId, ct: `ct:${body.plaintext}` } });
    if (p === '/membership/decrypt') return ok({ ok: true, text: String(body.ct).replace(/^ct:/, '') });
    if (p === '/membership/drafts') return ok({ ok: true, drafts: [] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, authored, files: () => authored.flatMap((a) => a.files) };
}
const ctxFor = (net, files = {}) => ({
  identity: () => ({ username: 'alice' }),
  getRepoClient: () => ({ upstream: 'gbti-network/gbti.network', async getFileContent(p) { return files[p] ?? null; } }),
  membership: async () => 'paid',
  reader: { readFile: async (rel) => files[rel] ?? null, get: async (_u, rel) => (files[rel] ? { path: rel, ...parseContentFile(files[rel]) } : null) },
  store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
  fetch: net.fetch,
});

test('npm publish: a members-only skill commits its file encrypted, the pointer in index.md, and no plain copy', async () => {
  const net = network();
  await publish(ctxFor(net), { type: 'prompt', input: INPUT, body: 'The teaser.\n\n<!-- members-only -->\n\nThe commands.', skillFile: FILE });
  const byPath = Object.fromEntries(net.files().map((f) => [f.path, f.content]));
  assert.equal(parseContentFile(byPath[IDX]).frontmatter.encryptedSkill, ENC);
  assert.deepEqual(JSON.parse(byPath[ENC]), { v: 1, kid: '1', iv: 'i', aad: 'prompt:farley:skillfile', ct: `ct:${FILE}` });
  assert.ok(!(SK in byPath), 'no plaintext SKILL.md');
  assert.ok(!Object.entries(byPath).some(([p, c]) => p !== ENC && typeof c === 'string' && c.includes('# Farley')), 'the file text is nowhere else (the fake Worker\'s "ciphertext" is the text itself)');
  const forged = network();
  await publish(ctxFor(forged), { type: 'prompt', input: { ...INPUT, visibility: 'public', publicStub: false, encryptedSkill: 'members/alice/_enc/x.enc' }, body: 'x', skillFile: FILE });
  assert.equal(parseContentFile(forged.files().find((f) => f.path === IDX).content).frontmatter.encryptedSkill, undefined, 'a caller cannot set the pointer');
});

test('npm: reading a members-only skill decrypts its file, an edit keeps it, and a rename moves it with its pointer', async () => {
  const repo = { [IDX]: MEMBERS_MD(`encryptedSkill: ${ENC}\n`), [ENC]: JSON.stringify({ v: 1, kid: '1', iv: 'i', aad: 'prompt:farley:skillfile', ct: `ct:${FILE}` }) };
  assert.equal((await getContentItem(ctxFor(network(), repo), { path: IDX })).skillFile, FILE);
  const keep = network();
  await publish(ctxFor(keep, repo), { type: 'prompt', input: INPUT, body: 'The teaser.', path: IDX });
  assert.equal(parseContentFile(keep.files().find((f) => f.path === IDX).content).frontmatter.encryptedSkill, ENC);
  assert.ok(!keep.files().some((f) => /skillfile\.enc$/.test(f.path)), 'nothing re-sent for a kept file');
  const ren = network();
  await renameContent(ctxFor(ren, repo), { path: IDX, newSlug: 'farley-file' });
  const byPath = Object.fromEntries(ren.files().map((f) => [f.path, f.content]));
  assert.equal(byPath[ENC2], repo[ENC], 'moved byte for byte');
  assert.equal(byPath[ENC], null);
  assert.equal(parseContentFile(byPath[IDX2]).frontmatter.encryptedSkill, ENC2, 'index.md points at where it went');
});

// ---- the merge gate, the approval, the content check and the build guard --------------------------------------

test('the gate reads the encrypted skill file as part of a prompt, so an ordinary member is not asked for more', () => {
  const types = contentTypesTouched([IDX, ENC], 'alice');
  assert.deepEqual(types, ['prompt']);
  assert.equal(requiredTierFor(types, { ownFolder: true }), requiredTierFor(contentTypesTouched([IDX], 'alice'), { ownFolder: true }));
  assert.deepEqual(contentTypesTouched(['members/alice/_enc/prompt-x-other.enc'], 'alice'), [TYPE_OTHER], 'an unknown name still asks the higher tier');
  assert.deepEqual(contentTypesTouched(['members/alice/_enc/post-x-skillfile.enc'], 'alice'), [TYPE_OTHER], 'only a prompt carries a skill file');
  assert.equal(requiredTierFor(types, { ownFolder: true }), TIER.member);
  assert.equal(requiredTierFor([TYPE_OTHER]), TIER.creator);
});

const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes: a test key, never a real one
test('approving a members-only skill publishes its file as plain SKILL.md and deletes the ciphertext', async () => {
  const item = { path: IDX, type: 'prompt', login: 'alice', slug: 'farley' };
  const skillEnvelope = await encryptAsset({ plaintext: FILE, key: KEY, assetId: 'prompt:farley:skillfile', kid: '1' });
  const bodyEnvelope = await encryptAsset({ plaintext: 'The commands.', key: KEY, assetId: 'prompt:farley:body', kid: '1' });
  const indexText = MEMBERS_MD(`encryptedBody: members/alice/_enc/prompt-farley-body.enc\nencryptedSkill: ${ENC}\n`);
  const built = await buildApproval({ MEMBER_CONTENT_KEY: KEY, MEMBER_CONTENT_KID: '1' }, { item, indexText, encText: JSON.stringify(bodyEnvelope), skillEncText: JSON.stringify(skillEnvelope) });
  const byPath = Object.fromEntries(built.files.map((f) => [f.path, f.content]));
  assert.equal(byPath[SK], FILE);
  assert.equal(byPath[ENC], null);
  const fm = parseContentFile(byPath[IDX]).frontmatter;
  assert.equal(fm.visibility, 'public');
  assert.equal(fm.encryptedSkill, undefined);
  const missing = await buildApproval({ MEMBER_CONTENT_KEY: KEY }, { item, indexText, encText: JSON.stringify(bodyEnvelope) });
  assert.match(missing.error, /skill file could not be read/, 'never approved without its file');
  assert.match(src('workers/signup/membership-editorial.mjs'), /const built = await buildApproval\(env, \{ item, indexText, encText, skillEncText \}\);/);
});

// The content check, run for real on a throwaway tree: the scripts copied, the rest linked, one member's folder copied.
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-skillfix-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  for (const d of ['client', 'client-ui', 'membership', 'house', 'src', 'node_modules', 'workers']) fs.symlinkSync(path.join(ROOT, d), path.join(dir, d));
  fs.mkdirSync(path.join(dir, 'members'));
  for (const m of ['atwellpub', 'nareshdevineni']) fs.cpSync(path.join(ROOT, 'members', m), path.join(dir, 'members', m), { recursive: true });
  // The owner made /QA public on 2026-10-08 (its SKILL.md is now plain beside index.md). These checks need a
  // members-only skill, so the throwaway copy turns it back into one: members audience, no plain SKILL.md.
  const qa = path.join(dir, 'members/atwellpub/prompts/qa-skill-for-claude-code-and-codex/index.md');
  fs.writeFileSync(qa, fs.readFileSync(qa, 'utf8').replace(/^visibility: .*$/m, 'visibility: members'));
  fs.rmSync(path.join(path.dirname(qa), 'SKILL.md'), { force: true });
  return dir;
}
const QA = 'members/atwellpub/prompts/qa-skill-for-claude-code-and-codex/index.md';
const QA_ENC = 'members/atwellpub/_enc/prompt-qa-skill-for-claude-code-and-codex-skillfile.enc';
const run = (dir) => spawnSync(process.execPath, [path.join(dir, 'scripts/validate-content.mjs')], { encoding: 'utf8' });
const withPointer = (dir, rel, value) => {
  const f = path.join(dir, rel);
  const text = fs.readFileSync(f, 'utf8');
  const next = /^encryptedSkill: .*$/m.test(text) ? text.replace(/^encryptedSkill: .*$/m, `encryptedSkill: ${value}`) : text.replace(/^status: (.*)$/m, `status: $1\nencryptedSkill: ${value}`);
  assert.ok(next.includes(`\nencryptedSkill: ${value}\n`), `the pointer is in ${rel}`); // /QA may already carry it (sow-109 Phase 7 converted it)
  fs.writeFileSync(f, next);
};

test('the content check: the pointer names its own ciphertext, only on a members-only skill, and never beside a plain file', { timeout: 120000 }, () => {
  const dir = fixture();
  try {
    assert.equal(run(dir).status, 0, 'the copied tree passes as it is');
    fs.writeFileSync(path.join(dir, QA_ENC), JSON.stringify({ v: 1, kid: '1', iv: 'i', aad: 'prompt:x:skillfile', ct: 'c' }));
    withPointer(dir, QA, QA_ENC);
    const ok = run(dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    for (const [label, mutate, want] of [
      ['a wrong path', () => withPointer(dir, QA, 'members/atwellpub/_enc/other.enc'), /encryptedSkill must be members\/atwellpub\/_enc\/prompt-qa-skill-for-claude-code-and-codex-skillfile\.enc/],
      ['a missing file', () => fs.rmSync(path.join(dir, QA_ENC)), /encryptedSkill points at a missing file/],
      ['plain text in the .enc', () => fs.writeFileSync(path.join(dir, QA_ENC), FILE), /not valid JSON/],
      ['a public skill carrying one', () => withPointer(dir, 'members/atwellpub/prompts/farley-file-skill-for-claude-code/index.md', 'members/atwellpub/_enc/x.enc'), /encryptedSkill belongs only to a members-only skill/],
      ['a plain SKILL.md beside a members-only skill', () => fs.writeFileSync(path.join(dir, path.dirname(QA), 'SKILL.md'), FILE), /cannot carry a plaintext SKILL\.md/],
    ]) {
      const before = new Map([QA, QA_ENC, 'members/atwellpub/prompts/farley-file-skill-for-claude-code/index.md'].map((p) => [p, fs.existsSync(path.join(dir, p)) ? fs.readFileSync(path.join(dir, p)) : null]));
      mutate();
      const r = run(dir);
      assert.notEqual(r.status, 0, label);
      assert.match(r.stdout + r.stderr, want, label);
      for (const [p, b] of before) { const f = path.join(dir, p); if (b == null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, b); }
      fs.rmSync(path.join(dir, path.dirname(QA), 'SKILL.md'), { force: true });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the build guard refuses a members-only skill file served in the clear', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-skillguard-'));
  try {
    fs.mkdirSync(path.join(root, 'members/alice/prompts/farley'), { recursive: true });
    fs.writeFileSync(path.join(root, IDX), MEMBERS_MD());
    fs.mkdirSync(path.join(root, 'dist/prompts/farley'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist/prompts/farley/index.html'), '<meta name="robots" content="noindex"><gbti-locked-content data-gbti-region="locked"></gbti-locked-content>');
    const clean = checkBuildSecrets({ root, env: {}, buildDrafts: () => ({ items: [] }) });
    assert.ok(!clean.errors.some((e) => /skill file in the clear/.test(e)), clean.errors.join('\n'));
    fs.writeFileSync(path.join(root, 'dist/prompts/farley/SKILL.md'), FILE);
    const leaked = checkBuildSecrets({ root, env: {}, buildDrafts: () => ({ items: [] }) });
    assert.ok(leaked.errors.some((e) => /members-only skill has its skill file in the clear in dist: dist\/prompts\/farley\/SKILL\.md/.test(e)), leaked.errors.join('\n'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- the page and the reader ------------------------------------------------------------------------------------

test('the page: a members-only skill\'s install box is locked, and unlocks as the box for a paid member', () => {
  assert.deepEqual(lockedTargets('["Claude Code","Codex",3]'), ['Claude Code', 'Codex']);
  assert.deepEqual(lockedTargets('{nope'), []);
  const lb = src('src/components/LockedBody.astro');
  assert.match(lb, /data-gbti-targets=\{skill \? JSON\.stringify\(targets\) : undefined\}/);
  assert.match(lb, /skillfile: 'Install this skill'/);
  // Astro drops the space between an expression and the element after it, so the space lives INSIDE the strings
  // (it read "for members.Become a member" on every locked box, body and comment included, when it did not).
  assert.match(lb, /\{skill \? 'The skill file and its install steps are for members\. ' : `This \$\{noun\} is for members\. `\}<a href="\/membership\/">/);
  const el = src('client-ui/src/elements/gbti-locked-content.mjs');
  assert.match(el, /if \(\(this\.dataset\?\.gbtiKind \|\| this\.getAttribute\?\.\('data-gbti-kind'\)\) === 'skillfile'\) return this\.renderSkill\(encPath\);/);
  assert.match(el, /decrypt: async \(\) => \(await this\.client\.decrypt\(\{ encPath \}\)\)\?\.text,/, 'through the host, so the key stays in the Worker');
  assert.match(el, /this\.set\(css \+ `\$\{box\.html\}<pre data-skill-raw hidden>\$\{esc\(box\.text\)\}<\/pre>`\);\n\s*wireSkillPage\(this\.root\);/);
  assert.match(src('client/src/mcp-tools.mjs'), /SKILL_FILE_PARAM = \{ type: 'string'/);
});
