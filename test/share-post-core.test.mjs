// SOW-092: the pure helpers behind the share-submit instant redirect — the author parse from the publish
// path and the reader-ready optimistic item (local plaintext body, never an encryptedBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorFromPath, optimisticShareItem, shareComposerView, canSharePublicly, SHARE_LOCKED_STATES } from '../client-ui/src/share-post-core.mjs';

test('authorFromPath parses the owning member from a publish result path', () => {
  assert.equal(authorFromPath('members/atwellpub/shares/20260709120000-hello.md'), 'atwellpub');
  assert.equal(authorFromPath('house/shares/x.md'), null);
  assert.equal(authorFromPath(''), null);
  assert.equal(authorFromPath(null), null);
});

test('optimisticShareItem builds a reader-ready item; members visibility carries body, never encryptedBody', () => {
  const res = { id: '20260709120000-hello', path: 'members/atwellpub/shares/20260709120000-hello.md', visibility: 'members' };
  const input = { title: 'Hello', shortDescription: 'A note', url: 'https://youtu.be/N_GfH09iP9c', image: 'https://i.ytimg.com/x.jpg', visibility: 'members' };
  const it = optimisticShareItem({ res, input, body: 'my **note**', now: '2026-07-09T12:00:00.000Z' });
  assert.equal(it.type, 'share');
  assert.equal(it.author, 'atwellpub');
  assert.equal(it.id, res.id);
  assert.equal(it.title, 'Hello');
  assert.equal(it.shortDescription, 'A note');
  assert.equal(it.url, input.url);
  assert.equal(it.image, input.image);
  assert.equal(it.visibility, 'members');
  assert.equal(it.body, 'my **note**');
  assert.equal(it.createdAt, '2026-07-09T12:00:00.000Z');
  assert.equal('encryptedBody' in it, false, 'the optimistic item never carries an encryptedBody');
  // No id or an unparseable path -> no redirect target.
  assert.equal(optimisticShareItem({ res: { id: null, path: res.path } }), null);
  assert.equal(optimisticShareItem({ res: { id: 'x', path: 'weird/path.md' } }), null);
});

// sow-204: the composer's five states. sow-218 built the Content Creator gate, the owner narrowed it again on
// 2026-08-28, and NOTHING in the suite asserted any of it: a grep for the element's own branch names across
// test/ returned zero files, and the control (the trial branch, which has existed far longer) returned zero
// too, so it was the coverage that was missing rather than the search that was wrong.
test('shareComposerView: every membership and tier lands on the state the member is actually in', () => {
  const v = (o) => shareComposerView(o);
  // Order matters and is asserted, not assumed: no-client outranks everything, because a signed-in creator
  // reading the site with no extension must still be told where Shares are posted from.
  assert.equal(v({ hasClient: false, membership: 'paid', tier: 'creator' }), 'no-client');
  assert.equal(v(), 'no-client', 'no arguments at all is the inert public-site case, not a crash');
  assert.equal(v({ hasClient: true }), 'loading', 'an unresolved membership is loading, never a denial');

  for (const m of ['expired', 'cancelled', 'none', 'banned']) {
    assert.equal(v({ hasClient: true, membership: m, tier: 'creator' }), 'locked',
      `${m} is locked even holding creator tier: a lapse outranks the tier it used to pay for`);
  }
  assert.equal(v({ hasClient: true, membership: 'trialing', tier: 'creator' }), 'trial');

  // sow-293 REVERSED the owner's 2026-08-28 ruling on 2026-09-03. A paid Network Member used to get an
  // upgrade splash INSTEAD of the composer; sharing is now open to every paid member and the tier gates the
  // VISIBILITY instead. The upgrade nudge did not vanish, it moved to the public option (canSharePublicly).
  assert.equal(v({ hasClient: true, membership: 'paid', tier: 'member' }), 'composer',
    'sharing opened to every paid member on 2026-09-03; the tier now gates visibility, not the composer');
  assert.equal(v({ hasClient: true, membership: 'paid', tier: 'creator' }), 'composer');
  for (const t of [null, undefined, '']) {
    assert.equal(v({ hasClient: true, membership: 'paid', tier: t }), 'composer');
  }
  assert.equal(v({ hasClient: true, membership: 'unknown', tier: null }), 'composer');
});

