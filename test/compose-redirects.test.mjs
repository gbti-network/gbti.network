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
