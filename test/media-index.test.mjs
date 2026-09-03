// sow-165 (Q36): the editor's image reuse picker sources from the member's OWN published items.
//
// The corpus test at the bottom is the important one, and it exists because of a defect this module already
// had: the first implementation called referencedImages(entry.data), which is correct code handed the wrong
// shape, because Astro resolves an image() field into an ImageMetadata OBJECT before a collection entry is
// seen. It found 195 images where the answer is 368. It built, it validated, it shipped a plausible number,
// and it was wrong by nearly half in the direction that looks fine. Only counting the files on disk caught it.
//
// So a unit test over literals cannot be the whole guard here. The failure was never in the matching logic,
// it was in what the matcher was pointed at, and a fixture I write cannot disagree with my own assumption.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mediaRecordsFromSource, groupMediaByAuthor } from '../src/lib/media-index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ITEM = { type: 'post', author: 'alice', slug: 'hello', title: 'Hello' };

test('sow-165: every frontmatter and body reference FORM is found, in first-seen order', () => {
  const source = [
    '---',
    'title: Hello',
    'coverImage: ./images/cover.webp',            // bare scalar
    'icon: "./images/icon.webp"',                 // quoted scalar
    'gallery:',
    '  - "./images/shot-1.webp"',                 // quoted list row
    '  - ./images/shot-2.webp',                   // bare list row
    '---',
    '',
    'Body with ![alt](./images/inline.png) an image,',
    'and [a link](./images/linked.jpg) which Astro never emits but the file is real,',
    'and the click-to-enlarge idiom [![](./images/thumb.gif)](./images/thumb.gif).',
  ].join('\n');

  const got = mediaRecordsFromSource(source, ITEM).map((r) => r.name);
  assert.deepEqual(got, [
    'cover.webp', 'icon.webp', 'shot-1.webp', 'shot-2.webp',
    'inline.png', 'linked.jpg', 'thumb.gif',
  ], 'frontmatter leads because it is at the top of the file, and every form is a reference');
});

test('sow-165: a name used twice yields ONE record', () => {
  // A cover reused inline is routine, and a picker showing the same file twice reads as a bug.
  const source = '---\ncoverImage: ./images/x.webp\n---\n![](./images/x.webp) and again ![](./images/x.webp)';
  assert.deepEqual(mediaRecordsFromSource(source, ITEM).map((r) => r.name), ['x.webp']);
});

test('sow-165: records carry the item path the UI resolves against', () => {
  const [r] = mediaRecordsFromSource('![](./images/x.webp)', ITEM);
  assert.equal(r.itemPath, 'members/alice/posts/hello/index.md');
  assert.equal(r.itemTitle, 'Hello');
  assert.equal(r.author, 'alice');
  // house content resolves to the non-member tree, which is the other half of contentItemPath's rule.
  const [h] = mediaRecordsFromSource('![](./images/x.webp)', { type: 'prompt', slug: 's' });
  assert.equal(h.itemPath, 'house/prompts/s/index.md');
  assert.equal(h.author, 'gbti');
});

