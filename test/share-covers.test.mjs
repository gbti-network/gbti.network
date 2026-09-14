// sow-283 / sow-272: the pure half of the share-covers workflow: our copy's address, the planner's decisions, and
// the frontmatter edits that switch a share to its copy and back. The runner (fetch, ingest, switch against a temp
// repo) is test/share-covers-runner.test.mjs; the readers (index, digest, composer edit) are
// test/share-covers-readers.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import {
  shareCoverFileName, shareCoverUrl, shareCoverPath, parseShareCoverUrl, isShareCoverUrl, shareImageForSite,
} from '../membership/share-cover-url.mjs';
import {
  planShareCovers, editFrontmatter, switchToCopy, restoreOriginal, parseManifest, serializeManifest, RETRY_AFTER_DAYS,
} from '../scripts/lib/share-covers.mjs';

const HASH = '0123abcd' + 'e'.repeat(56);
const NOW = Date.parse('2026-09-14T12:00:00Z');
const DAY = 86400000;

test('our copy address: built from author, id and hash; parsed back; look-alikes are not ours', () => {
  const file = shareCoverFileName('20260709-lane-8', HASH);
  assert.equal(file, '20260709-lane-8-0123abcd.webp');
  assert.equal(shareCoverPath('atwellpub', file), '/media/shares/atwellpub/20260709-lane-8-0123abcd.webp');
  const url = shareCoverUrl('atwellpub', file);
  assert.equal(url, 'https://gbti.network/media/shares/atwellpub/20260709-lane-8-0123abcd.webp');
  assert.deepEqual(parseShareCoverUrl(url), { author: 'atwellpub', id: '20260709-lane-8', hash: '0123abcd', file, path: shareCoverPath('atwellpub', file) });
  assert.equal(parseShareCoverUrl(shareCoverPath('atwellpub', file)).id, '20260709-lane-8', 'the root-relative form parses too');
  for (const notOurs of [
    'https://gbti.network.evil.test/media/shares/atwellpub/x-0123abcd.webp',
    'https://evil.test/https://gbti.network/media/shares/atwellpub/x-0123abcd.webp',
    `${url}?v=1`, `${url}#x`, 'http://gbti.network/media/shares/atwellpub/x-0123abcd.webp',
    'https://gbti.network/media/shares/atwellpub/x-0123abc.webp', 'https://gbti.network/media/shares/atwellpub/x.webp',
    'https://gbti.network/media/shares/a/b/x-0123abcd.webp', 'https://gbti.network/media/shares/../x-0123abcd.webp',
    'https://i.ytimg.com/vi/x/maxresdefault.jpg', '', null, 42,
  ]) assert.equal(isShareCoverUrl(notOurs), false, String(notOurs));
  assert.throws(() => shareCoverFileName('Bad Id', HASH));
  assert.throws(() => shareCoverFileName('ok', 'nothex'));
  assert.equal(shareImageForSite(url), shareCoverPath('atwellpub', file), 'the site renders our copy root-relative');
  assert.equal(shareImageForSite('https://i.ytimg.com/x.jpg'), 'https://i.ytimg.com/x.jpg');
});

const share = (over = {}) => ({ author: 'ann', id: 's1', status: 'published', visibility: 'public', url: 'https://example.com/post', image: 'https://img.example.com/a.jpg', ...over });
const plan = (args) => planShareCovers({ now: NOW, manifest: {}, files: {}, ...args });
const copy = (id, h = '0123abcd') => `${id}-${h}.webp`;

test('planner: a public share on an outside image is copied; a copy on file is switched, not copied again', () => {
  assert.deepEqual(plan({ shares: [share()] }).fetch, [{ key: 'ann/s1', author: 'ann', id: 's1', kind: 'image', source: 'https://img.example.com/a.jpg' }]);
  const entry = { source: 'https://img.example.com/a.jpg', file: copy('s1'), sha256: HASH };
  const p = plan({ shares: [share()], manifest: { 'ann/s1': entry }, files: { ann: [copy('s1'), copy('s1', 'ffffffff')] } });
  assert.deepEqual(p.fetch, []);
  assert.deepEqual(p.promote, [{ key: 'ann/s1', author: 'ann', id: 's1', file: copy('s1'), sha256: HASH, source: entry.source }]);
  assert.deepEqual(p.deleteFiles, ['members/ann/shares/images/s1-ffffffff.webp'], 'a stale copy for the same share goes');
  // The recorded copy is missing from the repo: copy again rather than switch to nothing.
  assert.equal(plan({ shares: [share()], manifest: { 'ann/s1': entry }, files: {} }).fetch.length, 1);
  // The member re-previewed a different image: the old record no longer applies.
  assert.equal(plan({ shares: [share({ image: 'https://img.example.com/b.jpg' })], manifest: { 'ann/s1': entry }, files: { ann: [copy('s1')] } }).fetch[0].source, 'https://img.example.com/b.jpg');
});

