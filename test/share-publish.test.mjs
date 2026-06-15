// SOW-018: the Share build + member-only encryption planning. buildShareFile forces the owner as author and
// writes the flat members/<u>/shares/<id>.md layout; planMemberFiles encrypts a members Share's body to an
// _enc/ sibling (Mode A), while a public Share publishes as a single plain file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShareFile, shareId } from '../client/src/content-ops.mjs';
import { planMemberFiles } from '../client/src/operations.mjs';

test('shareId: derives a sortable, filesystem-safe timestamp-slug', () => {
  assert.equal(shareId('2026-06-10T13:22:09Z', 'Astro is GREAT!'), '20260610132209-astro-is-great');
  assert.equal(shareId('2026-06-10T13:22:09Z', ''), '20260610132209-share');
  assert.match(shareId('2026-06-10T13:22:09Z', '../../etc/passwd'), /^20260610132209-[a-z0-9-]+$/); // no traversal
});

test('buildShareFile: forces author = owner and the flat shares/ path', () => {
  const built = buildShareFile({
    username: 'alice',
    input: { id: '20260610-x', author: 'mallory', visibility: 'public', title: 'Hi', createdAt: '2026-06-10T00:00:00Z' },
    body: 'a short note',
  });
  assert.equal(built.path, 'members/alice/shares/20260610-x.md');
  assert.equal(built.frontmatter.author, 'alice'); // the spoofed author is overwritten with the owner
  assert.equal(built.type, 'share');
  assert.equal(built.slug, '20260610-x');
  assert.match(built.markdown, /a short note/);
});

test('buildShareFile: rejects a Share with no createdAt (schema failure)', () => {
  assert.throws(() => buildShareFile({ username: 'alice', input: { id: 'x', visibility: 'members' }, body: 'hi' }), /invalid share/);
});

test('planMemberFiles: a members Share encrypts its whole body to an _enc/ sibling (Mode A)', async () => {
  const built = buildShareFile({
    username: 'alice',
    input: { id: '20260610-x', visibility: 'members', createdAt: '2026-06-10T00:00:00Z' },
    body: 'a members-only thought',
  });
  const calls = [];
  const encrypt = async (plaintext, assetId) => { calls.push({ plaintext, assetId }); return { v: 1, kid: '1', iv: 'iv', aad: assetId, ct: 'ct' }; };
  const plan = await planMemberFiles({ built, body: 'a members-only thought', encrypt });
  assert.ok(plan, 'a members Share is planned for encryption');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].assetId, 'share:20260610-x:body'); // encAssetFor('share', user, id)
  assert.equal(plan.encPath, 'members/alice/_enc/share-20260610-x-body.enc');
  // index.md keeps only the stub (encryptedBody ref, empty public body); the .enc carries the ciphertext.
  const stub = plan.files.find((f) => f.path === built.path);
  assert.match(stub.content, /encryptedBody: members\/alice\/_enc\/share-20260610-x-body\.enc/);
  assert.doesNotMatch(stub.content, /a members-only thought/);
  assert.ok(plan.files.some((f) => f.path === plan.encPath));
});

test('planMemberFiles: a public Share is a plain single file (no encryption)', async () => {
  const built = buildShareFile({
    username: 'alice',
    input: { id: '20260610-y', visibility: 'public', createdAt: '2026-06-10T00:00:00Z' },
    body: 'a public note',
  });
  let called = false;
  const plan = await planMemberFiles({ built, body: 'a public note', encrypt: async () => { called = true; return {}; } });
  assert.equal(plan, null); // null -> the caller publishes the single plain file
  assert.equal(called, false);
});
