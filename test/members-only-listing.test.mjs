// sow-323 Phase 3: members-only items leave public listings, and a paying member sees them after signing in.
//
// The owner ruled on 2026-09-12 that a members-only item keeps its own page but is "not publicly indexed [or]
// included in public feeds" until a superadmin approves it, and on 2026-09-15 that signed-in paying members still
// find these items in the feeds and lists. These drive the predicates, the reveal plan and the page wiring: the
// listings themselves are Astro components, so the wiring is pinned by reading the source (the decisions are pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublic, hasPublicPage, isListed, isPubliclyListed, isMembersOnlyListed, isStub } from '../src/lib/content-gating.mjs';
import { canSeeMembersListing, planReveal, REVEAL_ORDERS } from '../src/lib/members-only-reveal-core.mjs';
import { membersOnlyPagePaths, isMembersOnlyFrontmatter } from '../membership/members-only-pages.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const entry = (data) => ({ data });
const PUBLIC = entry({ status: 'published', visibility: 'public' });
const STUB = entry({ status: 'published', visibility: 'members', publicStub: true });
const MODE_A = entry({ status: 'published', visibility: 'members' });
const DRAFT = entry({ status: 'draft', visibility: 'public' });

test('the four modes: what is listed publicly, what a member sees, and what still has a page', () => {
  assert.deepEqual([PUBLIC, STUB, MODE_A, DRAFT].map(isPubliclyListed), [true, false, false, false]);
  assert.deepEqual([PUBLIC, STUB, MODE_A, DRAFT].map(isMembersOnlyListed), [false, true, false, false]);
  // the page itself is unchanged: a stub keeps it, which is the page a superadmin approves from
  assert.deepEqual([PUBLIC, STUB, MODE_A, DRAFT].map(hasPublicPage), [true, true, false, false]);
  // and the member ecosystem's index data is unchanged (the extension, the bells, the members digest)
  assert.deepEqual([PUBLIC, STUB, MODE_A, DRAFT].map(isListed), [true, true, false, false]);
  // the two new predicates partition the pages between them
  for (const e of [PUBLIC, STUB, MODE_A, DRAFT]) {
    assert.equal(isPubliclyListed(e) && isMembersOnlyListed(e), false, 'never both');
    assert.equal(isPubliclyListed(e) || isMembersOnlyListed(e), hasPublicPage(e), 'together they are exactly the pages');
  }
  assert.equal(isPublic(STUB), false);
  assert.equal(isStub(STUB), true);
});

test('only a PAID member sees members-only cards in a listing, and an unresolved signal never does', () => {
  assert.equal(canSeeMembersListing({ membership: 'paid' }), true);
  for (const s of [null, undefined, {}, { membership: 'trialing' }, { membership: 'none' }, { membership: 'expired' }, { membership: 'banned' }, 'paid']) {
    assert.equal(canSeeMembersListing(s), false, JSON.stringify(s));
  }
});

test('the reveal puts each card where the list\'s own order puts it, and appends when there is nowhere else', () => {
  // newest first (the feeds, the article directory, a profile): a card goes before the first older card
  assert.deepEqual(planReveal([300, 200, 100], [250, 50, 400], 'newest'), [{ index: 0, before: 1 }, { index: 1, before: null }, { index: 2, before: 0 }]);
  // by title (the prompts directory): before the first card that sorts after it
  assert.deepEqual(planReveal(['beta', 'delta'], ['alpha', 'charlie', 'epsilon'], 'title'), [{ index: 0, before: 0 }, { index: 1, before: 1 }, { index: 2, before: null }]);
  // the project directory keeps the collection's order and simply appends
  assert.deepEqual(planReveal([3, 2], [9], 'end'), [{ index: 0, before: null }]);
  // A TIE goes AFTER the card it ties with, so a revealed card never jumps ahead of an equally dated public one.
  assert.deepEqual(planReveal([300, 200], [200], 'newest'), [{ index: 0, before: null }]);
  assert.deepEqual(planReveal([300, 200, 100], [200], 'newest'), [{ index: 0, before: 2 }], 'after the tie, before the older one');
  assert.deepEqual(planReveal(['beta', 'delta'], ['beta'], 'title'), [{ index: 0, before: 1 }], 'after the tie, before the later one');
  assert.deepEqual(planReveal(['beta'], ['beta'], 'title'), [{ index: 0, before: null }]);
  // an empty list takes every card, and a missing key sorts as zero rather than throwing
  assert.deepEqual(planReveal([], [1, 2], 'newest'), [{ index: 0, before: null }, { index: 1, before: null }]);
  assert.deepEqual(planReveal([5], [undefined], 'newest'), [{ index: 0, before: null }]);
  assert.deepEqual(planReveal(null, null, 'newest'), []);
  assert.deepEqual(REVEAL_ORDERS, ['newest', 'title', 'end']);
});