test('planner: permanent failures are not retried; transient ones are, after the retry window', () => {
  const failed = (reason, daysAgo) => ({ 'ann/s1': { source: 'https://img.example.com/a.jpg', failed: reason, triedAt: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10) } });
  assert.equal(plan({ shares: [share()], manifest: failed('http-404', 30) }).fetch.length, 0, 'a 404 does not heal');
  assert.equal(plan({ shares: [share()], manifest: failed('not-image', 30) }).fetch.length, 0);
  assert.equal(plan({ shares: [share()], manifest: failed('timeout', 1) }).fetch.length, 0, 'too soon');
  assert.equal(plan({ shares: [share()], manifest: failed('timeout', RETRY_AFTER_DAYS) }).fetch.length, 1, 'due');
  assert.equal(plan({ shares: [share()], manifest: failed('http-503', RETRY_AFTER_DAYS + 3) }).fetch.length, 1);
  assert.equal(plan({ shares: [share({ image: 'https://img.example.com/new.jpg' })], manifest: failed('http-404', 0) }).fetch.length, 1, 'a new source is always tried');
});

test('planner: a share with no image is looked up ONLY when its preview was never removed and it has a link', () => {
  assert.deepEqual(plan({ shares: [share({ image: undefined })] }).fetch, [{ key: 'ann/s1', author: 'ann', id: 's1', kind: 'lookup', url: 'https://example.com/post' }]);
  const removed = plan({ shares: [share({ image: undefined, imageRemoved: true })], manifest: { 'ann/s1': { lookup: 'https://example.com/post', file: copy('s1'), sha256: HASH } }, files: { ann: [copy('s1')] } });
  assert.deepEqual(removed.fetch, []);
  assert.deepEqual(removed.promote, [], 'a removed preview is never switched in either');
  assert.deepEqual(removed.deleteFiles, ['members/ann/shares/images/s1-0123abcd.webp']);
  assert.deepEqual(removed.dropEntries, ['ann/s1']);
  assert.deepEqual(plan({ shares: [share({ image: undefined, url: undefined })] }).fetch, [], 'nothing to look up');
  const found = plan({ shares: [share({ image: undefined })], manifest: { 'ann/s1': { lookup: 'https://example.com/post', source: 'https://example.com/og.png', file: copy('s1'), sha256: HASH } }, files: { ann: [copy('s1')] } });
  assert.deepEqual(found.promote.map((p) => p.source), ['https://example.com/og.png']);
  const none = plan({ shares: [share({ image: undefined })], manifest: { 'ann/s1': { lookup: 'https://example.com/post', failed: 'no-preview', triedAt: '2026-01-01' } } });
  assert.deepEqual(none.fetch, [], 'one lookup each: a page with no preview image is not read again');
  assert.equal(plan({ shares: [share({ image: undefined, url: 'https://example.com/other' })], manifest: { 'ann/s1': { lookup: 'https://example.com/post', failed: 'no-preview', triedAt: '2026-01-01' } } }).fetch.length, 1, 'a changed link is a new lookup');
});

test('planner: a members-only or draft share is NEVER copied, and loses any copy it had', () => {
  const ours = shareCoverUrl('ann', copy('s1'));
  for (const over of [{ visibility: 'members' }, { status: 'draft' }, { visibility: undefined }, { status: undefined }]) {
    const p = plan({ shares: [share(over)], files: { ann: [copy('s1')] }, manifest: { 'ann/s1': { source: 'x', file: copy('s1'), sha256: HASH } } });
    assert.deepEqual(p.fetch, [], JSON.stringify(over));
    assert.deepEqual(p.promote, []);
    assert.deepEqual(p.deleteFiles, ['members/ann/shares/images/s1-0123abcd.webp']);
    assert.deepEqual(p.dropEntries, ['ann/s1']);
  }
  const back = plan({ shares: [share({ visibility: 'members', image: ours, imageSource: 'https://img.example.com/a.jpg' })], files: { ann: [copy('s1')] } });
  assert.deepEqual(back.restore, [{ key: 'ann/s1', author: 'ann', id: 's1', image: 'https://img.example.com/a.jpg' }]);
  assert.deepEqual(plan({ shares: [share({ status: 'draft', image: ours })] }).restore[0].image, null, 'no source recorded: the image is removed');
  assert.deepEqual(plan({ shares: [share({ visibility: 'members', image: undefined })] }).fetch, [], 'no lookup for a members share');
});

test('planner: a switched share keeps exactly its own copy; a missing copy restores the original', () => {
  const ours = shareCoverUrl('ann', copy('s1'));
  const kept = plan({ shares: [share({ image: ours, imageSource: 'https://img.example.com/a.jpg' })], files: { ann: [copy('s1'), copy('s1', 'aaaaaaaa')] } });
  assert.deepEqual([kept.fetch, kept.promote, kept.restore], [[], [], []]);
  assert.deepEqual(kept.deleteFiles, ['members/ann/shares/images/s1-aaaaaaaa.webp']);
  const lost = plan({ shares: [share({ image: ours, imageSource: 'https://img.example.com/a.jpg' })], files: {} });
  assert.deepEqual(lost.restore.map((r) => r.image), ['https://img.example.com/a.jpg']);
  const borrowed = plan({ shares: [share({ image: shareCoverUrl('bob', copy('b1')) })] });
  assert.deepEqual([borrowed.fetch, borrowed.promote, borrowed.restore], [[], [], []], "another share's copy is already on our host");
});

