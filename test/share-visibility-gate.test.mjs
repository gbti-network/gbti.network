// sow-293: PUBLIC sharing stays Content Creator; members-only sharing opened to every paid member.
//
// This is the enforcement point the owner's 2026-09-03 ruling leans on. The PR gate reads changed PATHS only
// and cannot see a share's visibility, so it admits any own-folder share at Network Member tier; the Worker
// is what actually tells a public share from a members-only one, because it receives the file CONTENTS it is
// about to commit. If isMembersOnlyShare is wrong in the permissive direction, nothing else catches it.
//
// Every case below is a way a public share could be dressed up as a members-only one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isMembersOnlyShare, isCommentOnly } from '../workers/signup/membership-author.mjs';

const md = (visibility) => ({
  path: 'members/ada/shares/2026-09-03-hi.md',
  content: `---\ntitle: Hi\nvisibility: ${visibility}\ncreatedAt: 2026-09-03T00:00:00Z\n---\n\nbody`,
});
const enc = { path: 'members/ada/shares/2026-09-03-hi.enc', content: 'BASE64CIPHERTEXT' };

test('a members-only share, with and without its encrypted sibling, is exempt from the creator gate', () => {
  assert.equal(isMembersOnlyShare([md('members')], 'ada'), true);
  // The normal shape: a members-only share commits a stub .md plus a sibling .enc holding the encrypted body.
  assert.equal(isMembersOnlyShare([md('members'), enc], 'ada'), true);
  // Quoted forms are the same value.
  assert.equal(isMembersOnlyShare([{ ...md('x'), content: '---\nvisibility: "members"\n---' }], 'ada'), true);
  assert.equal(isMembersOnlyShare([{ ...md('x'), content: "---\nvisibility: 'members'\n---" }], 'ada'), true);
});

test('a PUBLIC share is not exempt, and neither is one that simply omits the field', () => {
  assert.equal(isMembersOnlyShare([md('public')], 'ada'), false);
  // ABSENT IS NOT MEMBERS-ONLY. The schema default for a share is `public`, so silence means public, and
  // treating a missing field as members-only would let every omitting client publish publicly for free.
  assert.equal(isMembersOnlyShare([{ path: 'members/ada/shares/x.md', content: '---\ntitle: Hi\n---\n\nbody' }], 'ada'), false);
  // A `visibility: members` that is not a frontmatter line of its own must not count.
  assert.equal(isMembersOnlyShare([{ path: 'members/ada/shares/x.md', content: '---\ntitle: Hi\n---\n\nvisibility: members in spirit' }], 'ada'), false);
  assert.equal(isMembersOnlyShare([{ path: 'members/ada/shares/x.md', content: '---\ntitle: "visibility: members"\n---' }], 'ada'), false);
});

test('it fails closed on anything it cannot positively confirm', () => {
  for (const [label, files] of [
    ['a non-array', null],
    ['an empty set', []],
    ['a string entry with no content to read', ['members/ada/shares/x.md']],
    ['content that is not a string', [{ path: 'members/ada/shares/x.md', content: null }]],
    ['content missing entirely', [{ path: 'members/ada/shares/x.md' }]],
    ['an .enc with NO .md to judge', [enc]],
    ['a path outside shares/', [{ ...md('members'), path: 'members/ada/posts/p/index.md' }]],
    ['another member\'s folder', [{ ...md('members'), path: 'members/mallory/shares/x.md' }]],
    ['a traversal', [{ ...md('members'), path: 'members/ada/shares/../../mallory/shares/x.md' }]],
    ['one public file smuggled into an otherwise members-only set', [md('members'), { ...md('public'), path: 'members/ada/shares/other.md' }]],
  ]) {
    assert.equal(isMembersOnlyShare(files, 'ada'), false, `${label} must NOT be treated as a members-only share`);
  }
  for (const folder of [null, undefined, '', 42]) {
    assert.equal(isMembersOnlyShare([md('members')], folder), false, `folder ${JSON.stringify(folder)} must fail closed`);
  }
});

test('the two exemptions stay independent: a share is not a comment and a comment is not a share', () => {
  // They are separate gates on purpose. A regression that made one accept the other's paths would widen both.
  assert.equal(isCommentOnly([md('members')], 'ada'), false, 'a share must not pass the comment exemption');
  assert.equal(
    isMembersOnlyShare([{ path: 'members/ada/comments/c.md', content: '---\nvisibility: members\n---' }], 'ada'),
    false,
    'a comment must not pass the share exemption',
  );
});
