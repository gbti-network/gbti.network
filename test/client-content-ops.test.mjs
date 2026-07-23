// SOW-006 content operations: building + validating + scoping authored content.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveUsername,
  resolveTarget,
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

// SOW-145: the house content target (superadmin-only surface, gated by the caller).
test('resolveTarget: member vs house scope', () => {
  assert.deepEqual(resolveTarget({ scope: 'member', username: 'alice' }), {
    scope: 'member',
    folder: 'members/alice',
    author: 'alice',
  });
  assert.deepEqual(resolveTarget({ scope: 'house' }), { scope: 'house', folder: 'house', author: 'gbti' });
  assert.deepEqual(resolveTarget({ scope: 'house', username: 'alice' }), { scope: 'house', folder: 'house', author: 'gbti' });
  // Default scope is member; a member scope without a username is a programming error.
  assert.deepEqual(resolveTarget({ username: 'bob' }), { scope: 'member', folder: 'members/bob', author: 'bob' });
  assert.throws(() => resolveTarget({ scope: 'member' }), /username is required/);
});

test('contentPath: house scope emits house/<sub>/<slug>/index.md', () => {
  assert.equal(contentPath('post', 'gbtilabs', 'welcome', 'house'), 'house/posts/welcome/index.md');
  assert.equal(contentPath('product', 'gbtilabs', 'hue', 'house'), 'house/products/hue/index.md');
  assert.equal(contentPath('prompt', 'gbtilabs', 'seo', 'house'), 'house/prompts/seo/index.md');
  // The actor's username never leaks into a house path.
  assert.equal(contentPath('post', undefined, 'welcome', 'house'), 'house/posts/welcome/index.md');
  // Profiles are member-only regardless of scope.
  assert.equal(contentPath('profile', 'gbtilabs', null, 'house'), 'members/gbtilabs/profile.md');
});

test('canAuthorPath: own folder only, no traversal', () => {
  assert.equal(canAuthorPath('members/alice/posts/x/index.md', 'alice'), true);
  assert.equal(canAuthorPath('members/bob/posts/x/index.md', 'alice'), false);
  assert.equal(canAuthorPath('members/alice/../bob/posts/x.md', 'alice'), false);
  assert.equal(canAuthorPath('/etc/passwd', 'alice'), false);
  assert.equal(canAuthorPath('house/roles.yml', 'alice'), false);
});

// SOW-145: allowHouse (a superadmin) may additionally author under house/; a member still may not, and
// traversal is rejected even with allowHouse (the server gate is the real enforcement, this is UX scoping).
test('canAuthorPath: allowHouse permits house/ only for a superadmin', () => {
  assert.equal(canAuthorPath('house/posts/x/index.md', 'gbtilabs', { allowHouse: true }), true);
  assert.equal(canAuthorPath('house/products/hue/index.md', 'gbtilabs', { allowHouse: true }), true);
  // Without allowHouse a house/ path is rejected (a plain member).
  assert.equal(canAuthorPath('house/posts/x/index.md', 'alice'), false);
  assert.equal(canAuthorPath('house/posts/x/index.md', 'alice', { allowHouse: false }), false);
  // Traversal is rejected even with allowHouse.
  assert.equal(canAuthorPath('house/../members/bob/posts/x.md', 'gbtilabs', { allowHouse: true }), false);
  assert.equal(canAuthorPath('house\\posts\\x', 'gbtilabs', { allowHouse: true }), false);
  // A superadmin may still author their own member folder alongside house.
  assert.equal(canAuthorPath('members/gbtilabs/posts/x/index.md', 'gbtilabs', { allowHouse: true }), true);
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

// SOW-145: a house publish writes house/<sub>/<slug>/ but keeps author 'gbti', never the editing superadmin.
test('buildContentFile: house scope writes house/ with author gbti', () => {
  const out = buildContentFile({
    type: 'post',
    username: 'gbtilabs',
    input: { title: 'House Post', slug: 'house-post', author: 'gbtilabs', status: 'published' },
    body: 'House body.',
    scope: 'house',
  });
  assert.equal(out.path, 'house/posts/house-post/index.md');
  assert.equal(out.scope, 'house');
  assert.equal(out.frontmatter.author, 'gbti'); // never the editing superadmin
  assert.equal(out.username, 'gbtilabs'); // the actor stays on the result (fork/commit context)
  assert.match(out.markdown, /author: gbti/);
});

test('sanitizeInput: an explicit author overrides the folder username (house content)', () => {
  const post = sanitizeInput('post', { title: 'T', author: 'gbtilabs' }, 'gbtilabs', { author: 'gbti' });
  assert.equal(post.author, 'gbti');
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
