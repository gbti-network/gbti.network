// sow-109 Phase 6: Admin tools > Skill install. The superadmin sets or clears one tool's install steps in
// house/skill-install.yml, and can add a tool to house/ai-tools.yml without losing that file's comments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import { skillStepsInput, setSkillSteps, aiToolInput, addAiToolText, toolKeyFor, skillInstallPool, TOOL_KEY_RE } from '../membership/skill-install-edits.mjs';
import { skillInstallProblems } from '../membership/skill-install.mjs';
import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';
import { membershipAdminSkillInstallPool } from '../workers/signup/membership-admin-skills.mjs';
import { rankForPath } from '../membership/path-rank.mjs';

const src = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const AI_RAW = src('house/ai-tools.yml');
const AI = yaml.load(AI_RAW);
const STEPS = yaml.load(src('house/skill-install.yml'));

test('the steps input: folder and run required, {name} in the folder, one line each, no long dashes', () => {
  assert.deepEqual(skillStepsInput({ key: 'codex', folder: ' ~/.agents/skills/{name} ', run: 'Start Codex.', local: '' }),
    { key: 'codex', folder: '~/.agents/skills/{name}', run: 'Start Codex.' }, 'trimmed, and an empty note is left out');
  assert.deepEqual(skillStepsInput({ key: 'paperclip', clear: true }), { key: 'paperclip', clear: true });
  assert.throws(() => skillStepsInput({ key: 'codex', folder: '~/.agents/skills', run: 'x' }), /\{name\}/);
  assert.throws(() => skillStepsInput({ key: 'codex', folder: '~/{name}' }), /how to run it is required/);
  assert.throws(() => skillStepsInput({ key: 'codex', folder: '~/{name}', run: 'a\nb' }), /one line/);
  assert.throws(() => skillStepsInput({ key: 'codex', folder: '~/{name}', run: 'Start it — then type' }), /long dash/);
  assert.throws(() => skillStepsInput({ key: '../roles', folder: '~/{name}', run: 'x' }), /tool key/);
  assert.throws(() => skillStepsInput({ key: 'codex', folder: '~/{name}', run: 'x'.repeat(401) }), /too long/);
});

test('setting steps changes one tool and keeps the rest in order; clearing removes it; the same values are a no-op', () => {
  const same = setSkillSteps(STEPS, skillStepsInput({ key: 'codex', ...STEPS.tools.codex }));
  assert.equal(same.changed, false);
  const add = setSkillSteps(STEPS, skillStepsInput({ key: 'paperclip', folder: '~/.paperclip/skills/{name}', run: 'Restart Paperclip.' }));
  assert.equal(add.changed, true);
  assert.deepEqual(Object.keys(add.next.tools), ['claude-code', 'codex', 'openclaw', 'paperclip']);
  assert.deepEqual(add.next.tools.codex, STEPS.tools.codex, 'the others untouched');
  assert.deepEqual(skillInstallProblems(add.next, AI), [], 'the result passes the content check');
  const cleared = setSkillSteps(STEPS, { key: 'openclaw', clear: true });
  assert.deepEqual(Object.keys(cleared.next.tools), ['claude-code', 'codex']);
  assert.equal(setSkillSteps(STEPS, { key: 'paperclip', clear: true }).changed, false, 'clearing a tool with no steps changes nothing');
  assert.ok(STEPS.tools.openclaw, 'the input document is not mutated');
});

test('a new tool: its key comes from its label, and the name is kept to characters the list can hold', () => {
  assert.equal(toolKeyFor('Gemini CLI'), 'gemini-cli');
  assert.equal(toolKeyFor('  Pâté Tool++ '), 'pate-tool');
  assert.deepEqual(aiToolInput({ label: 'Tool (beta)' }), { key: 'tool-beta', label: 'Tool (beta)' });
  assert.throws(() => aiToolInput({ label: 'Bad: name' }), /may use letters/);
  assert.throws(() => aiToolInput({ label: '+++' }), /at least one letter/);
  assert.throws(() => aiToolInput({ label: '' }), /required/);
  assert.ok(TOOL_KEY_RE.test(aiToolInput({ label: 'x'.repeat(40) }).key));
});