test('sow-165: an unaddressable item yields nothing rather than a broken thumbnail', () => {
  for (const bad of [{ type: 'post' }, { type: 'nope', slug: 's' }, {}, null, undefined]) {
    assert.deepEqual(mediaRecordsFromSource('![](./images/x.webp)', bad), [], `expected no records for ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(mediaRecordsFromSource(null, ITEM), []);
  assert.deepEqual(mediaRecordsFromSource('no images here', ITEM), []);
});

test('sow-165: a path that is not the canonical ./images/ shape is not a reference', () => {
  // Guards against widening the match into something that reports a URL or a sibling folder as a local file.
  const source = '![](https://example.com/images/remote.webp) ![](../images/up.webp) ![](/images/abs.webp)';
  const got = mediaRecordsFromSource(source, ITEM).map((r) => r.name);
  // The remote URL and the site-absolute path both contain the literal `/images/`, so a sloppier regex
  // would claim them. Only the `../images/` one legitimately contains `./images/` as a substring.
  assert.ok(!got.includes('remote.webp'), 'a remote URL is not a co-located file');
  assert.ok(!got.includes('abs.webp'), 'a site-absolute path is not a co-located file');
});

test('sow-165: grouping keeps arrival order and drops authorless records', () => {
  const recs = [{ author: 'a', name: '1' }, { author: 'b', name: '2' }, { author: 'a', name: '3' }, { name: '4' }];
  const g = groupMediaByAuthor(recs);
  assert.deepEqual(Object.keys(g).sort(), ['a', 'b']);
  assert.deepEqual(g.a.map((r) => r.name), ['1', '3'], 'order within an author is preserved');
  assert.deepEqual(groupMediaByAuthor(null), {});
});

// ---------------------------------------------------------------------------------------------------------
// THE CORPUS TEST. See the header: the defect this guards was invisible to every fixture above.
// ---------------------------------------------------------------------------------------------------------

/** Walk the real content tree the way the endpoint does, returning { listed, excluded } item records. */
function realItems() {
  const SUB = { post: 'posts', project: 'projects', product: 'projects', prompt: 'prompts' };
  const roots = ['house', ...readdirSync(join(ROOT, 'members')).map((u) => `members/${u}`)];
  const listed = [];
  for (const root of roots) {
    for (const [type, sub] of Object.entries(SUB)) {
      const dir = join(ROOT, root, sub);
      if (!existsSync(dir)) continue;
      for (const slug of readdirSync(dir)) {
        const p = join(dir, slug, 'index.md');
        if (!existsSync(p)) continue;
        const src = readFileSync(p, 'utf8');
        const fm = src.split('---')[1] || '';
        const g = (k) => (fm.match(new RegExp(`^${k}:\\s*(\\S+)`, 'm')) || [])[1]?.replace(/["']/g, '');
        if (g('status') === 'draft') continue;
        if (g('visibility') === 'members' && g('publicStub') !== 'true') continue; // Mode A never ships here
        const author = root === 'house' ? (g('author') || 'gbti') : root.split('/')[1];
        listed.push({ src, type, author, slug, title: g('title') });
      }
    }
  }
  return listed;
}

test('sow-165: the picker finds the real corpus, not half of it', () => {
  const items = realItems();
  // Control: an empty walk would make every assertion below vacuous, which is exactly how the original
  // defect would have passed a test like this one.
  assert.ok(items.length > 40, `walked ${items.length} published items, expected far more; the walk is broken`);

  const records = items.flatMap((it) => mediaRecordsFromSource(it.src, it));

  // The FLOOR is the guard. Measured at 368 on 2026-08-29 against 385 image files on disk, with the 17
  // difference fully accounted for: 5 live only in draft or Mode A items, and 12 are referenced by nothing
  // (4 of those belong to house/applets, a collection this index does not cover).
  //
  // 300 rather than 368 so ordinary content churn does not red the build, and high enough that the 195 the
  // broken version produced would fail here. A future change that quietly halves the count cannot pass.
  assert.ok(records.length > 300,
    `only ${records.length} image references found across ${items.length} published items. The last measured `
    + 'figure was 368. A large drop means the extractor is being handed the wrong shape again (this is exactly '
    + 'how the ImageMetadata defect presented: a plausible number, wrong by half, in the safe-looking direction).');

  const byAuthor = groupMediaByAuthor(records);
  assert.ok(Object.keys(byAuthor).length >= 3, `expected at least 3 authors with images, got ${Object.keys(byAuthor).length}`);
  for (const r of records) {
    assert.match(r.itemPath, /^(members\/[a-z0-9-]+|house)\/(posts|projects|products|prompts)\/[^/]+\/index\.md$/, `bad itemPath ${r.itemPath}`);
    assert.doesNotMatch(r.name, /[/\\]/, `an image name must be a bare filename, got ${r.name}`);
  }
});