test('sow-323 canSharePublicly: only a SUPERADMIN chooses Public, and an already-public share keeps it while edited', () => {
  const p = (o) => canSharePublicly(o);
  // Owner, 2026-09-15: "Only superadmins can make shares public though, so don't even give members the option on
  // creation." The trusted tier waives review for articles, projects and prompts, NOT for shares.
  assert.equal(p({ membership: 'paid', role: 'superadmin' }), true);
  for (const role of ['member', 'moderator', 'admin']) {
    assert.equal(p({ membership: 'paid', role }), false, `${role} gets no Public option`);
  }
  assert.equal(p({ membership: 'paid', role: 'member', tier: 'creator' }), false, 'a trusted author gets no Public option for a share');
  // FAILS CLOSED on an unknown role now: the Worker refuses everyone but a superadmin, so offering it on a guess
  // only offers something the server then refuses.
  for (const role of [null, undefined, '']) assert.equal(p({ membership: 'paid', role }), false, JSON.stringify(role));
  // an approved share must not be taken down by its author's edit
  assert.equal(p({ membership: 'paid', role: 'member', editingPublic: true }), true);
  // anyone who cannot reach the composer cannot post publicly, superadmin role or not
  for (const m of ['expired', 'cancelled', 'none', 'banned', 'trialing']) {
    assert.equal(p({ membership: m, role: 'superadmin' }), false, m);
    assert.equal(p({ membership: m, role: 'member', editingPublic: true }), false, `${m} editing`);
  }
});