test('the sitemap scan reads the frontmatter block only, and finds every members-only page path', () => {
  assert.equal(isMembersOnlyFrontmatter('status: published\nvisibility: members'), true);
  assert.equal(isMembersOnlyFrontmatter('visibility: members'), true, 'a missing status is published');
  assert.equal(isMembersOnlyFrontmatter('status: draft\nvisibility: members'), false);
  assert.equal(isMembersOnlyFrontmatter('status: published'), false, 'silence is public, the schema default');
  const paths = membersOnlyPagePaths(ROOT);
  const live = [...paths];
  assert.ok(live.every((p) => /^\/(articles|projects|prompts)\/[a-z0-9][a-z0-9-]*\/$/.test(p)), live.join(' '));
  // the repository's own members-only items, as a control that the scan is reading something
  assert.ok(live.includes('/prompts/qa-skill-for-claude-code-and-codex/'), live.join(' '));
});

test('the page scan reads the frontmatter block only, so a body line cannot hide an item', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'members-only-'));
  try {
    const write = (rel, text) => { fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
    // The body quotes a frontmatter line, as an article about publishing would, and the frontmatter itself says
    // nothing (silence is public, the schema default). Read the whole file instead of the block and this item
    // would be treated as members-only on the strength of its prose.
    write('members/ada/posts/public-with-a-line/index.md', '---\nslug: public-with-a-line\nstatus: published\n---\nSet the audience like this:\n\n```yaml\nvisibility: members\n```\n');
    write('members/ada/prompts/waiting/index.md', '---\nslug: waiting\nstatus: published\nvisibility: members\npublicStub: true\n---\nteaser\n');
    write('house/products/legacy-name/index.md', '---\nslug: legacy-name\nstatus: published\nvisibility: members\n---\nx\n');
    write('members/ada/posts/draft/index.md', '---\nslug: draft\nstatus: draft\nvisibility: members\n---\nx\n');
    assert.deepEqual([...membersOnlyPagePaths(root)].sort(), ['/projects/legacy-name/', '/prompts/waiting/'],
      'the retired products/ directory publishes as a project; a draft has no page; a body line is not frontmatter');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('every listing renders its members-only cards in a template, and its script collects them when they arrive', () => {
  // The feeds, the three directories and a member profile. Read as source, because these are Astro components.
  for (const [file, hook] of [
    ['src/components/feeds/FeedList.astro', 'MembersOnlyCards'],
    ['src/pages/articles/index.astro', 'members-only-revealed'],
    ['src/pages/prompts/index.astro', 'members-only-revealed'],
    ['src/components/projects/ProjectDirectory.astro', 'members-only-revealed'],
    ['src/pages/members/[username].astro', 'MembersOnlyCards'],
  ]) {
    assert.match(read(file), new RegExp(hook), `${file} must carry ${hook}`);
  }
  // public discovery is PUBLIC now, not "listed" (which still includes a members-only stub for the member data)
  assert.match(read('src/lib/content.ts'), /export function isDiscoverable\(entry: Keyed\): boolean \{\s*return isPubliclyListed\(entry\) && notStale\(entry\);/);
  assert.match(read('src/lib/content.ts'), /export function isMembersDiscoverable\(entry: Keyed\): boolean \{\s*return isMembersOnlyListed\(entry\) && notStale\(entry\);/);
  // the public data source never carries a members-only item
  assert.match(read('src/lib/feed-items.ts'), /const posts = \(await getCollection\('post'\)\)\.filter\(isDiscoverable\)/);
  assert.match(read('src/lib/feed-items.ts'), /membersItems: FeedItem\[\]/);
  // the three item pages ask search engines to skip a members-only page
  for (const p of ['src/pages/articles/[slug].astro', 'src/pages/projects/[slug].astro', 'src/pages/prompts/[slug].astro']) {
    assert.match(read(p), /noindex=\{[^}]*stub[^}]*\}/, p);
  }
  // and the sitemap drops it
  assert.match(read('astro.config.mjs'), /!MEMBERS_ONLY\.has\(new URL\(page\)\.pathname\)/);
});
