// sow-219 Phase 2: the from-the-author note renders in the WorkBench preview, not only on the published page.
// The preview runs on the CLIENT and cannot execute an Astro component, so the block's STRUCTURE is shared
// through src/lib/author-note.mjs and the published component is held to it by the drift test below. This is
// the same shape as test/article-page.test.mjs and the markdown-renderer equivalence test: the contract is
// only worth having if something fails when the component moves away from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUTHOR_NOTE_BLOCK, introPathFor, buildAuthorNoteHtml, NOTE_PLACEHOLDER, noteEditSource, noteAfterCommit } from '../src/lib/author-note.mjs';
import { previewSource } from './lib/preview-source.mjs'; // the Preview page plus its script modules, in order

const COMMENTS = fs.readFileSync(fileURLToPath(new URL('../src/components/blog/Comments.astro', import.meta.url)), 'utf8');
// sow-459: the pinned card moved, verbatim, out of Comments.astro into AuthorNote.astro, so the prompt page can place
// it outside the thread; Comments.astro renders <AuthorNote> where the card used to be.
const NOTE = fs.readFileSync(fileURLToPath(new URL('../src/components/blog/AuthorNote.astro', import.meta.url)), 'utf8');
const LIB = fs.readFileSync(fileURLToPath(new URL('../src/lib/comments.ts', import.meta.url)), 'utf8');
// The pinned block is the `{intro && (...)}` branch; scope the assertions to it so an unrelated class
// elsewhere in the file cannot make a stale contract entry look present.
const PINNED = NOTE.slice(NOTE.indexOf('{intro && ('), NOTE.indexOf('<style is:global>'));

test('DRIFT: every class and style in the shared contract still appears in the published pinned block', () => {
  assert.ok(PINNED.length > 200, 'the pinned intro branch was not found in AuthorNote.astro; the slice anchors moved');
  for (const [key, value] of Object.entries(AUTHOR_NOTE_BLOCK)) {
    if (key === 'avatarSize') { assert.match(PINNED, /size=\{44\}/, 'the avatar size drifted from the contract'); continue; }
    assert.ok(PINNED.includes(String(value)), `contract entry ${key} ("${value}") is no longer in AuthorNote.astro`);
  }
  // And the thread still renders THAT card, not a copy of it, so the two cannot drift apart.
  assert.match(COMMENTS, /\{intro && <AuthorNote targetType=\{targetType\} targetSlug=\{targetSlug\} author=\{author\} aliases=\{aliases\} \/>\}/);
  assert.doesNotMatch(COMMENTS, /<article class="card"|>From the author</, 'Comments.astro carries no second copy of the card');
});

// 2026-10-27 (owner, design round .data/design/author-note-2026-10-27, pick A): "I am not sure I like this green author
// box on light mode. maybe the border radius needs to be 2px." The note is a neutral card: 2px corners, a warm grey
// hairline border, no green wash and no shadow, a hairline under the head, green on the kicker only.
test('pick A: the note is a neutral card with 2px corners, green on the kicker only', () => {
  const card = PINNED.match(/<article class="card" style="([^"]+)">/)[1];
  assert.match(card, /border-radius:2px/);
  assert.match(card, /border:1px solid var\(--line-2\)/);
  assert.match(card, /background:var\(--paper\)/);
  assert.match(card, /box-shadow:none/, 'the .card shadow is dropped');
  assert.doesNotMatch(card, /--green/, 'no green wash or green border');
  assert.match(PINNED, /class="link" style="font-weight:700;display:inline-flex;color:var\(--fg\)">\{introName\}<\/a>/, 'the name is body colour, not link green');
  assert.match(PINNED, /<p class="eyebrow" style="color:var\(--green-700\)">From the author<\/p>/, 'the kicker keeps the green');
  assert.match(PINNED, /<div class="flex items-center g12" style="padding-bottom:18px;border-bottom:1px solid var\(--line\)">/, 'the hairline under the head');
  const pad = Number(card.match(/padding:(\d+)px;/)[1]);
  assert.match(card, new RegExp(`--embed-out-l:${pad}px;--embed-out-r:${pad}px`), 'an embed still spans the card');
});

test('DRIFT: the published block still selects a PUBLIC authorNote comment, which the preview mirrors', () => {
  // The preview re-implements this filter client-side. If the published rule changes (say it starts pinning a
  // members-visibility note), the preview would silently show something the page does not.
  // sow-459: the rule lives in ONE helper both renderers call, so the card and the thread's exclusion agree.
  const fn = LIB.slice(LIB.indexOf('export function authorNotesOf('));
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /c\.data\.author === author && c\.data\.visibility === 'public' && c\.data\.authorNote/);
  assert.match(NOTE, /const notes = authorNotesOf\(itemComments\(await getCollection\('comment'\), targetType, targetSlug, aliases\), author\);/);
  assert.match(NOTE, /const intro = notes\.length \? notes\[notes\.length - 1\] : null;/, 'the newest note is the pinned one');
  assert.match(COMMENTS, /const notes = authorNotesOf\(published, author\);/);
  assert.match(COMMENTS, /\.filter\(\(c\) => !notes\.includes\(c\)\)/, 'every note stays out of the thread');
});

test('introPathFor: derives the sibling comment path from the item path', () => {
  assert.equal(introPathFor('members/gbtilabs/posts/my-article/index.md', 'my-article'), 'members/gbtilabs/comments/intro-my-article.md');
  assert.equal(introPathFor('members/alice/projects/thing/index.md', 'thing'), 'members/alice/comments/intro-thing.md');
  assert.equal(introPathFor('house/posts/legacy/index.md', 'legacy'), 'house/comments/intro-legacy.md');
});