test('SHARE_LOCKED_STATES is the single definition, and the element no longer keeps its own copy', () => {
  // The element held an identical `const LOCKED` until sow-204 moved the branch decision out. Two copies of a
  // membership-state list is how an affordance and the gate it mirrors drift apart without either looking wrong.
  assert.deepEqual([...SHARE_LOCKED_STATES].sort(), ['banned', 'cancelled', 'expired', 'none']);
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-share-composer.mjs', import.meta.url), 'utf8');
  assert.ok(/shareComposerView\(/.test(src), 'the element must ASK the helper, or these assertions test nothing it uses');
  assert.ok(!/^const LOCKED = /m.test(src), 'the element re-declared its own locked-state list');
});

// ---------------------------------------------------------------------------------------------------------
// sow-183 for shares (owner, 2026-09-10): a superadmin may post a share as another member or move one of their
// own shares to another member. The untouched picker must never move anything, and a move may only ever delete
// files inside the share's CURRENT author folder.
// ---------------------------------------------------------------------------------------------------------
import { shareAuthorTarget, authorMoveRemovals } from '../client-ui/src/share-post-core.mjs';

test('shareAuthorTarget: empty or unchanged is undefined; a different clean login is the target; junk is refused', () => {
  assert.equal(shareAuthorTarget('', ''), undefined, 'a new share with "You" selected');
  assert.equal(shareAuthorTarget('alice', 'alice'), undefined, 'an edit whose picker was not touched');
  assert.equal(shareAuthorTarget('Alice ', 'alice'), undefined, 'case and whitespace do not make a move');
  assert.equal(shareAuthorTarget('bob', 'alice'), 'bob');
  assert.equal(shareAuthorTarget('bob', ''), 'bob', 'a new share posted as bob');
  assert.equal(shareAuthorTarget('../house', 'alice'), undefined);
});

test('authorMoveRemovals names the old stub and ciphertext, only inside the current author folder', () => {
  const share = { id: 'x', author: 'alice', path: 'members/alice/shares/x.md', encryptedBody: 'members/alice/_enc/share-x-body.enc' };
  assert.deepEqual(authorMoveRemovals({ share, authorTarget: 'bob' }), ['members/alice/shares/x.md', 'members/alice/_enc/share-x-body.enc']);
  assert.deepEqual(authorMoveRemovals({ share, authorTarget: 'alice' }), [], 'same author: nothing to remove');
  assert.deepEqual(authorMoveRemovals({ share, authorTarget: '' }), []);
  const publicShare = { id: 'y', author: 'alice', path: 'members/alice/shares/y.md' };
  assert.deepEqual(authorMoveRemovals({ share: publicShare, authorTarget: 'bob' }), ['members/alice/shares/y.md'], 'a public share has no ciphertext');
  const odd = { id: 'z', author: 'alice', path: 'members/carol/shares/z.md', encryptedBody: 'members/carol/_enc/share-z-body.enc' };
  assert.deepEqual(authorMoveRemovals({ share: odd, authorTarget: 'bob' }), [], 'paths outside the author folder are never named');
  const fromPath = { id: 'w', path: 'members/alice/shares/w.md' };
  assert.deepEqual(authorMoveRemovals({ share: fromPath, authorTarget: 'bob' }), ['members/alice/shares/w.md'], 'the author is read from the path when the item carries none');
});

// sow-363: a move must not carry a hosted cover url across folders. The cover lives under the author's own
// folder and the covers workflow reaps a copy whose share has left, so the moved share would declare an image
// nobody serves and the og:image build guard would fail every deploy (2026-09-18, production down for an hour).
import { coverAfterAuthorMove } from '../client-ui/src/share-post-core.mjs';

test('coverAfterAuthorMove hands a moved share back its original image, and leaves everything else alone', () => {
  const hosted = {
    id: '20260918165402-estrada', createdAt: '2026-09-18T16:54:02.136Z', title: 'Estrada',
    image: 'https://gbti.network/media/shares/adbox85/20260918165402-estrada-0c76c677.webp',
    imageSource: 'https://i.ytimg.com/vi/sXvmcWWBsFM/maxresdefault.jpg', tags: ['music'],
  };
  const moved = coverAfterAuthorMove(hosted, { fromUser: 'adbox85', toUser: 'gbtilabs' });
  assert.equal(moved.image, 'https://i.ytimg.com/vi/sXvmcWWBsFM/maxresdefault.jpg', 'the original comes back');
  assert.equal('imageSource' in moved, false, 'the switched state goes with it');
  assert.deepEqual(Object.keys(moved), ['id', 'createdAt', 'title', 'image', 'tags'], 'key order is preserved');
  assert.deepEqual(hosted.tags, ['music'], 'the caller’s input is not mutated');

  assert.equal(coverAfterAuthorMove(hosted, { fromUser: 'adbox85', toUser: 'adbox85' }), hosted, 'not a move');
  assert.equal(coverAfterAuthorMove(hosted, { fromUser: '', toUser: 'gbtilabs' }), hosted, 'no old author');

  const outside = { image: 'https://img.example.com/a.jpg', imageSource: 'https://img.example.com/a.jpg' };
  assert.equal(coverAfterAuthorMove(outside, { fromUser: 'adbox85', toUser: 'gbtilabs' }), outside, 'an image we do not serve is untouched');

  const alreadyTheirs = { image: 'https://gbti.network/media/shares/gbtilabs/x-0c76c677.webp', imageSource: 'https://i.ytimg.com/vi/a/max.jpg' };
  assert.equal(coverAfterAuthorMove(alreadyTheirs, { fromUser: 'adbox85', toUser: 'gbtilabs' }), alreadyTheirs, 'a copy already under the new owner stays');

  const noSource = { id: 's1', image: 'https://gbti.network/media/shares/adbox85/x-0c76c677.webp' };
  const dropped = coverAfterAuthorMove(noSource, { fromUser: 'adbox85', toUser: 'gbtilabs' });
  assert.equal('image' in dropped, false, 'with no original recorded the cover is dropped, never left broken');
});

test('the website share transport applies the move cover rule before it builds the file', () => {
  const src = readFileSync(new URL('../src/lib/workbench-client.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ coverAfterAuthorMove, redirectAfterAuthorMove \} from '\.\.\/\.\.\/client-ui\/src\/share-post-core\.mjs'/);
  const post = src.slice(src.indexOf('async postShare('), src.indexOf('async myShares('));
  assert.match(post, /moving\s*\n?\s*\? redirectAfterAuthorMove\(coverAfterAuthorMove\(/, 'the move branch runs the rule (sow-365 composed the redirect rule around it)');
  assert.ok(post.indexOf('coverAfterAuthorMove(') < post.indexOf('buildShareFile('), 'and it runs BEFORE the file is built');
});

// sow-365: a share's public url carries its author, so a move retires the old url. The owner met this as a
// page that still named the old owner and had lost its stylesheet: a cached copy from before the move, served
// because the new build no longer writes that path at all.
import { redirectAfterAuthorMove, editInputFor } from '../client-ui/src/share-post-core.mjs';

test('redirectAfterAuthorMove records the url the move retires, and keeps any earlier one', () => {
  const moved = redirectAfterAuthorMove({ id: 'x', title: 'T' }, { fromUser: 'adbox85', toUser: 'gbtilabs' });
  assert.deepEqual(moved.redirectFrom, ['/shares/adbox85/x/']);
  assert.deepEqual(Object.keys(moved), ['id', 'title', 'redirectFrom']);

  const twice = redirectAfterAuthorMove({ id: 'x', redirectFrom: ['/shares/first/x/'] }, { fromUser: 'adbox85', toUser: 'gbtilabs', id: 'x' });
  assert.deepEqual(twice.redirectFrom, ['/shares/first/x/', '/shares/adbox85/x/'], 'a share moved twice keeps both');

  const again = redirectAfterAuthorMove(twice, { fromUser: 'adbox85', toUser: 'gbtilabs', id: 'x' });
  assert.deepEqual(again.redirectFrom, twice.redirectFrom, 'recording the same move twice adds nothing');

  const same = { id: 'x' };
  assert.equal(redirectAfterAuthorMove(same, { fromUser: 'a', toUser: 'a' }), same, 'not a move');
  assert.equal(redirectAfterAuthorMove(same, { fromUser: '', toUser: 'b' }), same, 'no old author');
  assert.equal(redirectAfterAuthorMove({ title: 'no id' }, { fromUser: 'a', toUser: 'b' }).redirectFrom, undefined);
});

test('sow-365: an edit carries the redirects a move left, so the old url keeps working', () => {
  const share = { id: '20260918165402-x', author: 'gbtilabs', createdAt: '2026-09-18T16:54:02.136Z', status: 'published', visibility: 'public', redirectFrom: ['/shares/adbox85/20260918165402-x/'] };
  const input = editInputFor({ share, fields: { title: 'A new title' }, now: '2026-09-19T00:00:00.000Z' });
  assert.deepEqual(input.redirectFrom, ['/shares/adbox85/20260918165402-x/']);
  assert.equal('redirectFrom' in editInputFor({ share: { ...share, redirectFrom: [] }, fields: {}, now: '2026-09-19T00:00:00.000Z' }), false);
});

test('sow-365: the website share transport records the retired url on a move', () => {
  const src = readFileSync(new URL('../src/lib/workbench-client.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ coverAfterAuthorMove, redirectAfterAuthorMove \}/);
  const post = src.slice(src.indexOf('async postShare('), src.indexOf('async myShares('));
  assert.match(post, /moving\s*\n?\s*\? redirectAfterAuthorMove\(coverAfterAuthorMove\(/);
  assert.ok(post.indexOf('redirectAfterAuthorMove(') < post.indexOf('buildShareFile('), 'it runs BEFORE the file is built');
});
