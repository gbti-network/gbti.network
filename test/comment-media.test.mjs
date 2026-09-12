// A video in a comment (owner, 2026-09-11): a full-width rounded POSTER with a play button, which opens the
// page lightbox and plays. One poster markup from client/src/video-embed.mjs serves the client renderer (a
// comment's bare video line), the built page (Comments.astro swaps the sanitizer's iframe for it at load) and
// the pending-comment cards; a body ```embed fence keeps its inline player. These pin the poster, the
// renderer's two branches, the lightbox's video mode, and the wiring in every comment renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { embedPoster, embedPosterHtml, embedUrl } from '../client/src/video-embed.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { autoplaySrc, EMBED_POSTER_CSS } from '../client-ui/src/embed-lightbox.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('embedPoster: a YouTube link gets its thumbnail, another provider a labelled panel, an unknown URL nothing', () => {
  assert.deepEqual(embedPoster('https://www.youtube.com/watch?v=56f2Pn8KPDE'), { src: 'https://www.youtube.com/embed/56f2Pn8KPDE', thumb: 'https://i.ytimg.com/vi/56f2Pn8KPDE/hqdefault.jpg', provider: 'YouTube', portrait: false });
  assert.deepEqual(embedPoster('https://vimeo.com/123456'), { src: 'https://player.vimeo.com/video/123456', thumb: null, provider: 'Vimeo', portrait: false });
  assert.equal(embedPoster('https://www.tiktok.com/@a.b/video/99').portrait, true);
  assert.equal(embedPoster('https://example.com/x'), null);
});

test('embedPosterHtml: the one markup, escaped, with the frame src the lightbox opens and the play glyph', () => {
  const html = embedPosterHtml('https://youtu.be/56f2Pn8KPDE', { frameSrc: 'https://gbti.network/embed/?u=x"y' });
  assert.match(html, /^<div class="md-embed md-embed-poster" data-embed-src="https:\/\/gbti\.network\/embed\/\?u=x&quot;y" data-embed-url="https:\/\/youtu\.be\/56f2Pn8KPDE"><button type="button" class="md-embed-open" aria-label="Play video"><img class="md-embed-thumb" src="https:\/\/i\.ytimg\.com\/vi\/56f2Pn8KPDE\/hqdefault\.jpg"/);
  assert.match(html, /<span class="md-embed-play" aria-hidden="true"><svg/);
  assert.doesNotMatch(html, /<iframe/, 'the poster never loads a player');
  const vimeo = embedPosterHtml('https://vimeo.com/123456');
  assert.match(vimeo, /data-embed-src="https:\/\/player\.vimeo\.com\/video\/123456"/, 'no frameSrc given: the provider URL');
  assert.match(vimeo, /<span class="md-embed-panel">Vimeo<\/span>/);
  assert.match(embedPosterHtml('https://www.tiktok.com/@a/video/1'), /md-embed-poster md-embed-portrait/);
  assert.equal(embedPosterHtml('https://example.com/nope'), '');
});

