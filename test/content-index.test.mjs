// SOW-031: the per-type content index path derivation + the reader read-route allowlist. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentItemPath, toIndexItem, isReadablePath, READ_PATH_RE } from '../src/lib/content-index.mjs';

test('contentItemPath: member owner -> members/<owner>/<sub>/<slug>/index.md', () => {
  assert.equal(contentItemPath('post', 'hudson', 'my-post'), 'members/hudson/posts/my-post/index.md');
  assert.equal(contentItemPath('product', 'Alice', 'thing'), 'members/alice/products/thing/index.md');
  assert.equal(contentItemPath('prompt', 'bob', 'p'), 'members/bob/prompts/p/index.md');
});

test('contentItemPath: house/gbti owner -> house/<sub>/<slug>/index.md', () => {
  assert.equal(contentItemPath('post', 'gbti', 'x'), 'house/posts/x/index.md');
  assert.equal(contentItemPath('post', 'house', 'x'), 'house/posts/x/index.md');
  assert.equal(contentItemPath('post', '', 'x'), 'house/posts/x/index.md');
});

test('contentItemPath: unsupported type / missing slug -> null', () => {
  assert.equal(contentItemPath('share', 'hudson', 's'), null);
  assert.equal(contentItemPath('post', 'hudson', undefined), null);
});

test('toIndexItem: metadata only, derives url + path, never a body', () => {
  const it = toIndexItem({ data: { slug: 'hello', title: 'Hello', author: 'hudson', excerpt: 'hi', publishedAt: new Date('2026-01-01'), visibility: 'members' } }, 'post');
  assert.equal(it.path, 'members/hudson/posts/hello/index.md');
  assert.equal(it.url, '/blog/hello/');
  assert.equal(it.visibility, 'members');
  assert.equal(it.excerpt, 'hi');
  assert.ok(!('body' in it) && !('encryptedBody' in it), 'no body / no enc path in the public index');
  assert.equal(it.author, 'hudson');
});

test('isReadablePath: only published content index.md in the three subtrees, no traversal / no oracle', () => {
  for (const ok of ['members/hudson/posts/x/index.md', 'house/products/y/index.md', 'members/a/prompts/z/index.md']) {
    assert.ok(isReadablePath(ok), `should allow ${ok}`);
  }
  for (const bad of [
    'members/hudson/../roles.yml/index.md', // traversal
    'house/pages/about/index.md',           // not a content subtree
    'house/roles.yml',                      // a control file
    'members/hudson/posts/x/secret.md',     // not index.md
    'members/hudson/shares/s.md',           // shares are not via this route
    '/members/hudson/posts/x/index.md',     // leading slash
    'members//posts/x/index.md',            // empty owner
    42, null, undefined,
  ]) {
    assert.equal(isReadablePath(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test('READ_PATH_RE is anchored (no prefix/suffix escape)', () => {
  assert.equal(READ_PATH_RE.test('x members/h/posts/y/index.md'), false);
  assert.equal(READ_PATH_RE.test('members/h/posts/y/index.md extra'), false);
});
