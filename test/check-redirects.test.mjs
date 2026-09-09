// Launch hardening: the redirects guard. Exercises the resolver against a temp dist: a destination that
// resolves (trailing-slash -> index.html, extensionless -> .html, a verbatim file), one that does not (a
// 301-to-404), and the skip rules for external + wildcard destinations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRedirects, candidatesFor } from '../scripts/check-redirects.mjs';

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-redirects-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  return root;
}
function writeRedirects(root, lines) {
  // SOW-112: the guard now validates the SERVED dist/_redirects (the composed file), not the committed base.
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/_redirects'), lines.join('\n') + '\n');
}
function buildPage(root, relDir) {
  fs.mkdirSync(path.join(root, 'dist', relDir), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', relDir, 'index.html'), '<html>ok</html>');
}

test('passes when every destination resolves in dist', () => {
  const root = tmpRoot();
  buildPage(root, 'blog/hello-world');
  buildPage(root, 'membership');
  writeRedirects(root, [
    '# comment line is ignored',
    '/old/hello/ /blog/hello-world/ 301',
    '/legacy/join/ /membership/ 301',
  ]);
  const { errors, checked } = checkRedirects({ root });
  assert.deepEqual(errors, []);
  assert.equal(checked, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails on a destination that does not resolve (a 301 to a 404)', () => {
  const root = tmpRoot();
  buildPage(root, 'membership');
  writeRedirects(root, ['/ai/gone/ /blog/removed-post/ 301']);
  const { errors } = checkRedirects({ root });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not resolve in dist/);
  assert.match(errors[0], /\/blog\/removed-post\//);
  fs.rmSync(root, { recursive: true, force: true });
});

test('skips external and wildcard destinations', () => {
  const root = tmpRoot();
  // sow-245: one resolvable rule rides along, because a file whose every rule is skipped leaves the guard with
  // no subjects, which is now (correctly) an error of its own. The skip semantics are unchanged.
  buildPage(root, 'membership');
  writeRedirects(root, [
    '/discord https://discord.gg/abc 302',
    '/author/* /members/* 301',
    '/join /membership/ 301',
  ]);
  const { errors, notes, checked } = checkRedirects({ root });
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
  assert.ok(notes.some((n) => /external destination skipped/.test(n)));
  assert.ok(notes.some((n) => /wildcard destination skipped/.test(n)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolves an extensionless destination to <path>.html or <path>/index.html', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'dist/about.html'), '<html>about</html>');
  writeRedirects(root, ['/old-about /about 301']);
  const { errors } = checkRedirects({ root });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolves a verbatim file destination (with extension)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'dist/feed.xml'), '<rss/>');
  writeRedirects(root, ['/rss /feed.xml 301']);
  const { errors } = checkRedirects({ root });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('candidatesFor maps the three destination shapes', () => {
  const d = '/x/dist';
  assert.deepEqual(candidatesFor(d, '/blog/foo/'), [path.join(d, 'blog/foo', 'index.html')]);
  assert.deepEqual(candidatesFor(d, '/feed.xml'), [path.join(d, 'feed.xml')]);
  assert.deepEqual(candidatesFor(d, '/about'), [path.join(d, 'about', 'index.html'), path.join(d, 'about.html')]);
});

// sow-245: INVERTED on purpose. This case used to assert "no error" when the composed file was absent, which is
// the vacuous pass the guard printed for months ("✓ 0 destinations resolve in dist"). A guard with no subjects
// now says so and fails, in the wording check-article-closing-slot established.
test('sow-245: errors (does not merely note) when the composed dist/_redirects is absent', () => {
  const root = tmpRoot();
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  const { errors, checked } = checkRedirects({ root });
  assert.equal(checked, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /dist\/_redirects not found, so this guard had no subjects and proved nothing/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-245: errors when dist/ itself is absent (the pre-build run)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-redirects-'));
  const { errors } = checkRedirects({ root });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not found, so this guard had no subjects/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-245: a PARTIAL dist (pages built, _redirects with no resolvable rule) fails rather than passing on zero', () => {
  const root = tmpRoot();
  buildPage(root, 'membership');
  writeRedirects(root, ['# only comments and an external rule', '/old https://example.com/new 301']);
  const { errors, checked } = checkRedirects({ root });
  assert.equal(checked, 0, 'the external rule is skipped, so nothing was resolved');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no root-relative destination to resolve, so this guard had no subjects/);
  fs.rmSync(root, { recursive: true, force: true });
});
