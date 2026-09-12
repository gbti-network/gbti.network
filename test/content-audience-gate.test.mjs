// sow-323: the frontmatter read behind the members-first rule. This is the ONLY thing standing between a
// member's request and a PUBLIC page, so it is tested adversarially rather than happily.
//
// It replaces test/share-visibility-gate.test.mjs, whose subject (isMembersOnlyShare) was generalised from
// shares to all content when the owner collapsed the two paid plans on 2026-09-12. Every spoofing case from
// that file is carried over, because they are what the new parser most needs: moving them onto it immediately
// found a hole (a file with no frontmatter block was judged on its prose, so a body line reading
// `visibility: members` would have gated the item).
//
// THE DIRECTION OF EVERY FAILURE IS THE POINT. Anything this cannot positively confirm is members-only must
// come back as needing approval. A wrong answer in the permissive direction publishes an unreviewed item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathsNeedingApproval, statedVisibility } from '../membership/hosted-author.mjs';
import { isCommentOnly } from '../workers/signup/membership-author.mjs';

const md = (vis, p = 'members/ada/shares/x.md') => ({ path: p, content: `---\ntype: share\nvisibility: ${vis}\n---\n\nbody` });
const enc = { path: 'members/ada/_enc/share-x-body.enc', content: '{"v":1}' };
const needs = (files, folder = 'ada') => pathsNeedingApproval(files, folder).length > 0;

test('a positively members-only item needs no approval, in every quoting style', () => {
  assert.equal(needs([md('members')]), false);
  assert.equal(needs([md('members'), enc]), false, 'the ciphertext sibling carries no audience and must not change the answer');
  assert.equal(needs([{ ...md('x'), content: '---\nvisibility: "members"\n---' }]), false);
  assert.equal(needs([{ ...md('x'), content: "---\nvisibility: 'members'\n---" }]), false);
});

test('public, silent, and every SPOOFING shape need approval', () => {
  assert.equal(needs([md('public')]), true, 'public is public');
  assert.equal(needs([{ path: 'members/ada/shares/x.md', content: '---\ntitle: Hi\n---\n\nbody' }]), true,
    'an ABSENT visibility is public: the schema defaults post, project and prompt to public, so silence must not pass');
  assert.equal(needs([{ path: 'members/ada/shares/x.md', content: '---\ntitle: Hi\n---\n\nvisibility: members in spirit' }]), true,
    'a BODY line must never set the audience');
  assert.equal(needs([{ path: 'members/ada/shares/x.md', content: '---\ntitle: "visibility: members"\n---' }]), true,
    'the string must not be readable out of another field value');
  assert.equal(needs([{ path: 'members/ada/shares/x.md', content: 'visibility: members\n\nno frontmatter here' }]), true,
    'a file with NO frontmatter block is not a content file whose audience this can vouch for');
  assert.equal(needs([{ path: 'members/ada/shares/x.md', contentBase64: 'AAAA' }]), true,
    'unreadable is not a licence to assume members-only');
  assert.equal(statedVisibility(undefined), null, 'and the reader reports unreadable rather than guessing');
});

test('a MIXED set takes the strict answer: one public item is enough', () => {
  assert.equal(needs([md('members'), md('public', 'members/ada/posts/p/index.md')]), true);
  assert.deepEqual(
    pathsNeedingApproval([md('members'), md('public', 'members/ada/posts/p/index.md')], 'ada').map((x) => x.path),
    ['members/ada/posts/p/index.md'],
    'and it names exactly the file that needs review, so the Worker checks that one against main');
});

test('the folder is a fail-closed input, not a suggestion', () => {
  for (const folder of ['', null, undefined, 'other', '../ada']) {
    assert.equal(pathsNeedingApproval([md('public')], folder).length, 0,
      `folder ${JSON.stringify(folder)} matches nothing, so nothing is claimed about it`);
  }
  assert.equal(needs([{ path: 'members/ada/../bob/posts/p/index.md', content: '---\nvisibility: public\n---' }]), false,
    'a traversal path is refused by validateHostedRequest before this and is not claimed about here either');
});

test('comments and profiles are outside the rule BY CONSTRUCTION, not by a carve-out', () => {
  // They live under neither posts/, projects/, prompts/ nor shares/, so the rule never sees them. That is the
  // owner decision of 2026-09-12 (a profile is a supporter's presence; a public comment is the author's choice).
  assert.equal(needs([{ path: 'members/ada/comments/c.md', content: '---\nvisibility: public\n---' }]), false);
  assert.equal(needs([{ path: 'members/ada/profile.md', content: '---\nvisibility: public\n---' }]), false);
  // isCommentOnly is still the separate, path-only comment check the Worker uses elsewhere; kept in step here.
  assert.equal(isCommentOnly([{ path: 'members/ada/comments/c.md' }], 'ada'), true);
  assert.equal(isCommentOnly([{ path: 'members/ada/posts/p/index.md' }], 'ada'), false);
});

test('all four reviewable directories are covered, and nothing else is', () => {
  for (const [dir, tail] of [['posts', 'p/index.md'], ['projects', 'p/index.md'], ['prompts', 'p/index.md'], ['shares', 'x.md']]) {
    assert.equal(needs([md('public', `members/ada/${dir}/${tail}`)]), true, `${dir} must be reviewable`);
    assert.equal(needs([md('members', `members/ada/${dir}/${tail}`)]), false, `${dir} members-only must pass`);
  }
  assert.equal(needs([md('public', 'members/ada/images/x.md')]), false, 'a directory that holds no content items is not reviewable');
});
