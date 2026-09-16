// SOW-112: the true permalink rename. Guards (own folder, collision, bad slug, paid, no-op, fail-closed on a
// missing old file), the one-commit file set (new index + delete old + .enc byte-move + intro move/retarget),
// redirectFrom append, publishedAt preserved.
//
// sow-274 Part 2: the rename goes to the network, so these assert on the file set that reached it
// (POST /membership/author). The staged-draft and open-PR blocks checked the member's fork branches and went
// with the fork path, as did the fork-sync fail-closed case; the network commits on live main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameContent, OperationError } from '../client/src/operations.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';

const OLD = 'members/alice/prompts/old-name/index.md';
const PROMPT = '---\ntype: prompt\ntitle: X\nslug: old-name\nauthor: alice\nstatus: published\nvisibility: public\npublishedAt: 2026-07-02\ntargets:\n  - Claude Code\ncategories:\n  - skill\n---\n\nThe body.\n';
const INTRO = '---\ntype: comment\nid: intro-old-name\nauthor: alice\ntargetType: prompt\ntargetSlug: old-name\nstatus: published\nvisibility: public\nauthorNote: true\ncreatedAt: 2026-07-02\n---\n\nFrom the author.\n';

/** The canonical-repo read client: the collision check reads through it. It has no writers to call. */
function fakeRepo({ upstreamFiles = {} } = {}) {
  return {
    upstream: 'gbti-network/gbti.network',
    async getFileContent(p) { return upstreamFiles[p] ?? null; },
  };
}

/** The network: records each author call (the committed file set). */
function network() {
  const authored = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (new URL(String(url)).pathname === '/membership/author') {
      authored.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true, number: 91, html_url: 'u', branch: `hosted/1/${body.itemId}` }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const files = () => authored.flatMap((a) => a.files);
  return {
    fetch, authored,
    puts: () => files().filter((f) => f.content != null),
    deletes: () => files().filter((f) => f.content == null).map((f) => f.path),
  };
}

function ctxFor({ repo = fakeRepo(), net = network(), files = {}, membership = 'paid' } = {}) {
  const all = { [OLD]: PROMPT, ...files };
  return {
    identity: () => ({ username: 'alice' }),
    getRepoClient: () => repo,
    membership: async () => membership,
    reader: { readFile: async (rel) => all[rel] ?? null },
    store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
    fetch: net.fetch,
    now: () => '2026-07-06T12:00:00Z',
  };
}

test('rename: one commit moves the index + intro, appends redirectFrom, preserves publishedAt, deletes the old paths', async () => {
  const net = network();
  const ctx = ctxFor({ net, files: { 'members/alice/comments/intro-old-name.md': INTRO } });
  const r = await renameContent(ctx, { path: OLD, newSlug: 'new-name' });
  assert.equal(r.ok, true);
  assert.equal(r.prNumber, 91);
  assert.equal(r.path, 'members/alice/prompts/new-name/index.md');
  assert.equal(net.authored.length, 1);
  const newIndex = net.puts().find((f) => f.path === r.path);
  const fm = parseContentFile(newIndex.content).frontmatter;
  assert.equal(fm.slug, 'new-name');
  assert.deepEqual(fm.redirectFrom, ['/prompts/old-name/']);
  assert.equal(new Date(fm.publishedAt).toISOString().slice(0, 10), '2026-07-02'); // preserved
  assert.equal(fm.updatedAt, '2026-07-06T12:00:00Z');
  const newIntro = net.puts().find((f) => f.path === 'members/alice/comments/intro-new-name.md');
  const introFm = parseContentFile(newIntro.content).frontmatter;
  assert.equal(introFm.id, 'intro-new-name');
  assert.equal(introFm.targetSlug, 'new-name');
  assert.deepEqual(net.deletes().sort(), [OLD, 'members/alice/comments/intro-old-name.md'].sort());
  assert.match(net.authored[0].title, /^Rename: old-name -> new-name$/);
  assert.equal(net.authored[0].itemId, 'rename-prompt-old-name');
});

test('rename: a members-only item byte-moves its .enc and repoints encryptedBody', async () => {
  const encOld = 'members/alice/_enc/prompt-old-name-body.enc';
  const memberPrompt = PROMPT.replace('visibility: public', `visibility: members\nencryptedBody: ${encOld}`);
  const envelope = '{"v":1,"kid":"1","iv":"aa","aad":"prompt:old-name:body","ct":"bb"}';
  const net = network();
  const ctx = ctxFor({ net, files: { [OLD]: memberPrompt, [encOld]: envelope } });
  const r = await renameContent(ctx, { path: OLD, newSlug: 'new-name' });
  const movedEnc = net.puts().find((f) => f.path === 'members/alice/_enc/prompt-new-name-body.enc');
  assert.equal(movedEnc.content, envelope); // byte-identical: the envelope is path-independent
  const fm = parseContentFile(net.puts().find((f) => f.path === r.path).content).frontmatter;
  assert.equal(fm.encryptedBody, 'members/alice/_enc/prompt-new-name-body.enc');
  assert.ok(net.deletes().includes(encOld));
});

test('rename guards: collision, foreign path, bad slug, non-paid, no-op, and none of them sends anything', async () => {
  const net = network();
  const base = () => ctxFor({ net });
  await assert.rejects(renameContent(ctxFor({ net, repo: fakeRepo({ upstreamFiles: { 'members/alice/prompts/new-name/index.md': 'x' } }) }), { path: OLD, newSlug: 'new-name' }),
    (e) => e instanceof OperationError && /already taken/.test(e.message));
  // Removed by sow-274 Part 2: the staged-draft and open-PR blocks, which checked fork branches.
  await assert.rejects(renameContent(base(), { path: 'members/bob/prompts/x/index.md', newSlug: 'y' }),
    (e) => e.code === 'forbidden');
  await assert.rejects(renameContent(base(), { path: OLD, newSlug: 'Bad Slug!' }),
    (e) => e.code === 'bad-request');
  await assert.rejects(renameContent(ctxFor({ net, membership: 'trialing' }), { path: OLD, newSlug: 'new-name' }),
    (e) => e.code === 'membership-required');
  assert.deepEqual(await renameContent(base(), { path: OLD, newSlug: 'old-name' }), { ok: true, noop: true, slug: 'old-name' });
  assert.equal(net.authored.length, 0);
});

test('rename fails CLOSED when the old file cannot be read from the network', async () => {
  const net = network();
  const ctx = ctxFor({ net });
  ctx.reader = { readFile: async () => null };
  await assert.rejects(renameContent(ctx, { path: OLD, newSlug: 'new-name' }),
    (e) => e instanceof OperationError && e.code === 'not-found');
  assert.equal(net.authored.length, 0); // never a half-move
});
