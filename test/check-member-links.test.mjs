// sow-362: the build guard that stops a member's own name linking to a page we never built.
//
// A member folder appears the moment someone comments, shares or publishes; a profile.md is written later, or
// never. Between the two, every card naming them linked to /members/<username>/ and that page did not exist.
// Measured live on 2026-09-18: a comment author's name and avatar on a published prompt page, both 404.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkMemberLinks, builtMemberPages } from '../scripts/check-member-links.mjs';

/** A throwaway dist: member pages that exist, plus pages carrying whatever HTML the case needs. */
function dist(pages, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memberlinks-'));
  for (const u of pages) {
    fs.mkdirSync(path.join(dir, 'members', u), { recursive: true });
    fs.writeFileSync(path.join(dir, 'members', u, 'index.html'), '<html>member</html>');
  }
  for (const [rel, html] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), html);
  }
  return dir;
}

test('sow-362: a link to a member page that was built passes', () => {
  const d = dist(['atwellpub', 'bomsn'], {
    'articles/x/index.html': '<a href="/members/atwellpub/">atwellpub</a> and <a href="/members/bomsn/">bomsn</a>',
  });
  const r = checkMemberLinks({ distDir: d });
  assert.deepEqual(r.errors, []);
  assert.equal(r.checked, 2);
});

test('sow-362: a link to a member with no page FAILS, and the message names every page carrying it', () => {
  const d = dist(['atwellpub'], {
    'prompts/a/index.html': '<a href="/members/rafael-minuesa/"><img></a><a href="/members/rafael-minuesa/">rafael-minuesa</a>',
    'feeds/index.html': '<a href="/members/rafael-minuesa/">rafael-minuesa</a>',
    'index.html': '<a href="/members/atwellpub/">fine</a>',
  });
  const r = checkMemberLinks({ distDir: d });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /\/members\/rafael-minuesa\/ is linked from 2 page\(s\)/);
  assert.match(r.errors[0], /prompts\/a\/index\.html/);
  assert.match(r.errors[0], /feeds\/index\.html/);
  assert.match(r.errors[0], /profileHref\(\)/, 'and it says what to use instead');
});

test('sow-362: the members DIRECTORY is not a member, and never reads as a broken link', () => {
  const d = dist(['atwellpub'], { 'index.html': '<a href="/members/">All members</a><a href="/members/atwellpub/">me</a>' });
  const r = checkMemberLinks({ distDir: d });
  assert.deepEqual(r.errors, []);
  assert.equal(r.checked, 1, 'only the real member link was counted');
});

test('sow-362: a query or a fragment does not hide a broken link', () => {
  // The first regex required a quote straight after the slash, so /members/x/#projects slipped past it: a 404
  // this guard would have reported as fine.
  const d = dist(['atwellpub'], { 'index.html': '<a href="/members/ghost/#projects">g</a><a href="/members/ghost/?tab=x">g</a>' });
  const r = checkMemberLinks({ distDir: d });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /\/members\/ghost\/ is linked from 1 page\(s\)/);
});

test('sow-362: a link with no trailing slash is checked too', () => {
  const d = dist(['atwellpub'], { 'index.html': '<a href="/members/ghost">g</a>' });
  assert.equal(checkMemberLinks({ distDir: d }).errors.length, 1);
});

test('sow-362: the guard ERRORS rather than passing when it has no subjects (sow-245)', () => {
  // Three ways to get a green tick over nothing, and all three are the partial build this exists to catch.
  const missing = checkMemberLinks({ distDir: path.join(os.tmpdir(), 'memberlinks-does-not-exist') });
  assert.match(missing.errors.join(' '), /dist not found/);

  const noPages = dist([], { 'index.html': '<a href="/members/x/">x</a>' });
  assert.match(checkMemberLinks({ distDir: noPages }).errors.join(' '), /no member pages/);

  const noLinks = dist(['atwellpub'], { 'index.html': '<p>a site with no bylines at all</p>' });
  assert.match(checkMemberLinks({ distDir: noLinks }).errors.join(' '), /proved nothing/);
});

test('sow-362: a built member page is one with an index.html, not just a directory', () => {
  const d = dist(['atwellpub'], { 'index.html': '<a href="/members/atwellpub/">me</a>' });
  fs.mkdirSync(path.join(d, 'members', 'empty-dir'), { recursive: true });
  const pages = builtMemberPages(d);
  assert.ok(pages.has('atwellpub'));
  assert.ok(!pages.has('empty-dir'), 'an empty directory is not a page Cloudflare would serve');
});
