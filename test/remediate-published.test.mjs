// SOW-076 Phase 3: the remediation runner's pure helpers (changed-file filtering + the published-status read). No IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedContentFiles, publishedAmong } from '../scripts/remediate-published.mjs';

test('changedContentFiles filters CHANGED_FILES to content index.md paths', () => {
  const env = { CHANGED_FILES: 'members/alice/posts/x/index.md house/products/y/index.md README.md members/bob/comments/c.md' };
  assert.deepEqual(changedContentFiles(env), ['members/alice/posts/x/index.md', 'house/products/y/index.md']);
  assert.deepEqual(changedContentFiles({}), []);
});

test('publishedAmong returns only status: published items (a draft / no-status / missing item is excluded)', () => {
  const files = {
    '/r/members/alice/posts/x/index.md': '---\nstatus: published\n---\nb',
    '/r/members/alice/posts/y/index.md': '---\nstatus: draft\n---\nb',
    '/r/house/products/z/index.md': '---\ntitle: z\n---\nb', // no status field
  };
  const readFile = (p) => { if (!files[p]) throw new Error('missing'); return files[p]; };
  const out = publishedAmong(
    ['members/alice/posts/x/index.md', 'members/alice/posts/y/index.md', 'house/products/z/index.md', 'gone/index.md'],
    { root: '/r', readFile },
  );
  assert.deepEqual([...out], ['members/alice/posts/x/index.md']);
});