test('adding a tool inserts one line at the end of the first group and keeps every comment', () => {
  const out = addAiToolText(AI_RAW, { key: 'gemini-cli', label: 'Gemini CLI' }, AI);
  const before = AI_RAW.split('\n');
  const after = out.split('\n');
  assert.equal(after.length, before.length + 1);
  const at = after.findIndex((l, i) => l !== before[i]);
  assert.equal(after[at], '  gemini-cli: { label: Gemini CLI }');
  assert.equal(after[at - 1].trim().split(':')[0], Object.keys(AI.tools)[Object.keys(AI.tools).indexOf('paperclip')], 'right after the last assistant');
  assert.deepEqual([...after.slice(0, at), ...after.slice(at + 1)], before, 'nothing else moved or changed');
  const parsed = yaml.load(out);
  assert.equal(parsed.tools['gemini-cli'].label, 'Gemini CLI');
  assert.deepEqual(Object.keys(parsed.tools).filter((k) => k !== 'gemini-cli'), Object.keys(AI.tools));
  const odd = aiToolInput({ label: '&Co Tools' }); // the input allows it, and a leading & is a YAML anchor marker
  assert.equal(yaml.load(addAiToolText(AI_RAW, odd, AI)).tools[odd.key].label, '&Co Tools', 'a name YAML would misread is quoted');
  assert.throws(() => addAiToolText(AI_RAW, { key: 'codex-2', label: 'CODEX' }, AI), /already in the tool list/, 'the label decides, in any case');
  assert.throws(() => addAiToolText(AI_RAW, { key: 'codex', label: 'Codex Two' }, AI), /already/);
  assert.throws(() => addAiToolText('# no map\n', { key: 'x', label: 'X' }, {}), /no tools: map/);
});

test('the admin pool lists every tool in file order with its steps or none', () => {
  const pool = skillInstallPool(STEPS, AI);
  assert.equal(pool.length, Object.keys(AI.tools).length);
  assert.deepEqual(pool.filter((t) => t.steps).map((t) => t.key), ['claude-code', 'codex', 'openclaw']);
  assert.deepEqual(pool.find((t) => t.key === 'codex').steps, { folder: STEPS.tools.codex.folder, run: STEPS.tools.codex.run, local: STEPS.tools.codex.local });
  assert.equal(pool.find((t) => t.key === 'paperclip').steps, null);
});

// ---- through the Worker's admin route, asserting on what is WRITTEN (the sow-415 lesson) ------------------------


