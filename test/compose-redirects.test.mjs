// SOW-112: the redirect composition (committed base + frontmatter redirectFrom lines). Pure core; no repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeRedirects } from '../scripts/compose-redirects.mjs';

const COMMITTED = '# header\n/devops/x/ /articles/x/ 301\n/blog/* /articles/:splat 301\n';

test('composeRedirects appends published items\' redirectFrom lines onto the committed base, sorted', () => {
  const items = [
    { seg: 'prompts', slug: 'new-name', status: 'published', visibility: 'public', publicStub: false, redirectFrom: ['/prompts/old-name/'] },
    { seg: 'articles', slug: 'b', status: 'published', visibility: 'public', publicStub: false, redirectFrom: ['/articles/a/'] },
  ];
  const { text, added } = composeRedirects(COMMITTED, items);
  assert.equal(added, 2);
  assert.ok(text.startsWith('# header\n/devops/x/ /articles/x/ 301\n/blog/* /articles/:splat 301\n'));
  assert.match(text, /\n\/prompts\/old-name\/ \/prompts\/new-name\/ 301\n/);
  assert.match(text, /\n\/articles\/a\/ \/articles\/b\/ 301\n/);
});

test('committed sources win; duplicates and self-redirects are dropped; drafts and empty lists skip', () => {
  const items = [
    { seg: 'articles', slug: 'x2', status: 'published', visibility: 'public', publicStub: false, redirectFrom: ['/devops/x/'] }, // committed wins
    { seg: 'articles', slug: 'y', status: 'published', visibility: 'public', publicStub: false, redirectFrom: ['/articles/y/'] }, // self
    { seg: 'articles', slug: 'z', status: 'draft', visibility: 'public', publicStub: false, redirectFrom: ['/articles/old-z/'] }, // draft
    { seg: 'articles', slug: 'w', status: 'published', visibility: 'public', publicStub: false, redirectFrom: [] },
  ];
  const { text, added } = composeRedirects(COMMITTED, items);
  assert.equal(added, 0);
  assert.equal(text, COMMITTED); // byte-stable when nothing to add
});

test('a non-public destination retargets to /membership/ (never a 301 to a 404)', () => {
  const items = [
    { seg: 'prompts', slug: 'secret', status: 'published', visibility: 'members', publicStub: false, redirectFrom: ['/prompts/old-secret/'] },
    { seg: 'prompts', slug: 'stub', status: 'published', visibility: 'members', publicStub: true, redirectFrom: ['/prompts/old-stub/'] },
  ];
  const { text } = composeRedirects('', items);
  assert.match(text, /\/prompts\/old-secret\/ \/membership\/ 301/);
  assert.match(text, /\/prompts\/old-stub\/ \/prompts\/stub\/ 301/); // a Mode B stub is a real public page
});

// sow-365: a share's public url carries its AUTHOR, so moving a share to another member retires that url the
// way a rename retires a slug. Before this, the old url was simply no longer built: a 404 for anyone holding
// the link, and for as long as the edge cache had left, the page as it was before the move, unstyled because
// its stylesheet hash no longer existed. Measured ten hours after a real move with seven days still to run.
import { scanContent } from '../scripts/compose-redirects.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('sow-365: a moved share 301s from its old author url to its new one', () => {
  const items = [
    { seg: 'shares', slug: 'x', dest: '/shares/gbtilabs/x/', status: 'published', visibility: 'public', publicStub: false, redirectFrom: ['/shares/adbox85/x/'] },
    { seg: 'shares', slug: 'y', dest: '/shares/gbtilabs/y/', status: 'published', visibility: 'members', publicStub: false, redirectFrom: ['/shares/adbox85/y/'] },
    { seg: 'shares', slug: 'z', dest: '/shares/gbtilabs/z/', status: 'draft', visibility: 'public', publicStub: false, redirectFrom: ['/shares/adbox85/z/'] },
  ];
  const { text, added } = composeRedirects('', items);
  assert.equal(added, 2, 'a draft share contributes nothing');
  assert.match(text, /\n\/shares\/adbox85\/x\/ \/shares\/gbtilabs\/x\/ 301/);
  // A members-only share has no public page, so its old url points at the membership page rather than at a
  // destination the build never writes.
  assert.match(text, /\n\/shares\/adbox85\/y\/ \/membership\/ 301/);
  assert.equal(/\/shares\/adbox85\/z\//.test(text), false);
});

test('sow-365: scanContent reads a share file, which is flat rather than a folder with an index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sow365-'));
  const dir = path.join(root, 'members', 'gbtilabs', 'shares');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '20260918-x.md'), [
    '---', 'status: published', 'visibility: public', 'type: share', 'author: gbtilabs',
    'id: 20260918-x', 'redirectFrom:', '  - /shares/adbox85/20260918-x/', '---', '', 'note', '',
  ].join('\n'));
  // A share with nothing to redirect is not an item at all, so the scan does not grow with the corpus.
  fs.writeFileSync(path.join(dir, '20260918-y.md'), '---\nstatus: published\nvisibility: public\ntype: share\nauthor: gbtilabs\nid: 20260918-y\n---\n\nnote\n');
  const items = scanContent(root).filter((i) => i.seg === 'shares');
  assert.equal(items.length, 1);
  assert.deepEqual(
    [items[0].dest, items[0].status, items[0].visibility, items[0].redirectFrom],
    ['/shares/gbtilabs/20260918-x/', 'published', 'public', ['/shares/adbox85/20260918-x/']],
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-365: the share that was actually moved carries its old url', () => {
  const real = new URL('../members/gbtilabs/shares/20260918165402-estrada-same-thing-visualizer.md', import.meta.url);
  const txt = fs.readFileSync(real, 'utf8');
  assert.match(txt, /redirectFrom:\n {2}- \/shares\/adbox85\/20260918165402-estrada-same-thing-visualizer\//);
});
