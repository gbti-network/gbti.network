// sow-459 (owner, 2026-10-25): "move the author note right up under the author card instead of under the CTA".
// On a prompt page the note is rendered twice and one copy shows per screen width: under the sidebar Author card
// while the page is one column (a phone), and under the prompt, above the join box, while the sidebar sits beside
// it. Articles and projects keep the note at the top of the discussion (owner: "Leave projects as they are").
// These read the source because the placement is a page-layout fact; the built HTML is checked on the build.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const PROMPT = read('src/pages/prompts/[slug].astro');
const FOOTER = read('src/components/ContentFooter.astro');
const NOTE = read('src/components/blog/AuthorNote.astro');
const COMMENTS = read('src/components/blog/Comments.astro');

test('the prompt page puts the phone copy directly under the sidebar Author card', () => {
  const card = PROMPT.indexOf('<p class="eyebrow">Author</p>');
  const rail = PROMPT.indexOf('<AuthorNote targetType="prompt" targetSlug={d.slug} author={d.author} aliases={aliasSlugsOf(d)} placement="rail" />');
  const next = PROMPT.indexOf('{crumbs.length > 0 && (');
  assert.ok(card > 0 && rail > card, 'after the Author card');
  assert.ok(next > rail, 'before the Categories card, so nothing sits between the card and the note');
  // Only the Author card's own closing markup and the comment explaining the move separate them.
  const between = PROMPT.slice(PROMPT.indexOf('</div>\n\n', PROMPT.indexOf('See all {authorCount}')), rail);
  assert.doesNotMatch(between, /class="card"/, 'no other card between the Author card and the note');
  assert.ok(rail < PROMPT.indexOf('</aside>'), 'inside the sidebar');
});

test('the prompt page asks the closing block to open with the desktop copy', () => {
  assert.match(PROMPT, /<ContentFooter type="prompt" slug=\{d\.slug\} author=\{d\.author\} publishedAt=\{d\.publishedAt\} wide hideAuthor noteFirst aliases=\{aliasSlugsOf\(d\)\} \/>/);
});

test('articles and projects keep the note in the thread', () => {
  for (const p of ['src/pages/projects/[slug].astro', 'src/pages/articles/[slug].astro']) {
    const s = read(p);
    assert.match(s, /<ContentFooter /, `${p} mounts the closing block`);
    assert.doesNotMatch(s, /noteFirst|<AuthorNote/, `${p} does not move the note`);
  }
  assert.match(FOOTER, /noteFirst = false \} = Astro\.props;/, 'off unless a page asks');
});

test('with noteFirst, the note opens the block above the join panel and the thread skips it', () => {
  const wide = FOOTER.indexOf('{noteFirst && <AuthorNote targetType={type} targetSlug={slug} author={author} aliases={aliases} placement="wide" />}');
  const invite = FOOTER.indexOf('{invite ? <CommunityInvite');
  assert.ok(wide > 0 && invite > wide, 'the note, then the join panel');
  assert.match(FOOTER, /<Comments targetType=\{type\} targetSlug=\{slug\} author=\{author\} wide=\{wide\} aliases=\{aliases\} note=\{!noteFirst\} \/>/);
  // note={false} drops the card but still keeps every note out of the thread, so an intro never shows twice.
  assert.match(COMMENTS, /note = true \} = Astro\.props;/);
  assert.match(COMMENTS, /const intro = note && notes\.length \? notes\[notes\.length - 1\] : null;/);
  assert.match(COMMENTS, /\.filter\(\(c\) => !notes\.includes\(c\)\)/);
});

test('exactly one copy shows at any width, switching where the prompt grid goes to one column', () => {
  const grid = read('src/styles/gbti-v3-feed.css').match(/@media \(max-width: (\d+)px\) \{\s*\n\s*\.detail-grid \{ grid-template-columns: 1fr; \}/);
  assert.ok(grid, 'the prompt grid collapse rule');
  const bp = Number(grid[1]);
  const hideWide = NOTE.match(/@media \(max-width: (\d+)px\) \{ \.author-note-slot\[data-placement="wide"\] \{ display: none; \} \}/);
  const hideRail = NOTE.match(/@media \(min-width: (\d+)px\) \{ \.author-note-slot\[data-placement="rail"\] \{ display: none; \} \}/);
  assert.ok(hideWide && hideRail, 'both hide rules');
  assert.equal(Number(hideWide[1]), bp, 'the desktop copy hides exactly when the grid collapses');
  assert.equal(Number(hideRail[1]), bp + 1, 'the phone copy hides from the next pixel up, so no width shows both or neither');
  // An unplaced note (inside Comments) carries no placement and is never hidden by these rules.
  assert.match(COMMENTS, /\{intro && <AuthorNote targetType=\{targetType\} targetSlug=\{targetSlug\} author=\{author\} aliases=\{aliases\} \/>\}/);
});

test('a note outside the thread keeps its video posters and live tweets', () => {
  assert.match(COMMENTS, /'#comments \.cmt-rich \.embed-wrap, \[data-author-note\] \.cmt-rich \.embed-wrap'/);
  assert.match(COMMENTS, /document\.querySelectorAll<HTMLElement>\('\[data-author-note\]'\)\.forEach\(\(n\) => \{ if \(!n\.closest\('#comments'\)\) wireTweets\(n, \{ via: 'direct' \}\); \}\);/, 'wired once each, never twice inside the thread');
});
