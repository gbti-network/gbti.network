// SOW-015: the build-secrets guard. Exercises both leak paths against a temp repo root: a leaked secret value
// in dist, a plaintext committed beside (or AS) a .enc, and a clean tree that passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBuildSecrets } from '../scripts/check-build-secrets.mjs';

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-guard-'));
  fs.mkdirSync(path.join(root, 'house/_enc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist/_astro'), { recursive: true });
  return root;
}
const validEnvelope = JSON.stringify({ v: 1, kid: '1', iv: 'AAAAAAAAAAAAAAAA', aad: 'a', ct: 'AAAA' });

test('a clean tree passes (valid .enc, no plaintext, no leak)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'house/_enc/ok.enc'), validEnvelope);
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<html>ok</html>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails on a leaked secret value in dist (any non-binary file)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'house/_enc/ok.enc'), validEnvelope);
  fs.writeFileSync(path.join(root, 'dist/sitemap.xml'), '<url>SECRETKEYVALUE123456</url>');
  const { errors } = checkBuildSecrets({ root, env: { SCAN_SECRETS: 'SECRETKEYVALUE123456' } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /leaked SCAN_SECRETS value/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails on plaintext committed beside a .enc', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'house/_enc/x.enc'), validEnvelope);
  fs.writeFileSync(path.join(root, 'house/_enc/x'), 'the raw plaintext');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /plaintext committed beside ciphertext/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails when a .enc is actually plaintext / a malformed envelope', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'house/_enc/fake.enc'), 'this is not encrypted at all');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /not valid JSON|not a valid v1 encrypted envelope/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: the members-only marker leaking into dist fails the build', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'dist/blog/leaky'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/blog/leaky/index.html'), '<article>teaser <!-- members-only --> gated tail</article>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /members-only marker leaked/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: a Mode A item with a public page in dist fails the build', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'house/posts/secret'), { recursive: true });
  fs.writeFileSync(path.join(root, 'house/posts/secret/index.md'), '---\ntype: post\nslug: secret\nvisibility: members\npublicStub: false\n---\n');
  fs.mkdirSync(path.join(root, 'dist/blog/secret'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/blog/secret/index.html'), '<html>oops a Mode A page got built</html>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /Mode A item .* has a public page in dist/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: a Mode A item with NO dist page passes (the normal case)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'house/posts/secret'), { recursive: true });
  fs.writeFileSync(path.join(root, 'house/posts/secret/index.md'), '---\ntype: post\nslug: secret\nvisibility: members\npublicStub: false\n---\n');
  // no dist/blog/secret/ page
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

// SOW-018: the extension-only tripwire must catch a Share leaking onto a public surface.
test('SOW-018: a public /shares/ page in dist fails the build (Shares are extension-only)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'dist/shares'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/shares/index.html'), '<html>nope</html>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /public \/shares\/ surface exists in dist/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-018: a Share in the public activity-index.json fails the build', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'dist/activity-index.json'), JSON.stringify({ entries: [{ type: 'post', slug: 'a' }, { type: 'share', slug: 'x' }] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /Share appears in the public activity-index/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-018: a normal activity-index (no share) and no /shares/ passes the tripwire', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'dist/activity-index.json'), JSON.stringify({ entries: [{ type: 'post', slug: 'a' }, { type: 'prompt', slug: 'b' }] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: a Mode B item authored `publicStub: True` (capital) is NOT misclassified as Mode A', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'house/posts/stub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'house/posts/stub/index.md'), '---\ntype: post\nslug: stub\nvisibility: members\npublicStub: True\n---\n');
  fs.mkdirSync(path.join(root, 'dist/blog/stub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/blog/stub/index.html'), '<html>a legit Mode B stub page</html>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, [], 'publicStub: True is a stub (Mode B), so its page is allowed');
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: a key value written into a .enc file in dist is still caught', () => {
  const root = tmpRoot();
  const key = 'KEYMATERIAL_IN_ENC_1234567890';
  fs.writeFileSync(path.join(root, 'dist/leak.enc'), JSON.stringify({ note: key }));
  const { errors } = checkBuildSecrets({ root, env: { SCAN_SECRETS: key } });
  assert.ok(errors.some((e) => /leaked SCAN_SECRETS value/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

// SOW-044: comments are members-only + encrypted; the only public comment is a from-the-author intro.
const writeComment = (root, rel, fm) => {
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  const body = fm.__body ?? '';
  const front = Object.entries(fm).filter(([k]) => k !== '__body').map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(path.join(root, rel), `---\n${front}\n---\n${body}\n`);
};

test('SOW-044: a public discussion comment (no authorNote) fails the build', () => {
  const root = tmpRoot();
  writeComment(root, 'members/alice/comments/c1.md', { type: 'comment', visibility: 'public', targetType: 'post', __body: 'a public reply' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /a public comment is only allowed as a from-the-author intro/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-044: a public comment on a SHARE fails the build even with authorNote', () => {
  const root = tmpRoot();
  writeComment(root, 'members/alice/comments/c2.md', { type: 'comment', visibility: 'public', authorNote: true, targetType: 'share', __body: 'reply' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /a public comment is only allowed as a from-the-author intro/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-044: a from-the-author intro (authorNote on a product) is allowed public', () => {
  const root = tmpRoot();
  writeComment(root, 'house/comments/intro-radle.md', { type: 'comment', visibility: 'public', authorNote: true, targetType: 'product', __body: 'why I built this' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-044: a members comment committed with plaintext (no encryptedBody) fails the build', () => {
  const root = tmpRoot();
  writeComment(root, 'members/alice/comments/c3.md', { type: 'comment', visibility: 'members', targetType: 'post', __body: 'secret reply text' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /committed plaintext \(no encryptedBody\)/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-044: a members comment with an empty stub + encryptedBody passes (the encrypted normal case)', () => {
  const root = tmpRoot();
  writeComment(root, 'members/alice/comments/c4.md', { type: 'comment', visibility: 'members', targetType: 'post', encryptedBody: 'members/alice/_enc/comment-c4-body.enc' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a MEMBER_CONTENT_KEY value present in dist is caught', () => {
  const root = tmpRoot();
  const key = 'A'.repeat(43) + '=';
  fs.writeFileSync(path.join(root, 'dist/_astro/app.js'), `const k="${key}";`);
  const { errors } = checkBuildSecrets({ root, env: { MEMBER_CONTENT_KEY: key } });
  assert.ok(errors.some((e) => /leaked MEMBER_CONTENT_KEY value/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

// SOW-136 (the sow-131 election, scoping SOW-018): public Shares may render in the site feed, but a
// NON-public Share (members visibility or any draft) must leak nothing to dist. The scan matches the
// share's title / blurb / body text across every text file in the build output.
function writeShare(root, rel, lines) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '---\n' + lines.join('\n') + '\n---\n');
}

test('SOW-136: a members-share title appearing in dist fails the build', () => {
  const root = tmpRoot();
  writeShare(root, 'members/alice/shares/x.md', ['status: published', 'visibility: members', 'title: A secret members-only headline', 'id: x', 'author: alice', "createdAt: '2026-01-01T00:00:00Z'"]);
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<h2>A secret members-only headline</h2>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /NON-public Share leaked into build output/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-136: a DRAFT public share leaking into dist also fails (published + public only)', () => {
  const root = tmpRoot();
  writeShare(root, 'members/alice/shares/d.md', ['status: draft', 'visibility: public', 'title: An unpublished draft share headline', 'id: d', 'author: alice', "createdAt: '2026-01-01T00:00:00Z'"]);
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<h2>An unpublished draft share headline</h2>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /NON-public Share leaked into build output/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-136: a published PUBLIC share rendered in dist passes (the scoped reversal)', () => {
  const root = tmpRoot();
  writeShare(root, 'members/alice/shares/p.md', ['status: published', 'visibility: public', 'title: A public share headline on the feed', 'id: p', 'author: alice', "createdAt: '2026-01-01T00:00:00Z'"]);
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<h2>A public share headline on the feed</h2>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-136: a members-share FOLDED blurb (>- style) leaking into dist is caught', () => {
  const root = tmpRoot();
  writeShare(root, 'members/alice/shares/f.md', ['status: published', 'visibility: members', 'shortDescription: >-', '  A folded members-only blurb that', '  spans two source lines.', 'id: f', 'author: alice', "createdAt: '2026-01-01T00:00:00Z'"]);
  fs.mkdirSync(path.join(root, 'dist/page'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/page/index.html'), '<p>A folded members-only blurb that spans two source lines.</p>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /NON-public Share leaked into build output/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});
