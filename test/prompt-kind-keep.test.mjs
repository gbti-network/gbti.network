// sow-109: an edit keeps a skill a skill. Until the editor offers the prompt-or-skill choice, and for any caller that
// does not send `kind` (an older client, an agent tool call), a publish of an existing skill used to write the schema
// default, `kind: prompt`: the page lost its install box and file download while its SKILL.md stayed behind, which the
// content check then refused. Found by the Phase 5 code map on 2026-09-30, before anyone re-saved a skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { kindForPublish } from '../membership/prompt-kind.mjs';
import { publish, saveDraft } from '../client/src/operations.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';

const PATH = 'members/alice/prompts/farley/index.md';
const SKILL = '---\ntype: prompt\nkind: skill\ntitle: Farley\nslug: farley\nauthor: alice\nstatus: published\nvisibility: public\npublishedAt: 2026-07-02T00:00:00.000Z\nshortDescription: remembers people\ntargets:\n  - Claude Code\ncategories:\n  - ai\n  - prompts\n---\n\nThe author text.\n';
const INPUT = { title: 'Farley', slug: 'farley', shortDescription: 'remembers people, edited', targets: ['Claude Code'], categories: ['ai', 'prompts'], visibility: 'public' };

function network() {
  const authored = [];
  const draftWrites = [];
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetch = async (url, init = {}) => {
    const p = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    if (p === '/membership/author') { authored.push(body); return ok({ ok: true, number: 1, html_url: 'u', branch: 'b' }); }
    if (p === '/membership/drafts') { if (body) draftWrites.push(body); return ok({ ok: true, drafts: [] }); }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, authored, draftWrites };
}
const ctxFor = (net, files = { [PATH]: SKILL }) => ({
  identity: () => ({ username: 'alice' }),
  getRepoClient: () => ({ upstream: 'gbti-network/gbti.network', async getFileContent(p) { return files[p] ?? null; } }),
  membership: async () => 'paid',
  reader: { readFile: async (rel) => files[rel] ?? null },
  store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
  fetch: net.fetch,
});
const publishedKind = (net) => parseContentFile(net.authored.flatMap((a) => a.files).find((f) => f.path === PATH).content).frontmatter.kind;

test('the rule: the caller\'s kind wins, else the item\'s own, else the default', () => {
  assert.equal(kindForPublish('prompt', 'skill'), 'prompt', 'an explicit choice is honoured, even a change');
  assert.equal(kindForPublish(undefined, 'skill'), 'skill');
  assert.equal(kindForPublish('', 'skill'), 'skill');
  assert.equal(kindForPublish(undefined, undefined), undefined, 'a new item gets the schema default');
  assert.equal(kindForPublish(undefined, 'nonsense'), undefined, 'a broken stored value is not copied forward');
});

test('re-publishing an existing skill without a kind keeps it a skill (with a path, and without one)', async () => {
  for (const path of [PATH, undefined]) {
    const net = network();
    await publish(ctxFor(net), { type: 'prompt', input: INPUT, body: 'The author text, edited.', path });
    assert.equal(publishedKind(net), 'skill', `path ${path ?? '(none)'}`);
  }
});

test('an explicit kind still wins, and a brand-new item without one is a prompt', async () => {
  const net = network();
  await publish(ctxFor(net), { type: 'prompt', input: { ...INPUT, kind: 'prompt' }, body: 'x', path: PATH });
  assert.equal(publishedKind(net), 'prompt');
  const fresh = network();
  await publish(ctxFor(fresh, {}), { type: 'prompt', input: { ...INPUT, slug: 'new-one' }, body: 'x' });
  const f = fresh.authored.flatMap((a) => a.files).find((x) => x.path.endsWith('/new-one/index.md'));
  assert.equal(parseContentFile(f.content).frontmatter.kind, 'prompt');
});

test('a draft records only the kind the author chose', async () => {
  const net = network();
  await saveDraft(ctxFor(net), { type: 'prompt', input: INPUT, body: 'draft', path: PATH });
  const fm = net.draftWrites.find((w) => w.op === 'put').draft.frontmatter;
  assert.ok(!('kind' in fm), 'no default kind is stored, so publishing the draft keeps the item\'s own');
  const chose = network();
  await saveDraft(ctxFor(chose), { type: 'prompt', input: { ...INPUT, kind: 'skill' }, body: 'draft', path: PATH });
  assert.equal(chose.draftWrites.find((w) => w.op === 'put').draft.frontmatter.kind, 'skill');
});

test('the website publisher applies the same rule to the file it loaded', () => {
  // publish lives in its own module since the 900-line split; these are ORDER checks inside it, so read it alone.
  const src = fs.readFileSync(new URL('../src/lib/workbench-client-publish.ts', import.meta.url), 'utf8');
  const at = src.indexOf("if (type === 'prompt') { const k = kindForPublish(input?.kind, oldFm?.kind); if (k) effInput.kind = k; }");
  assert.ok(at > src.indexOf('const effInput: any = { ...input };'), 'after effInput exists');
  assert.ok(at < src.indexOf('return buildContentFile({ type, username: target.username'), 'before the file is built');
});
