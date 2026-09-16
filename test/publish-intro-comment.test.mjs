// SOW-014 x the MCP publish flow: publish() seeds the from-the-author intro comment into the SAME PR when
// `authorNote` is passed, so a new prompt/product publishes compliant in ONE pull request
// (operations.buildIntroCommentFile + one network publish carrying both files). add_prompt/add_product/
// publish_content forward `authorNote` to publish(), so this covers all three MCP tools.
//
// sow-274 Part 2: every publish goes to the network (POST /membership/author), so these assert the file set and
// title that reached it, where they used to read what a fake fork recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publish, saveDraft, authorContent, buildIntroCommentFile, describeContentPublish, AUTHOR_NOTE_TYPES, OperationError } from '../client/src/operations.mjs';
import { buildContentFile } from '../client/src/content-ops.mjs';
import { AUTHOR_NOTE_TYPES as WEB_AUTHOR_NOTE_TYPES } from '../src/lib/workbench-client-core.mjs';

const repoFile = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// The set of types that may carry a from-the-author note exists in THREE places: the client core, the website
// core, and a literal in the client-ui editor, which sits behind a bundle boundary and can import neither. A
// disagreement is invisible until someone types a note that is then silently discarded, which is exactly the
// bug this work fixed. Reading the editor's SOURCE is the only way to hold the third copy to the other two.
test('DRIFT: the client core, the website core and the editor agree on which types carry an author note', () => {
  assert.deepEqual([...AUTHOR_NOTE_TYPES].sort(), [...WEB_AUTHOR_NOTE_TYPES].sort(), 'the two cores disagree');
  const src = repoFile('client-ui/src/elements/gbti-content-editor.mjs');
  const m = /const AUTHOR_NOTE_TYPES = new Set\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(m, 'the editor no longer declares AUTHOR_NOTE_TYPES as a literal Set; update this test with it');
  const editorTypes = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
  assert.deepEqual(editorTypes, [...AUTHOR_NOTE_TYPES].sort(), 'the editor literal drifted from the cores');
  // Both gates in the editor must READ the constant, or widening it silently changes only one of them.
  assert.match(src, /const showAuthorNote = AUTHOR_NOTE_TYPES\.has\(this\.type\)/);
  assert.match(src, /const introSlug = AUTHOR_NOTE_TYPES\.has\(this\.type\)/);
});

// The REQUIREMENT is narrower than the permission, and conflating them would block every article that has no
// note. validate-content enforces an intro for product/prompt only; nothing requires one of a post.
test('an author note is PERMITTED on a post but never REQUIRED of one', () => {
  assert.ok(AUTHOR_NOTE_TYPES.has('post'));
  const validate = repoFile('scripts/validate-content.mjs');
  assert.match(validate, /a published project\/prompt requires a from-the-author introduction comment/);
  assert.doesNotMatch(validate, /requires? a from-the-author (introduction )?comment[^\n]*\bpost\b/);
});

/**
 * The network, as far as a publish sees it. `authored` holds each POST /membership/author body
 * ({ itemId, files: [{ path, content }], title }); `staged` holds each draft record saved to the private store.
 */
function fakeNetwork() {
  const authored = [];
  const staged = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    if (path === '/membership/author') {
      authored.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true, number: 7, html_url: 'u', branch: `hosted/1/${body.itemId}` }) };
    }
    if (path === '/membership/drafts' && body?.op === 'put') {
      staged.push(body.draft);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { authored, staged, fetch };
}

function ctxFor({ membership = 'paid', net = fakeNetwork(), now = '2026-07-02T00:00:00Z' } = {}) {
  return {
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    getRepoClient: () => ({ upstream: 'gbti-network/gbti.network', getFileContent: async () => null }),
    membership: () => membership,
    store: { get: (k) => ({ githubToken: 'tok' })[k] },
    now: () => now,
    fetch: net.fetch,
  };
}

/** The paths, and one file's text, from the single publish a test made. */
const onlyPublish = (net) => { assert.equal(net.authored.length, 1, 'expected exactly one publish'); return net.authored[0]; };
const pathsOf = (net) => onlyPublish(net).files.map((f) => f.path).sort();
const textOf = (net, re) => onlyPublish(net).files.find((f) => re.test(f.path)).content;
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

