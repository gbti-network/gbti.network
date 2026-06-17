// SOW-031: the per-type content index path derivation + the reader read-route allowlist. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentItemPath, toIndexItem, thumbOf, isReadablePath, READ_PATH_RE } from '../src/lib/content-index.mjs';

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
  assert.equal(it.url, '/articles/hello/');
  assert.equal(it.visibility, 'members');
  assert.equal(it.excerpt, 'hi');
  assert.ok(!('body' in it) && !('encryptedBody' in it), 'no body / no enc path in the public index');
  assert.equal(it.author, 'hudson');
});

test('toIndexItem: carries the top-level category for the UI fallback glyph', () => {
  const it = toIndexItem({ data: { slug: 'p', title: 'P', author: 'gbti', categories: ['ai', 'agents'] } }, 'prompt');
  assert.equal(it.category, 'ai'); // the TOP segment of the categories path
  const none = toIndexItem({ data: { slug: 'q', title: 'Q', author: 'gbti' } }, 'prompt');
  assert.equal(none.category, null); // no categories -> null (the UI falls back to a neutral glyph)
});

test('thumbOf: per-type field + Astro image()/string normalization, null fallback (SOW-031)', () => {
  // post -> coverImage; an Astro image() field is an ImageMetadata object, so emit its build-optimized .src
  assert.equal(thumbOf({ coverImage: { src: '/_astro/cover.abc.webp', width: 1200 } }, 'post'), '/_astro/cover.abc.webp');
  // product -> icon preferred, then featuredImage, then banner
  assert.equal(thumbOf({ icon: { src: '/_astro/i.webp' }, featuredImage: { src: '/_astro/f.webp' } }, 'product'), '/_astro/i.webp');
  assert.equal(thumbOf({ featuredImage: { src: '/_astro/f.webp' } }, 'product'), '/_astro/f.webp');
  assert.equal(thumbOf({ banner: { src: '/_astro/b.webp' } }, 'product'), '/_astro/b.webp');
  // prompt -> image; a plain string passes through (tests / a raw path)
  assert.equal(thumbOf({ image: '/_astro/p.webp' }, 'prompt'), '/_astro/p.webp');
  // no image -> null (graceful: the UI renders no <img>)
  assert.equal(thumbOf({}, 'post'), null);
  assert.equal(thumbOf({ coverImage: null }, 'post'), null);
  assert.equal(thumbOf({ coverImage: {} }, 'post'), null); // object without .src
  assert.equal(thumbOf({ image: { src: '/_astro/x.webp' } }, 'share'), null); // unsupported type
});

test('toIndexItem: carries the thumb (SOW-031), still no body', () => {
  const it = toIndexItem({ data: { slug: 'p', title: 'P', author: 'gbti', coverImage: { src: '/_astro/c.webp' } } }, 'post');
  assert.equal(it.thumb, '/_astro/c.webp');
  const none = toIndexItem({ data: { slug: 'q', title: 'Q', author: 'gbti' } }, 'post');
  assert.equal(none.thumb, null);
  assert.ok(!('body' in it), 'no body in the public index');
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
