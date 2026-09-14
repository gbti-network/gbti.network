// sow-283 / sow-272: everything that READS a share's image once the share-covers workflow can switch it to our
// copy. The digest shows share images but only ours (an outside URL in an email makes the reader's mail client
// contact that host); the composer's edit keeps `imageSource` and a removed preview; both schemas keep the new
// fields instead of silently stripping them; and the switch is not a publish, so nothing is re-announced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSharesIndex } from '../src/lib/shares-index.mjs';
import { memberShareEntry } from '../membership/mail-compile-core.mjs';
import { editInputFor } from '../client-ui/src/share-post-core.mjs';
import { buildShareFile, shareSummary } from '../client/src/content-ops.mjs';
import { shareSchema } from '../client/src/schemas.mjs';
import { selectPublishedTransitions } from '../scripts/lib/publish-transitions.mjs';
import { switchToCopy } from '../scripts/lib/share-covers.mjs';
import { shareCoverUrl } from '../membership/share-cover-url.mjs';

const OURS = shareCoverUrl('ann', 's1-0123abcd.webp');
const shareData = (over) => ({ data: { status: 'published', visibility: 'public', author: 'ann', id: 's1', title: 'T', createdAt: 1000, ...over } });

test('shares-index: a share on our copy carries its absolute URL as thumb; an outside image carries NO thumb', () => {
  assert.equal(buildSharesIndex([shareData({ image: OURS })])[0].thumb, OURS);
  assert.equal(buildSharesIndex([shareData({ image: '/media/shares/ann/s1-0123abcd.webp' })])[0].thumb, OURS, 'root-relative becomes absolute for the email');
  for (const image of ['https://i.ytimg.com/vi/x/maxresdefault.jpg', undefined, 'https://gbti.network.evil.test/media/shares/ann/s1-0123abcd.webp']) {
    assert.equal('thumb' in buildSharesIndex([shareData({ image })])[0], false, String(image));
  }
});

test('member digest entry: thumb only for our copy, never an outside URL', () => {
  const base = { id: 's1', author: 'ann', title: 'T', createdAt: '2026-09-01T00:00:00Z', visibility: 'public' };
  assert.equal(memberShareEntry({ ...base, image: OURS }).thumb, OURS);
  assert.equal('thumb' in memberShareEntry({ ...base, image: 'https://img.test/a.png' }), false);
  assert.equal('thumb' in memberShareEntry({ ...base }), false);
});

test('editInputFor: an unchanged hosted image keeps its imageSource; a changed one does not; a removal is carried', () => {
  const share = { id: '20260901-x', createdAt: '2026-09-01T00:00:00Z', url: 'https://a.test/p', image: OURS, imageSource: 'https://img.test/a.png', visibility: 'public', status: 'published' };
  const kept = editInputFor({ share, now: '2026-09-14T00:00:00Z', fields: { image: OURS, visibility: 'public' } });
  assert.equal(kept.image, OURS);
  assert.equal(kept.imageSource, 'https://img.test/a.png', 'without this the share could never get its original back');
  const changed = editInputFor({ share, now: '2026-09-14T00:00:00Z', fields: { image: 'https://img.test/new.png', visibility: 'public' } });
  assert.equal('imageSource' in changed, false, 'a new image is not a copy of the old source');
  const removed = editInputFor({ share, now: '2026-09-14T00:00:00Z', fields: { image: null, imageRemoved: true, visibility: 'public' } });
  assert.equal('image' in removed, false);
  assert.equal(removed.imageRemoved, true);
  const notRemoved = editInputFor({ share, now: '2026-09-14T00:00:00Z', fields: { image: 'https://img.test/new.png', imageRemoved: true, visibility: 'public' } });
  assert.equal('imageRemoved' in notRemoved, false, 'an image on the share wins over a stale removal flag');
});

test('the share schema keeps imageSource and imageRemoved in its parsed output, buildShareFile writes them, shareSummary returns them', () => {
  const parsed = shareSchema.parse({ id: 'x', author: 'ann', createdAt: '2026-09-01T00:00:00Z', imageSource: 'https://img.test/a.png', imageRemoved: true });
  assert.equal(parsed.imageSource, 'https://img.test/a.png', 'a zod object drops keys it does not name from its output');
  assert.equal(parsed.imageRemoved, true);
  assert.equal(shareSchema.safeParse({ id: 'x', author: 'ann', createdAt: '2026-09-01T00:00:00Z', imageRemoved: 'yes' }).success, false, 'the flag is a boolean');
  const built = buildShareFile({ username: 'ann', input: { id: '20260901-x', createdAt: '2026-09-01T00:00:00Z', visibility: 'public', url: 'https://a.test/p', image: OURS, imageSource: 'https://img.test/a.png' } });
  assert.match(built.markdown, /^imageSource: https:\/\/img\.test\/a\.png$/m);
  const removed = buildShareFile({ username: 'ann', input: { id: '20260901-y', createdAt: '2026-09-01T00:00:00Z', visibility: 'public', url: 'https://a.test/p', imageRemoved: true } });
  assert.match(removed.markdown, /^imageRemoved: true$/m);
  const s = shareSummary('members/ann/shares/20260901-x.md', { id: '20260901-x', author: 'ann', image: OURS, imageSource: 'https://img.test/a.png', imageRemoved: true, visibility: 'public' });
  assert.equal(s.imageSource, 'https://img.test/a.png');
  assert.equal(s.imageRemoved, true);
  assert.equal(shareSummary('p', {}).imageRemoved, false);
});

test('switching a published share to its copy is NOT a publish transition, so it is never re-syndicated or re-emailed', () => {
  const before = '---\nid: s1\nauthor: ann\nstatus: published\nvisibility: public\nurl: https://a.test/p\nimage: https://img.test/a.png\n---\n\nnote\n';
  const after = switchToCopy(before, { url: OURS, source: 'https://img.test/a.png' });
  const path = 'members/ann/shares/s1.md';
  const git = (args) => {
    if (args[0] === 'diff') return `M\t${path}\n`;
    if (args[0] === 'show') return args[1].startsWith('aaa') ? before : after;
    throw new Error(args.join(' '));
  };
  const parseFm = (t) => ({ status: /status:\s*([a-z]+)/.exec(t)[1] });
  assert.deepEqual(selectPublishedTransitions({ before: 'aaa111', after: 'bbb222', runGit: git, parseFm }), []);
  // Control: the same harness DOES select a real publish, so the empty result above is not the harness failing.
  const draft = before.replace('status: published', 'status: draft');
  const git2 = (args) => (args[0] === 'diff' ? `M\t${path}\n` : args[1].startsWith('aaa') ? draft : after);
  assert.deepEqual(selectPublishedTransitions({ before: 'aaa111', after: 'bbb222', runGit: git2, parseFm }), [path]);
});
