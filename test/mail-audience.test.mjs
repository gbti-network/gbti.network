// sow-312: the members edition of the weekly digest.
//
// sow-293 made member shares the default, so an email that only ever carries public items gets emptier for
// exactly the people paying for the member stream. The fix is a second audience, and the whole risk of it is
// that widening layer 1 could put a member item in a public inbox.
//
// So the assertions here are mostly about the DEFAULT and the FAILURE direction, not about the happy path:
// an absent, misspelt or hostile audience must narrow to public, and layer 2 must keep stripping bodies for
// both audiences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeIssue, isPublicItem, admitsItem, AUDIENCES } from '../membership/mail-digest.mjs';

// Distinct urls per item: composeIssue dedups on url, so shared fixtures would let a dropped item look like
// a deduped one and vice versa.
let n = 0;
const item = (over = {}) => ({
  kind: 'share', title: 'A share', url: `https://gbti.network/shares/ada/${++n}/`, author: 'ada',
  date: Date.UTC(2026, 8, 1), visibility: 'public', ...over,
});
const compose = (items, opts = {}) => composeIssue({ issueId: 'weekly-2026-09-08', items, now: () => Date.UTC(2026, 8, 8) }, opts);
// `sections` is an object keyed by kind, not an array.
const titles = (issue) => Object.values(issue.sections ?? {}).flat().map((i) => i.title);

test('the DEFAULT audience is the old behaviour, byte for byte', () => {
  // Every existing caller passes no audience. If this ever changes, member items reach the public issue and
  // nothing else in the system would notice.
  assert.equal(admitsItem(undefined), isPublicItem);
  assert.equal(admitsItem('public'), isPublicItem);

  const issue = compose([item({ title: 'Public one' }), item({ title: 'Member one', visibility: 'members' })]);
  assert.deepEqual(titles(issue), ['Public one'], 'the default issue must carry no member item');
});

test('an unrecognised audience NARROWS to public rather than widening', () => {
  // The failure this guards is a member item in a public inbox, so anything not exactly 'members' is public.
  for (const bad of [null, '', 'member', 'MEMBERS', 'Members', 'all', 'everyone', 0, 1, true, {}, [], 'public ']) {
    assert.equal(admitsItem(bad), isPublicItem, `audience ${JSON.stringify(bad)} must fall back to public`);
    const issue = compose([item({ title: 'Member one', visibility: 'members' })], { audience: bad });
    assert.deepEqual(titles(issue), [], `audience ${JSON.stringify(bad)} must admit no member item`);
  }
});

test('the members audience admits member items AND keeps the public ones', () => {
  const issue = compose(
    [item({ title: 'Public one' }), item({ title: 'Member one', visibility: 'members' })],
    { audience: 'members' },
  );
  assert.deepEqual(titles(issue).sort(), ['Member one', 'Public one'],
    'the members edition is a superset: it is the whole digest plus the member stream, not a member-only email');
});

test('an item with NO visibility is dropped for BOTH audiences', () => {
  // Absent is not members-only and it is not public either. The schema default for a share is public, so a
  // missing value here means the field was lost in transit, and the safe read of a lost field is "drop it".
  for (const audience of AUDIENCES) {
    const issue = compose([item({ title: 'No visibility', visibility: undefined }), item({ title: 'Junk', visibility: 'nonsense' })], { audience });
    assert.deepEqual(titles(issue), [], `audience ${audience} must drop an item with no usable visibility`);
  }
});

test('layer 2 still strips bodies for the members audience', () => {
  // Widening layer 1 must not widen what an admitted item can SAY. The projection copies metadata only, so a
  // member item carries no body or ciphertext into the email even though it is now admitted.
  const issue = compose(
    [item({ title: 'Member one', visibility: 'members', body: 'SECRET BODY', encryptedBody: 'CIPHERTEXT', content: 'ALSO SECRET' })],
    { audience: 'members' },
  );
  const rendered = JSON.stringify(issue);
  assert.match(rendered, /Member one/, 'the control: the item really is in this issue, so the absences below mean something');
  for (const leak of ['SECRET BODY', 'CIPHERTEXT', 'ALSO SECRET']) {
    assert.ok(!rendered.includes(leak), `the composed issue carries ${leak}`);
  }
});

test('AUDIENCES is the definition, and public is first', () => {
  assert.deepEqual([...AUDIENCES], ['public', 'members']);
});
