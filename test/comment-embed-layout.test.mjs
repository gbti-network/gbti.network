// sow-444 (owner, 2026-10-06): in a comment, an embed (a tweet, a video poster) sits under the avatar and runs card edge
// to card edge; a tweet is capped at X's 550px and centred. Each comment container declares how far its text column sits
// in (--embed-out-l / --embed-out-r) and the embed rules break out by that much. These derive each declared offset from
// the container's OWN padding, avatar size and gap, so resizing an avatar or a card without moving its offset fails
// here; and they pin which surfaces take the rules and which must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COMMENT_EMBED_CSS, TWEET_CSS } from '../client-ui/src/tweet-frames.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const px = (re, s, what) => { const m = s.match(re); assert.ok(m, `${what}: not found`); return Number(m[1]); };

test('the shared rules: a ready tweet and a video poster break out by the declared offsets; the tweet is capped and centred', () => {
  const c = COMMENT_EMBED_CSS;
  assert.match(c, /\.md-tweet\.is-ready \{ margin-left:calc\(-1 \* var\(--embed-out-l, 0px\)\); margin-right:calc\(-1 \* var\(--embed-out-r, 0px\)\); max-width:none; \}/);
  assert.match(c, /\.md-tweet\.is-ready > iframe \{ max-width:550px; margin-inline:auto; \}/, 'X renders at most 550px: centred in a wider card');
  assert.match(c, /\.md-embed \{ width:auto; margin-left:calc\(-1 \* var\(--embed-out-l, 0px\)\); margin-right:calc\(-1 \* var\(--embed-out-r, 0px\)\); \}/, 'width:auto, or the poster would not grow');
  assert.match(c, /\.md-embed\.md-embed-portrait \{ width:min\(360px, calc\(100% \+ var\(--embed-out-l, 0px\) \+ var\(--embed-out-r, 0px\)\)\);/);
  assert.doesNotMatch(c, /\.md-tweet \{/, 'a tweet still loading (or missing) keeps its link in the text column');
  assert.match(TWEET_CSS, /\.md-tweet \{ margin:\.6em 0 1em; max-width:550px; \}/, 'the base block is unchanged');
});

test('the extension discussion: the row and the author-note card declare padding + avatar + gap', () => {
  const s = read('client-ui/src/elements/gbti-discussion.mjs');
  const pad = px(/\.comment \{[^}]*padding-left:(\d+)px;/, s, 'row padding');
  const gap = px(/\.comment \{ display:flex; gap:(\d+)px;/, s, 'row gap');
  const av = px(/\.comment \.cav \{[^}]*width:(\d+)px;/, s, 'avatar');
  assert.equal(px(/\.comment \{[^}]*--embed-out-l:(\d+)px;/, s, 'row offset'), pad + av + gap);
  assert.equal(px(/\.comment \{[^}]*--embed-out-r:(\d+)px;/, s, 'row right'), 0);
  const notePad = px(/\.comment\.note \{[^}]*padding:\d+px (\d+)px;/, s, 'note padding');
  assert.equal(px(/\.comment\.note \{[^}]*--embed-out-l:(\d+)px;/, s, 'note offset'), notePad + av + gap);
  assert.equal(px(/\.comment\.note \{[^}]*--embed-out-r:(\d+)px;/, s, 'note right'), notePad);
});

test('the website posting card declares padding + avatar + gap', () => {
  const s = read('client-ui/src/elements/gbti-comment-echoes.mjs');
  const pad = px(/\.card \{[^}]*padding:(\d+)px;/, s, 'padding');
  const gap = px(/\.card \{[^}]*gap:(\d+)px;/, s, 'gap');
  const av = px(/\.cav \{ width:(\d+)px;/, s, 'avatar');
  assert.equal(px(/\.card \{[^}]*--embed-out-l:(\d+)px;/, s, 'offset'), pad + av + gap);
  assert.equal(px(/\.card \{[^}]*--embed-out-r:(\d+)px;/, s, 'right'), pad);
});

test('the website built list: the comment card and the author intro declare their offsets; the global rules break out', () => {
  const s = read('src/components/blog/Comments.astro');
  const li = s.match(/<li class="card" style="([^"]+)">\s*\n\s*<a href=\{profileHref\(c\.data\.author\)\} class="shrink-0"><Avatar [^>]*size=\{(\d+)\}/);
  assert.ok(li, 'the comment card and its avatar');
  const st = li[1];
  const pad = px(/padding:(\d+)px/, st, 'padding'); const gap = px(/gap:(\d+)px/, st, 'gap');
  assert.equal(px(/--embed-out-l:(\d+)px/, st, 'offset'), pad + Number(li[2]) + gap);
  assert.equal(px(/--embed-out-r:(\d+)px/, st, 'right'), pad);
  const intro = s.match(/<article class="card" style="([^"]+)">/)[1];
  const ipad = px(/padding:(\d+)px/, intro, 'intro padding');
  assert.equal(px(/--embed-out-l:(\d+)px/, intro, 'intro offset'), ipad, 'the intro\'s avatar is in a header row, so only its padding');
  assert.equal(px(/--embed-out-r:(\d+)px/, intro, 'intro right'), ipad);
  assert.match(s, /\.cmt-rich \.md-tweet\.is-ready \{ margin-left: calc\(-1 \* var\(--embed-out-l, 0px\)\); margin-right: calc\(-1 \* var\(--embed-out-r, 0px\)\); max-width: none; \}/);
  assert.match(s, /\.cmt-rich \.md-tweet\.is-ready > iframe \{ max-width: 550px; margin-inline: auto; \}/);
  assert.match(s, /\.cmt-rich \.md-embed, \.cmt-rich \.embed-wrap \{ width: auto; margin-left: calc\(-1 \* var\(--embed-out-l, 0px\)\);/);
  assert.ok(s.indexOf('.cmt-rich .md-embed, .cmt-rich .embed-wrap { width: auto;') > s.indexOf('.cmt-rich .embed-wrap, .cmt-rich .md-embed { position: relative; width: 100%;'), 'after the base rule, so it wins');
});

test('only comment surfaces take the rules, after the rules they override', () => {
  for (const p of ['client-ui/src/elements/gbti-discussion.mjs', 'client-ui/src/elements/gbti-comment-echoes.mjs']) {
    const s = read(p);
    const at = s.indexOf('${COMMENT_EMBED_CSS}');
    assert.ok(at > s.indexOf('${TWEET_CSS}') && at > s.indexOf('${EMBED_POSTER_CSS}'), `${p}: after TWEET_CSS and EMBED_POSTER_CSS`);
  }
  assert.match(read('client-ui/src/elements/gbti-locked-content.mjs'), /this\.css\(PROSE \+ \(autoEmbed \? COMMENT_EMBED_CSS : ''\)\)/, 'a members-only comment only, never an article section');
  for (const p of ['client-ui/src/elements/gbti-reader.mjs', 'client-ui/src/elements/gbti-prose-editor.mjs', 'src/pages/shares/[author]/[id].astro']) {
    assert.doesNotMatch(read(p), /COMMENT_EMBED_CSS|--embed-out-/, `${p}: the share tweet, articles and the editor are unchanged`);
  }
});

test('a body that begins with an embed starts below the avatar: the name row takes the avatar\'s height', () => {
  const d = read('client-ui/src/elements/gbti-discussion.mjs');
  const dav = px(/\.comment \.cav \{[^}]*width:(\d+)px;/, d, 'discussion avatar');
  assert.equal(px(/\.cmain:has\(> \.cbody > :is\(\.md-tweet\.is-ready, \.md-embed\):first-child\) > \.cmeta \{ min-height:(\d+)px; \}/, d, 'discussion rule'), dav);
  const e = read('client-ui/src/elements/gbti-comment-echoes.mjs');
  const eav = px(/\.cav \{ width:(\d+)px;/, e, 'posting avatar');
  assert.equal(px(/\.main:has\(> \.body > :is\(\.md-tweet\.is-ready, \.md-embed\):first-child\) > \.meta \{ min-height:(\d+)px; \}/, e, 'posting rule'), eav);
  const s = read('src/components/blog/Comments.astro');
  const sav = px(/class="shrink-0"><Avatar item=\{\{ name: authorDisplay\(c\.data\.author\)[^>]*size=\{(\d+)\}/, s, 'site avatar');
  assert.match(s, /<div class="cmt-col" style="flex:1;min-width:0">\s*\n\s*<div class="cmt-meta flex items-center g8 body-sm muted">/);
  const rule = s.match(/\.cmt-col:has\(> \.cmt-rich > :is\(\.md-tweet\.is-ready, \.md-embed, \.embed-wrap\):first-child\) > \.cmt-meta,\s*\n\s*\.cmt-col:has\(gbti-locked-content\[data-embed-first\]\) > \.cmt-meta \{ min-height: (\d+)px; \}/);
  assert.ok(rule, 'the public body and a members-only body');
  assert.equal(Number(rule[1]), sav);
});

test('a members-only comment flags its host when its body begins with an embed (a poster at once, a tweet once ready)', () => {
  const s = read('client-ui/src/elements/gbti-locked-content.mjs');
  assert.match(s, /const first = this\.root\.querySelector\('\.unlocked > :first-child'\);/);
  assert.match(s, /if \(autoEmbed && first\?\.classList\.contains\('md-embed'\)\) this\.setAttribute\('data-embed-first', ''\);/);
  assert.match(s, /wireTweets\(this\.root, \{ onReady: \(el\) => \{ if \(autoEmbed && el === first\) this\.setAttribute\('data-embed-first', ''\); \} \}\);/);
});