test('planner: copies and records for deleted shares are cleaned up, and a copy name that is not ours goes too', () => {
  const p = plan({ shares: [share()], files: { ann: ['gone-0123abcd.webp'], zed: ['z1-0123abcd.webp', 'weird.webp'] }, manifest: { 'zed/z1': { source: 'x' } } });
  assert.deepEqual(p.deleteFiles, ['members/ann/shares/images/gone-0123abcd.webp', 'members/zed/shares/images/weird.webp', 'members/zed/shares/images/z1-0123abcd.webp']);
  assert.deepEqual(p.dropEntries, ['zed/z1']);
});

// A real share file text, split into its image lines and everything else, for the byte-for-byte comparison.
function withoutImageLines(text) {
  const [, head, rest] = /^---\n([\s\S]*?\n)---(\n[\s\S]*)$/.exec(text);
  const lines = head.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^(image|imageSource):/.test(lines[i])) { while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) i++; continue; }
    out.push(lines[i]);
  }
  return out.join('\n') + rest;
}

test('switch and restore change ONLY the image lines, on every real share file, folded values included', () => {
  const files = execFileSync('git', ['ls-files', 'members/*/shares/*.md'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  let withImage = 0;
  let folded = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const fm = yaml.load(/^---\n([\s\S]*?)\n---/.exec(text)[1]);
    if (typeof fm.image !== 'string' || fm.imageSource) continue;
    withImage++;
    if (/^image: [>|]/m.test(text)) folded++;
    const url = shareCoverUrl(fm.author || 'ann', copy('s1'));
    const switched = switchToCopy(text, { url, source: fm.image });
    const fm2 = yaml.load(/^---\n([\s\S]*?)\n---/.exec(switched)[1]);
    assert.equal(fm2.image, url, f);
    assert.equal(fm2.imageSource, fm.image, `${f}: the original survives exactly`);
    assert.equal(withoutImageLines(switched), withoutImageLines(text), `${f}: nothing else changed`);
    const restored = restoreOriginal(switched, { image: fm.image });
    const fm3 = yaml.load(/^---\n([\s\S]*?)\n---/.exec(restored)[1]);
    assert.equal(fm3.image, fm.image, f);
    assert.equal('imageSource' in fm3, false, f);
    assert.equal(withoutImageLines(restored), withoutImageLines(text), f);
  }
  assert.ok(withImage >= 40, `real share files with an image were exercised (${withImage})`);
  assert.ok(folded >= 1, `a folded image value was exercised (${folded})`);
});

test('editFrontmatter: inserts after the named key, removes cleanly, keeps CRLF, refuses a file without frontmatter', () => {
  const text = '---\nid: s1\nurl: https://example.com/a\ntitle: T\n---\n\nbody\n';
  assert.equal(switchToCopy(text, { url: 'https://gbti.network/media/shares/ann/s1-0123abcd.webp', source: 'https://example.com/og.png' }),
    '---\nid: s1\nurl: https://example.com/a\nimage: https://gbti.network/media/shares/ann/s1-0123abcd.webp\nimageSource: https://example.com/og.png\ntitle: T\n---\n\nbody\n');
  assert.equal(restoreOriginal(switchToCopy(text, { url: 'https://gbti.network/media/shares/ann/s1-0123abcd.webp', source: 'x' }), { image: null }), text, 'a lookup-found image comes off entirely');
  const crlf = text.replace(/\n/g, '\r\n');
  assert.equal(editFrontmatter(crlf, [{ key: 'title', value: 'U' }]), crlf.replace('title: T', 'title: U'));
  assert.equal(editFrontmatter('no frontmatter', [{ key: 'image', value: 'x' }]), null);
  const odd = editFrontmatter(text, [{ key: 'image', value: 'https://example.com/a b: c #d' }]);
  assert.equal(yaml.load(/^---\n([\s\S]*?)\n---/.exec(odd)[1]).image, 'https://example.com/a b: c #d', 'a value YAML would misread is quoted');
});

test('manifest: serialization is stable and sorted, parses back, and a malformed file refuses to run', () => {
  const covers = { 'zed/z1': { source: 'https://a.test/x.jpg', failed: 'timeout', triedAt: '2026-09-14' }, 'ann/s1': { source: 'https://b.test/y.jpg', file: copy('s1'), sha256: HASH, copiedAt: '2026-09-14' } };
  const text = serializeManifest(covers);
  assert.equal(serializeManifest(parseManifest(text)), text, 'a no-op run writes identical bytes');
  assert.ok(text.indexOf('ann/s1') < text.indexOf('zed/z1'), 'sorted');
  assert.deepEqual(parseManifest(''), {});
  assert.deepEqual(parseManifest('covers:\n'), {});
  assert.throws(() => parseManifest('covers: [1, 2]\nx: ['), /./);
  assert.throws(() => parseManifest('covers: nope\n'), /covers/);
});
