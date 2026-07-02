// SOW-014 x the MCP publish flow: publish() seeds the from-the-author intro comment into the SAME PR when
// `authorNote` is passed, so a new prompt/product publishes compliant in ONE pull request
// (operations.buildIntroCommentFile + the multi-file publishFiles path). add_prompt/add_product/publish_content
// forward `authorNote` to publish(), so this covers all three MCP tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publish, buildIntroCommentFile } from '../client/src/operations.mjs';
import { buildContentFile } from '../client/src/content-ops.mjs';

const fakeRepo = (puts = []) => ({
  upstream: 'gbti-network/gbti.network',
  async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
  async getDefaultBranch() { return 'main'; },
  async getBranchSha() { return 'sha'; },
  async ensureBranch() {},
  async getFileSha() { return null; },
  async putFile(_full, path, opts) { puts.push({ path, content: opts?.contentBase64 }); },
  async findOpenPull() { return null; },
  async openPull() { return { number: 7, html_url: 'u' }; },
});

function ctxFor({ membership = 'paid', repo = fakeRepo(), now = '2026-07-02T00:00:00Z' } = {}) {
  return {
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    getRepoClient: () => repo,
    membership: () => membership,
    store: { get: (k) => ({ githubToken: 'tok' })[k] },
    now: () => now,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
}

const decode = (puts, re) => Buffer.from(puts.find((p) => re.test(p.path)).content, 'base64').toString('utf8');
const promptBuilt = () => buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 'my-prompt', shortDescription: 'x' }, body: 'B' });

test('buildIntroCommentFile: builds a PUBLIC authorNote intro for a prompt (deterministic intro-<slug> id)', () => {
  const f = buildIntroCommentFile({ username: 'alice', built: promptBuilt(), authorNote: 'Hello from me', now: '2026-07-02T00:00:00Z' });
  assert.equal(f.path, 'members/alice/comments/intro-my-prompt.md');
  assert.match(f.content, /targetType: prompt/);
  assert.match(f.content, /targetSlug: my-prompt/);
  assert.match(f.content, /authorNote: true/);
  assert.match(f.content, /visibility: public/);
  assert.match(f.content, /Hello from me/);
});

test('buildIntroCommentFile: null for a post, a blank note, or a missing note', () => {
  const post = buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 's' }, body: 'B' });
  assert.equal(buildIntroCommentFile({ username: 'alice', built: post, authorNote: 'note' }), null); // posts need no intro
  assert.equal(buildIntroCommentFile({ username: 'alice', built: promptBuilt(), authorNote: '   ' }), null); // blank note
  assert.equal(buildIntroCommentFile({ username: 'alice', built: promptBuilt() }), null); // no note
});

test('publish: a prompt WITH authorNote seeds the intro comment into the SAME PR (two files, one branch)', async () => {
  const puts = [];
  const out = await publish(ctxFor({ repo: fakeRepo(puts) }), {
    type: 'prompt', input: { title: 'My Prompt', slug: 'my-prompt', shortDescription: 'x' }, body: 'The prompt body', authorNote: 'Why I made this.',
  });
  assert.equal(out.prNumber, 7);
  assert.deepEqual(
    puts.map((p) => p.path).sort(),
    ['members/alice/comments/intro-my-prompt.md', 'members/alice/prompts/my-prompt/index.md'],
    'the prompt index.md AND its intro comment are committed to the same branch/PR',
  );
  const intro = decode(puts, /comments\/intro-my-prompt\.md$/);
  assert.match(intro, /authorNote: true/);
  assert.match(intro, /targetSlug: my-prompt/);
  assert.match(intro, /Why I made this\./);
});

test('publish: a prompt WITHOUT authorNote stays a single-file PR (no regression)', async () => {
  const puts = [];
  await publish(ctxFor({ repo: fakeRepo(puts) }), { type: 'prompt', input: { title: 'P', slug: 'no-intro', shortDescription: 'x' }, body: 'Body' });
  assert.deepEqual(puts.map((p) => p.path), ['members/alice/prompts/no-intro/index.md']);
});