// 2026-08-11: this test previously asserted `null` for a post, which is what silently discarded a note typed
// on an article. The published article page has always PINNED an author note (ContentFooter -> Comments.astro,
// which then hides the "Written by" box), and validate-content has always permitted a public authorNote on a
// post; only the write path excluded them. A post's note is OPTIONAL, unlike a product/prompt's.
test('buildIntroCommentFile: a POST with a note seeds one, exactly like a prompt', () => {
  const post = buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 'my-article' }, body: 'B' });
  const f = buildIntroCommentFile({ username: 'alice', built: post, authorNote: 'Why I wrote this.', now: '2026-08-11T00:00:00Z' });
  assert.equal(f.path, 'members/alice/comments/intro-my-article.md');
  assert.match(f.content, /targetType: post/);
  assert.match(f.content, /authorNote: true/);
  assert.match(f.content, /visibility: public/);
  assert.match(f.content, /Why I wrote this\./);
});

test('buildIntroCommentFile: null for a blank note, a missing note, or a type that cannot carry one', () => {
  assert.equal(buildIntroCommentFile({ username: 'alice', built: promptBuilt(), authorNote: '   ' }), null); // blank note
  assert.equal(buildIntroCommentFile({ username: 'alice', built: promptBuilt() }), null); // no note
  const share = { type: 'share', slug: 's', frontmatter: {} };
  assert.equal(buildIntroCommentFile({ username: 'alice', built: share, authorNote: 'note' }), null); // never a share
});

test('publish: a prompt WITH authorNote seeds the intro comment into the SAME PR (two files, one publish)', async () => {
  const net = fakeNetwork();
  const out = await publish(ctxFor({ net }), {
    type: 'prompt', input: { title: 'My Prompt', slug: 'my-prompt', shortDescription: 'x' }, body: 'The prompt body', authorNote: 'Why I made this.',
  });
  assert.equal(out.prNumber, 7);
  assert.deepEqual(
    pathsOf(net),
    ['members/alice/comments/intro-my-prompt.md', 'members/alice/prompts/my-prompt/index.md'],
    'the prompt index.md AND its intro comment are sent in the same publish',
  );
  const intro = textOf(net, /comments\/intro-my-prompt\.md$/);
  assert.match(intro, /authorNote: true/);
  assert.match(intro, /targetSlug: my-prompt/);
  assert.match(intro, /Why I made this\./);
});

test('publish: a POST with authorNote seeds the intro comment into the SAME PR', async () => {
  const net = fakeNetwork();
  await publish(ctxFor({ net }), {
    type: 'post', input: { title: 'My Article', slug: 'my-article' }, body: 'The article body', authorNote: 'Why I wrote this.',
  });
  assert.deepEqual(
    pathsOf(net),
    ['members/alice/comments/intro-my-article.md', 'members/alice/posts/my-article/index.md'],
    'the article index.md AND its intro comment ride one publish, so the note is never silently dropped',
  );
  assert.match(textOf(net, /comments\/intro-my-article\.md$/), /targetType: post/);
});

test('publish: a POST WITHOUT authorNote stays a single-file PR (the note is optional for an article)', async () => {
  const net = fakeNetwork();
  await publish(ctxFor({ net }), { type: 'post', input: { title: 'A', slug: 'no-note' }, body: 'Body' });
  assert.deepEqual(pathsOf(net), ['members/alice/posts/no-note/index.md']);
});

test('publish: a prompt WITHOUT authorNote stays a single-file PR (no regression)', async () => {
  const net = fakeNetwork();
  await publish(ctxFor({ net }), { type: 'prompt', input: { title: 'P', slug: 'no-intro', shortDescription: 'x' }, body: 'Body' });
  assert.deepEqual(pathsOf(net), ['members/alice/prompts/no-intro/index.md']);
});

test('describeContentPublish: a human-readable title + body from the content (not the slug)', () => {
  const built = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'Author a GBTI SOW', slug: 'author-a-gbti-sow', shortDescription: 'A step-by-step skill.', categories: ['skill'] }, body: 'B' });
  const d = describeContentPublish(built, { hasIntro: true });
  assert.equal(d.title, 'Publish prompt: Author a GBTI SOW');
  assert.equal(d.message, d.title);
  assert.match(d.body, /## Author a GBTI SOW/);
  assert.match(d.body, /A step-by-step skill\./);
  assert.match(d.body, /Category: skill/);
  assert.match(d.body, /intro comment/);
});

