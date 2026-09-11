// A comment's audience is its author's choice (owner, 2026-09-11): Members only (the default) or Public, on
// compose and on edit, with a flip re-publishing the comment. SOW-044's "public only as a from-the-author intro"
// rule ended; the leak rule stayed (a members body is never committed plaintext) and gained its mirror (a
// public comment carries no encryptedBody). These pin the comment box, the website client, the shared
// publisher's stale-ciphertext delete, and the two guards' source. The extension ops are exercised with a
// fake repo in test/comment-authoring.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the comment box: the compact editor replaces the textarea, the Members only | Public control defaults to members, an intro forces public, and both post and save send the choice', () => {
  const box = read('client-ui/src/elements/gbti-comment-box.mjs');
  assert.match(box, /import '\.\/gbti-prose-editor\.mjs';/);
  assert.match(box, /<gbti-prose-editor data-editor><\/gbti-prose-editor>/);
  assert.doesNotMatch(box, /<textarea/, 'no plain textarea left');
  assert.match(box, /_bodyValue\(\) \{ return String\(this\.\$\('\[data-editor\]'\)\?\.value \|\| ''\)\.trim\(\); \}/);
  assert.match(box, /const vis = visibility === 'public' \? 'public' : 'members';/, 'members is the default');
  assert.match(box, /<button type="button" data-vis="members"[^>]*>Members only<\/button>\s*<button type="button" data-vis="public"[^>]*>Public<\/button>/);
  assert.match(box, /if \(e\.target\.checked\) \{ this\._visBeforeNote = this\._vis; this\._vis = 'public'; if \(row\) row\.hidden = true; \}/, 'an intro is public by definition');
  assert.match(box, /const visibility = authorNote \? 'public' : \(this\._vis === 'public' \? 'public' : 'members'\);/, 'post sends the choice');
  assert.match(box, /const visibility = this\._vis === 'public' \? 'public' : 'members';\s*const res = await this\.client\.editComment\(\{ id: this\._editId, body, visibility \}\);/, 'save sends the choice');
  assert.match(box, /visibility = c\?\.visibility \?\? c\?\.frontmatter\?\.visibility \?\? 'members';/, 'edit prefills the current audience');
  assert.match(box, /if \(commentBodyTooLong\(body\)\)/, 'the byte cap the textarea maxlength used to give');
});

test('the website client: getComment carries visibility; editComment honours a given audience and deletes the old ciphertext on a public flip', () => {
  const src = read('src/lib/workbench-client.ts');
  assert.match(src, /visibility: \(frontmatter as any\)\?\.visibility === 'public' \? 'public' : 'members' \};/, 'getCommentLocal');
  assert.match(src, /async editComment\(\{ id, body, authorNote, visibility \}: any\)/);
  assert.match(src, /const effVisibility = visibility === 'public' \|\| visibility === 'members' \? visibility : \(fm\.visibility === 'public' \? 'public' : 'members'\);/);
  assert.match(src, /commitComment\(input, body \?\? '', \{ removeEnc: typeof fm\.encryptedBody === 'string' \? fm\.encryptedBody : null \}\)/);
  assert.match(src, /if \(!plan\?\.encPath && typeof removeEnc === 'string' && removeEnc\.startsWith\(`members\/\$\{user\}\/_enc\/`\)\) files\.push\(\{ path: removeEnc, content: null \}\);/, 'own _enc only, and only when nothing was encrypted this time');
});

test('the extension ops: publishComment takes the choice, editComment takes it and hands the stale .enc to the publisher, which deletes it', () => {
  const src = read('client/src/operations-social.mjs');
  assert.match(src, /input\.visibility = \(visibility === 'public' \|\| isPublicIntro\) \? 'public' : 'members';/);
  assert.match(src, /export async function editComment\(ctx, \{ id, body, authorNote, visibility \} = \{\}\)/);
  assert.match(src, /const staleEnc = input\.visibility === 'public' && typeof fm\.encryptedBody === 'string' && fm\.encryptedBody\.startsWith\(`members\/\$\{idn\.username\}\/_enc\/`\) \? fm\.encryptedBody : null;/);
  assert.match(src, /export async function planAndPublishComment\(ctx, repo, built, body, \{ message, title, prBody, removeEnc = null \} = \{\}\)/);
  assert.match(src, /if \(!plan\?\.encPath && typeof removeEnc === 'string' && removeEnc\) files\.push\(\{ path: removeEnc, content: null \}\);/);
});

test('the two guards: no "public only as an intro" rule; the members plaintext rule stays; a public comment with an encryptedBody is refused', () => {
  const v = read('scripts/validate-content.mjs');
  const g = read('scripts/check-build-secrets.mjs');
  for (const s of [v, g]) {
    assert.doesNotMatch(s, /only allowed as a from-the-author intro/);
    assert.match(s, /encryptedBody/);
  }
  assert.match(v, /a members-only comment must encrypt its body to an encryptedBody \.enc, never commit plaintext/);
  assert.match(v, /a public comment must not carry an encryptedBody pointer/);
  assert.match(g, /a members-only comment committed plaintext \(no encryptedBody\)/);
  assert.match(g, /a public comment carries an encryptedBody pointer/);
});