test('the client renderer: a comment\'s bare video line is the poster (framing the relay); a body fence keeps the inline player', () => {
  const comment = renderMarkdown('More please\nhttps://www.youtube.com/watch?v=56f2Pn8KPDE', { autoEmbed: true });
  assert.match(comment, /<p>More please<\/p>\s*<div class="md-embed md-embed-poster" data-embed-src="https:\/\/gbti\.network\/embed\/\?u=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3D56f2Pn8KPDE"/);
  assert.doesNotMatch(comment, /<iframe/);
  const fence = renderMarkdown('```embed\nhttps://www.youtube.com/watch?v=56f2Pn8KPDE\n```');
  assert.match(fence, /<div class="md-embed"><iframe src="https:\/\/gbti\.network\/embed\/\?u=/);
  assert.doesNotMatch(fence, /md-embed-poster/);
  // The visual editor serializes a pasted video link as an embed fence, so in a COMMENT the fence is a poster too.
  const fenceInComment = renderMarkdown('```embed\nhttps://www.youtube.com/watch?v=56f2Pn8KPDE\n```', { autoEmbed: true });
  assert.match(fenceInComment, /^<div class="md-embed md-embed-poster" data-embed-src="https:\/\/gbti\.network\/embed\/\?u=/);
  assert.doesNotMatch(fenceInComment, /<iframe/);
});

test('the lightbox helper: autoplay on open, one shared poster stylesheet (full width, rounded, 16:9 and 9:16)', () => {
  assert.equal(autoplaySrc('https://www.youtube.com/embed/x'), 'https://www.youtube.com/embed/x?autoplay=1');
  assert.equal(autoplaySrc('https://gbti.network/embed/?u=y'), 'https://gbti.network/embed/?u=y&autoplay=1');
  assert.equal(autoplaySrc(''), '');
  assert.match(EMBED_POSTER_CSS, /\.md-embed \{ position:relative; width:100%;[^}]*aspect-ratio:16\/9; border-radius:10px; overflow:hidden/);
  assert.match(EMBED_POSTER_CSS, /\.md-embed\.md-embed-portrait \{ aspect-ratio:9\/16/);
  const src = read('client-ui/src/embed-lightbox.mjs');
  assert.match(src, /document\.querySelector\('\[data-lightbox-root\]'\)/, 'the page lightbox when there is one');
  assert.match(src, /new CustomEvent\('gbti-embed-open', \{ bubbles: true, composed: true, detail: \{ src \} \}\)/, 'composed, so a shadow-root poster reaches the page');
  assert.match(src, /dlg\.addEventListener\('close', \(\) => \{ const f = dlg\.querySelector\('iframe'\); if \(f\) f\.removeAttribute\('src'\); \}\)/, 'the fallback dialog stops the player on close');
});

test('the page lightbox has a video mode: the frame, the event listener, the light-DOM click, autoplay, and a close that clears the player', () => {
  const lb = read('src/components/Lightbox.astro');
  assert.match(lb, /<div class="lb-frame" data-lb-frame hidden>\s*<iframe title="Video"[^>]*sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"/);
  assert.match(lb, /document\.addEventListener\('gbti-embed-open', \(e\) => openEmbed\(e\.detail && e\.detail\.src\)\);/);
  assert.match(lb, /e\.target\.closest\('\.md-embed-poster \.md-embed-open'\)/);
  assert.match(lb, /frameEl\.src = src \+ \(src\.includes\('\?'\) \? '&' : '\?'\) \+ 'autoplay=1';/);
  assert.match(lb, /if \(frameEl\) frameEl\.removeAttribute\('src'\); \/\/ stop the player/);
  assert.match(lb, /window\.gbtiLightbox = \{ openEmbed \};/);
  assert.match(lb, /\.lb\[data-mode="video"\] \.lb-fig \{ display: none; \}/);
});

test('every comment renderer wires its posters and carries the shared poster CSS; the built comment swaps its iframe for the poster', () => {
  for (const f of ['client-ui/src/elements/gbti-locked-content.mjs', 'client-ui/src/elements/gbti-comment-echoes.mjs', 'client-ui/src/elements/gbti-discussion.mjs']) {
    const s = read(f);
    assert.match(s, /import \{ EMBED_POSTER_CSS, wireEmbedPosters \} from '\.\.\/embed-lightbox\.mjs';/, f);
    assert.match(s, /\$\{EMBED_POSTER_CSS\}/, `${f} includes the shared CSS`);
    assert.match(s, /wireEmbedPosters\(this\.root\);/, `${f} wires after render`);
  }
  const page = read('src/components/blog/Comments.astro');
  assert.match(page, /import \{ embedPosterHtml \} from '\.\.\/\.\.\/\.\.\/client\/src\/video-embed\.mjs';/);
  assert.match(page, /document\.querySelectorAll<HTMLElement>\('#comments \.cmt-rich \.embed-wrap'\)\.forEach/, 'comment sections only');
  assert.match(page, /wrap\.outerHTML = html;/);
  assert.match(page, /\.cmt-rich \.embed-wrap, \.cmt-rich \.md-embed \{ position: relative; width: 100%;[^}]*aspect-ratio: 16 \/ 9; border-radius: 10px; overflow: hidden/);
  assert.match(page, /\.cmt-rich \.md-embed\.md-embed-portrait \{ aspect-ratio: 9 \/ 16/);
  assert.equal(embedUrl('https://www.youtube.com/embed/56f2Pn8KPDE'), 'https://www.youtube.com/embed/56f2Pn8KPDE', 'the built iframe src re-resolves to itself for the swap');
});