// sow-274 Part 2: the network writes its own pull request body, so the client's descriptive body is no longer
// sent and its assertion is gone. The descriptive TITLE still is, and describeContentPublish keeps its own test above.
test('publish: sends a DESCRIPTIVE pull request title (not the bare "Update")', async () => {
  const net = fakeNetwork();
  await publish(ctxFor({ net }), {
    type: 'prompt', input: { title: 'Author a GBTI SOW', slug: 'author-a-gbti-sow', shortDescription: 'A skill.', categories: ['skill'] }, body: 'Body', authorNote: 'Why I made this.',
  });
  assert.equal(onlyPublish(net).title, 'Publish prompt: Author a GBTI SOW');
  assert.notEqual(onlyPublish(net).title, 'Update');
  assert.equal(onlyPublish(net).itemId, 'prompt-author-a-gbti-sow');
});

test('publish: an explicit title still wins over the descriptive default', async () => {
  const net = fakeNetwork();
  await publish(ctxFor({ net }), {
    type: 'prompt', input: { title: 'T', slug: 's', shortDescription: 'x' }, body: 'B', title: 'My exact title', prBody: 'My exact body',
  });
  assert.equal(onlyPublish(net).title, 'My exact title');
  assert.equal('body' in onlyPublish(net), false, 'a pull request body is never sent (sow-274 Part 2)');
});

// SOW-106 Phase 1: publishing merges to the network repo, and merged content is PUBLIC.
test('publish: forces status: published (no silent hidden merged draft)', async () => {
  const net = fakeNetwork();
  await publish(ctxFor({ net }), { type: 'prompt', input: { title: 'T', slug: 'p1', shortDescription: 'x' }, body: 'B' });
  assert.match(textOf(net, /prompts\/p1\/index\.md$/), /^status: published$/m);
});

test('publish: respects an explicit status: draft (member self-unpublish)', async () => {
  const net = fakeNetwork();
  await publish(ctxFor({ net }), { type: 'prompt', input: { title: 'T', slug: 'p2', shortDescription: 'x', status: 'draft' }, body: 'B' });
  assert.match(textOf(net, /prompts\/p2\/index\.md$/), /^status: draft$/m);
});

test('saveDraft: a staged draft carries status: published and publishes NOTHING', async () => {
  const net = fakeNetwork();
  await saveDraft(ctxFor({ net }), { type: 'prompt', input: { title: 'T', slug: 'p3', shortDescription: 'x' }, body: 'B' });
  assert.equal(net.staged.length, 1);
  assert.equal(net.staged[0].frontmatter.status, 'published');
  assert.equal(net.authored.length, 0, 'saveDraft stages privately and never publishes');
});

// SOW-106 Phase 5: the MCP author entry forces an explicit publish-vs-draft intent.
test('authorContent: status published routes to publish (opens a PR)', async () => {
  const net = fakeNetwork();
  const out = await authorContent(ctxFor({ net }), { type: 'prompt', input: { title: 'T', slug: 'a1', shortDescription: 'x' }, body: 'B', status: 'published' });
  assert.equal(out.prNumber, 7);
  assert.equal(net.authored.length, 1, 'published -> sent to the network');
  assert.equal(net.staged.length, 0);
});

test('authorContent: status draft routes to saveDraft (private stage, no PR)', async () => {
  const net = fakeNetwork();
  await authorContent(ctxFor({ net }), { type: 'prompt', input: { title: 'T', slug: 'a2', shortDescription: 'x' }, body: 'B', status: 'draft' });
  assert.equal(net.authored.length, 0, 'draft -> staged privately, nothing published');
  assert.deepEqual(net.staged.map((d) => d.path), ['members/alice/prompts/a2/index.md'], 'the draft is saved to the private store');
});

test('authorContent: a missing status throws status-required (forced intent, nothing silently drafts)', async () => {
  await assert.rejects(
    authorContent(ctxFor(), { type: 'prompt', input: { title: 'T', slug: 'a3', shortDescription: 'x' }, body: 'B' }),
    (e) => e instanceof OperationError && e.code === 'status-required',
  );
});