test('introPathFor: null for a path that is not member or house content, or a missing slug', () => {
  assert.equal(introPathFor('src/pages/index.astro', 'x'), null);
  assert.equal(introPathFor('members/alice/posts/a/index.md', ''), null);
  assert.equal(introPathFor('', 'a'), null);
  assert.equal(introPathFor(undefined, 'a'), null);
});

test('buildAuthorNoteHtml: renders the pinned structure, escaping the name and href', () => {
  const html = buildAuthorNoteHtml({ name: 'GBTI Network', href: '/members/gbtilabs/', avatarUrl: 'https://x/a.png', bodyHtml: '<p>Why I wrote this.</p>' });
  assert.match(html, /class="card" style="padding:28px;border:1px solid var\(--line-2\);border-radius:2px;box-shadow:none;background:var\(--paper\)"/);
  assert.match(html, /<div class="flex items-center g12" style="padding-bottom:18px;border-bottom:1px solid var\(--line\)">/, 'the hairline under the head');
  assert.match(html, /From the author/);
  assert.match(html, /GBTI Network/);
  assert.match(html, /<p>Why I wrote this\.<\/p>/); // the rendered body is injected, not escaped
  assert.match(html, /src="https:\/\/x\/a\.png"/);
});

test('buildAuthorNoteHtml: a hostile display name cannot inject markup, and a missing avatar falls back', () => {
  const html = buildAuthorNoteHtml({ name: '<img src=x onerror=alert(1)>', href: 'javascript:alert(1)"', bodyHtml: '' });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /href="javascript:alert\(1\)"[^>]*>/); // the quote is escaped, so no attribute break-out
  assert.match(html, /<span class="rounded-full"/); // letter disc when no avatar resolved
});

// sow-358 (owner, 2026-09-17): "there is no save button and the author note disappears when you say Done
// Editing". An item with no note yet renders a placeholder block in the preview's edit mode, but the note's
// SOURCE was empty, and a block commit parses the source range it is handed: an empty string parses to zero
// blocks, so applyBlockEdit refused the write. The first note anyone typed was dropped in silence, and since
// nothing committed, nothing marked the draft dirty, so the Save button never appeared either. The commit now
// applies against the placeholder, which is the one block the card actually shows.
test('a note typed into the placeholder commits, and an untouched placeholder stores nothing', async () => {
  const { applyBlockEdit } = await import('../client-ui/src/block-commit.mjs');
  const typed = { kind: 'paragraph', text: 'Why I built this, in my own words.' };

  // The defect, at the layer it lived in: an empty source cannot take an edit at all.
  assert.equal(applyBlockEdit('', typed), null, 'an empty source still parses to zero blocks; that is the fail-safe this works around');

  // The fix: edit against what the card shows.
  const src = noteEditSource('', true);
  assert.equal(src, NOTE_PLACEHOLDER);
  const next = applyBlockEdit(src, typed);
  assert.deepEqual(next, ['Why I built this, in my own words.']);
  assert.equal(noteAfterCommit(next.join('\n')), 'Why I built this, in my own words.');

  // An untouched card commits the placeholder back, which must never become the note.
  assert.equal(noteAfterCommit(applyBlockEdit(src, { kind: 'paragraph', text: NOTE_PLACEHOLDER }).join('\n')), '');
});

test('the placeholder is only ever a stand-in: a real note and the read view are untouched', () => {
  assert.equal(noteEditSource('An existing note.', true), 'An existing note.');
  assert.equal(noteEditSource('', false), '', 'the read view shows no card for an item with no note');
  assert.equal(noteEditSource('   \n  ', true), NOTE_PLACEHOLDER, 'whitespace is not a note');
  assert.equal(noteAfterCommit(''), '', 'an emptied note clears the note, which is the draft store contract');
});

// The preview page is a .astro file, so no test can import its editing loop. What IS testable is that it
// reaches for these helpers rather than carrying its own copy of the placeholder, which is how the two would
// drift back apart.
test('DRIFT: the preview edits the note through the shared helpers', () => {
  // The page script moved into src/lib at the 900-line limit (2026-09-30), so the import is now module-relative.
  // Both halves import the helpers statically: the edit half for the note editing loop, the render half because
  // noteDoc and srcOf live there.
  const page = previewSource();
  assert.match(page, /^import \{ buildAuthorNoteHtml, noteEditSource, noteAfterCommit \} from '\.\/author-note\.mjs';$/m);
  assert.match(page, /^import \{ noteEditSource, noteAfterCommit, introPathFor \} from '\.\/author-note\.mjs';$/m);
  assert.match(page, /const srcOf = \(doc: PvDoc\) => \(doc === noteDoc \? noteEditSource\(doc\.get\(\), editing\) : doc\.get\(\)\);/);
  assert.match(page, /set: \(v\) => \{ draft\.authorNote = noteAfterCommit\(v\); \}/);
  assert.match(page, /mdBlocks\(noteEditSource\(src, true\)\)/);
  // Every source read for range maths goes through srcOf, or a commit splices against the wrong text.
  assert.equal((page.match(/\bdoc\.get\(\)\.replace\(/g) || []).length, 0, 'a raw doc.get() is left in a commit path');
  assert.match(page, /planBlockDelete\(srcOf\(doc\), range\)/);
  assert.doesNotMatch(page, /'Add a note for readers\.'/, 'the placeholder string is duplicated in the page');
});
