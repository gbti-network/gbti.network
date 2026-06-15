// SOW-006 content operations: building + validating + scoping authored content.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveUsername,
  contentPath,
  canAuthorPath,
  sanitizeInput,
  buildContentFile,
  parseContentFile,
  ContentValidationError,
} from '../client/src/content-ops.mjs';

test('resolveUsername: Map and plain-object indexes', () => {
  assert.equal(resolveUsername('2002207', new Map([['2002207', 'hudson']])), 'hudson');
  assert.equal(resolveUsername(2002207, { 2002207: 'hudson' }), 'hudson');
  assert.equal(resolveUsername('999', new Map()), null);
});

test('contentPath: per-type folder layout', () => {
  assert.equal(contentPath('post', 'alice', 'hello'), 'members/alice/posts/hello/index.md');
  assert.equal(contentPath('product', 'alice', 'thing'), 'members/alice/products/thing/index.md');
  assert.equal(contentPath('prompt', 'alice', 'p'), 'members/alice/prompts/p/index.md');
  assert.equal(contentPath('profile', 'alice'), 'members/alice/profile.md');
  assert.throws(() => contentPath('post', 'alice'), /requires a slug/);
});

test('canAuthorPath: own folder only, no traversal', () => {
  assert.equal(canAuthorPath('members/alice/posts/x/index.md', 'alice'), true);
  assert.equal(canAuthorPath('members/bob/posts/x/index.md', 'alice'), false);
  assert.equal(canAuthorPath('members/alice/../bob/posts/x.md', 'alice'), false);
  assert.equal(canAuthorPath('/etc/passwd', 'alice'), false);
  assert.equal(canAuthorPath('house/roles.yml', 'alice'), false);
});

test('sanitizeInput: forces author + strips system-managed fields', () => {
  const post = sanitizeInput('post', { author: 'evil', contributors: [{ login: 'x' }], title: 'T' }, 'alice');
  assert.equal(post.author, 'alice');
  assert.equal(post.contributors, undefined);
  const profile = sanitizeInput('profile', { username: 'evil', tier: 'paid', joinedAt: '2020-01-01' }, 'alice');
  assert.equal(profile.username, 'alice');
  assert.equal(profile.tier, undefined);
  assert.equal(profile.joinedAt, undefined);
});

test('buildContentFile: valid post is scoped, author-forced, system-stripped', () => {
  const out = buildContentFile({
    type: 'post',
    username: 'alice',
    input: { title: 'Hello World', slug: 'hello-world', author: 'someone-else', contributors: [{ login: 'x' }], status: 'published' },
    body: '# Hi\n\nBody text.',
  });
  assert.equal(out.path, 'members/alice/posts/hello-world/index.md');
  assert.equal(out.frontmatter.author, 'alice');
  assert.equal(out.frontmatter.contributors, undefined);
  assert.match(out.markdown, /^---\n/);
  assert.match(out.markdown, /title: Hello World/);
  assert.match(out.markdown, /Body text\./);
});

test('buildContentFile: invalid slug throws ContentValidationError', () => {
  assert.throws(
    () => buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 'Bad Slug' } }),
    (e) => e instanceof ContentValidationError && /slug/.test(e.message),
  );
});

test('buildContentFile: a non-authorable type is rejected', () => {
  assert.throws(() => buildContentFile({ type: 'comment', username: 'alice', input: {} }), /not an authorable type/);
});

test('buildContentFile: product requires its mandatory fields', () => {
  const ok = buildContentFile({
    type: 'product',
    username: 'alice',
    input: { title: 'Tool', slug: 'tool', shortDescription: 'A tool', category: 'utilities', icon: 'icon.png', featuredImage: 'cover.png' },
  });
  assert.equal(ok.path, 'members/alice/products/tool/index.md');
  assert.throws(
    () => buildContentFile({ type: 'product', username: 'alice', input: { title: 'Tool', slug: 'tool' } }),
    ContentValidationError,
  );
});

test('parseContentFile: round-trips what buildContentFile produced', () => {
  const built = buildContentFile({
    type: 'prompt',
    username: 'alice',
    input: { title: 'P', slug: 'p', shortDescription: 'a one-liner', category: 'coding' },
    body: 'Prompt body',
  });
  const parsed = parseContentFile(built.markdown);
  assert.equal(parsed.frontmatter.title, 'P');
  assert.equal(parsed.frontmatter.author, 'alice');
  assert.equal(parsed.body.trim(), 'Prompt body'); // file ends with a trailing newline by convention
});