const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deB64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');
const HOUSE = { 'house/skill-install.yml': src('house/skill-install.yml'), 'house/ai-tools.yml': AI_RAW };
function ghFetch(record) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/app\/installations\/\d+\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'inst' }; } };
    const read = url.match(/\/contents\/(house\/[^?]+)\?ref=main$/);
    if (read && method === 'GET') return HOUSE[read[1]] == null ? { ok: false, status: 404, async json() { return {}; } } : { ok: true, status: 200, async json() { return { content: b64(HOUSE[read[1]]), sha: 'abc' }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') { record.push({ method, url }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; } };
    if (/\/contents\//.test(url) && method === 'PUT') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return { number: 9, html_url: 'https://x/pull/9' }; } }; }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const as = (role) => async () => ({ ok: true, githubId: '1', role });
const run = (body, record = [], role = 'superadmin') => membershipAdminAuthor({ headers: { get: () => 'Bearer tok' }, json: async () => body }, env,
  { fetchImpl: ghFetch(record), authorize: as(role), kv: { async get() { return null; }, async put() {} }, limiter: async () => ({ allowed: true }), signJwt: async () => 'j' });
const puts = (record) => Object.fromEntries(record.filter((r) => r.method === 'PUT').map((r) => [r.url.match(/contents\/([^?]+)/)[1], deB64(r.body.content)]));

test('the Worker: setting steps writes the steps file with its header, and opens one pull request', async () => {
  const record = [];
  const r = await run({ action: 'skill-install-set', key: 'paperclip', folder: '~/.paperclip/skills/{name}', run: 'Restart Paperclip.' }, record);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.number, 9);
  const w = puts(record);
  assert.deepEqual(Object.keys(w), ['house/skill-install.yml'], 'the tool list is not touched');
  assert.match(w['house/skill-install.yml'], /^# sow-109: the install steps a skill page shows/, 'the header survives');
  assert.deepEqual(yaml.load(w['house/skill-install.yml']).tools.paperclip, { folder: '~/.paperclip/skills/{name}', run: 'Restart Paperclip.' });
  assert.equal(record.filter((x) => /\/pulls$/.test(x.url)).length, 1);
});

test('the Worker: an unknown tool, a folder without {name}, and an unchanged save write nothing', async () => {
  for (const [body, want] of [
    [{ action: 'skill-install-set', key: 'no-such-tool', folder: '~/{name}', run: 'x' }, /not in the tool list/],
    [{ action: 'skill-install-set', key: 'codex', folder: '~/.agents/skills', run: 'x' }, /\{name\}/],
    [{ action: 'skill-install-tool-add', label: 'Codex' }, /already in the tool list/],
    [{ action: 'skill-install-tool-add', label: 'Gemini CLI', folder: '~/.gemini/skills' }, /\{name\}/],
  ]) {
    const record = [];
    const r = await run(body, record);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.message, want);
    assert.equal(record.length, 0);
  }
  const none = [];
  const same = await run({ action: 'skill-install-set', key: 'codex', ...STEPS.tools.codex }, none);
  assert.equal(same.body.noop, true);
  assert.equal(none.length, 0);
});

test('the Worker: adding a tool inserts one line into the tool list, and can carry its steps in the same pull request', async () => {
  const record = [];
  const r = await run({ action: 'skill-install-tool-add', label: 'Gemini CLI', folder: '~/.gemini/skills/{name}', run: 'Start Gemini CLI and type `/{name}`.' }, record);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = puts(record);
  assert.deepEqual(Object.keys(w).sort(), ['house/ai-tools.yml', 'house/skill-install.yml']);
  assert.equal(w['house/ai-tools.yml'].split('\n').length, AI_RAW.split('\n').length + 1);
  assert.equal((w['house/ai-tools.yml'].match(/^\s*#/gm) || []).length, (AI_RAW.match(/^\s*#/gm) || []).length, 'every comment kept');
  assert.equal(yaml.load(w['house/skill-install.yml']).tools['gemini-cli'].folder, '~/.gemini/skills/{name}');
  const bare = [];
  await run({ action: 'skill-install-tool-add', label: 'Gemini CLI' }, bare);
  assert.deepEqual(Object.keys(puts(bare)), ['house/ai-tools.yml'], 'a tool can be added with no steps yet');
});

test('the Worker: an admin is refused both writes, and the steps file is superadmin-pinned', async () => {
  for (const body of [{ action: 'skill-install-set', key: 'codex', clear: true }, { action: 'skill-install-tool-add', label: 'Gemini CLI' }]) {
    const record = [];
    const r = await run(body, record, 'admin');
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(record.length, 0);
  }
  assert.equal(rankForPath('house/skill-install.yml'), 3);
  assert.match(src('CODEOWNERS'), /^\/house\/skill-install\.yml\s+@atwellpub @gbtilabs$/m);
});

test('the Worker read: superadmin only, every tool with its steps', async () => {
  const deps = (who) => ({ fetchImpl: ghFetch([]), authorize: async () => who, signJwt: async () => 'j' });
  const denied = await membershipAdminSkillInstallPool({}, env, deps({ ok: false, status: 403, body: { error: 'forbidden' } }));
  assert.equal(denied.status, 403);
  const ok = await membershipAdminSkillInstallPool({}, env, deps({ ok: true, githubId: '1', role: 'superadmin' }));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.tools, skillInstallPool(STEPS, AI));
  assert.match(src('workers/signup/index.mjs'), /'\/membership\/admin\/skill-install': membershipAdminSkillInstallPool,/);
});

test('every host reaches it, and only a superadmin sees the tab', () => {
  const client = src('client-ui/src/client.mjs');
  assert.match(client, /skillInstallPool: \(\) => request\('GET', '\/api\/skill-install-pool'\)/);
  assert.match(client, /setSkillInstallSteps: \(p\) => request\('POST', '\/api\/admin', \{ action: 'skill-install-set', \.\.\.p \}\)/);
  assert.match(client, /addSkillInstallTool: \(p\) => request\('POST', '\/api\/admin', \{ action: 'skill-install-tool-add', \.\.\.p \}\)/);
  assert.match(src('extension/src/ext-dispatch.mjs'), /if \(pathname === '\/api\/skill-install-pool'\) return ok\(await getSkillInstallPool\(ctx\)\);/);
  assert.match(src('client/src/api.mjs'), /pathname === '\/api\/skill-install-pool'\) return run\(\(\) => getSkillInstallPool\(ctx\)\)/);
  const web = src('src/lib/workbench-client.ts') + '\n' + src('src/lib/workbench-client-admin.ts'); // admin methods, split out at the 900-line cap
  assert.match(web, /skillInstallPool\(\) \{ return workerGet\('\/membership\/admin\/skill-install'\); \}/);
  assert.match(web, /action: 'skill-install-set'/);
  assert.match(web, /action: 'skill-install-tool-add'/);
  const page = src('src/pages/admin.astro');
  assert.match(page, /data-tab="skill-install" data-min="superadmin"/);
  const sup = page.slice(page.indexOf('if (rank >= RANK.superadmin) {'));
  assert.match(sup.slice(0, sup.indexOf('}')), /gbti-skill-install-manager\.mjs/, 'the module loads only for a superadmin');
  const ext = src('extension/admin.html');
  assert.match(ext, /data-tab="skill-install" data-min="superadmin">Skill install</);
  const tpl = ext.slice(ext.indexOf('<template data-admin-panels>'), ext.indexOf('</template>'));
  assert.match(tpl, /data-panel="skill-install"/, 'the panel is inside the gated template');
});

test('the extension and npm read answers exactly what the Worker read does', async () => {
  const { getSkillInstallPool } = await import('../client/src/admin-ops.mjs');
  const ctx = { reader: { readFile: async (rel) => HOUSE[rel] ?? null } };
  assert.deepEqual(await getSkillInstallPool(ctx), { ok: true, tools: skillInstallPool(STEPS, AI) });
});
