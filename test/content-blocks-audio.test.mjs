// The ```audio block (owner, 2026-10-26, option A on the article podcast canvas: the browser's own player under a
// label and its length). It plays files gbti.network serves itself from public/media/podcasts/, the same on the site,
// the WorkBench preview and the extension reader, and becomes a plain link on a cross-post. The sanitizer admits the
// player only with those files, never autoplaying or preloading, so a hand-written audio tag gets no further.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { parseAudio, renderDataBlock, dataBlocksCss, checkComponentBlocks } from '../client/src/content-blocks.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema } from '../src/lib/markdown-sanitize.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { stripSiteOnlyFences } from '../clients/syndication/devto-body.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { podcastFileProblem, audioBlockSources, PODCAST_MAX_BYTES } from '../scripts/lib/media-rules.mjs';

const site = async (md) => String(await unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema).use(rehypeStringify).process(md));
const F = '```';
const OGG = '/media/podcasts/how-ai-agents-replace-web-dashboards.ogg';
const MP3 = '/media/podcasts/how-ai-agents-replace-web-dashboards.mp3';
const INNER = `length: 22 minutes\nsrc: ${OGG}\nsrc: ${MP3}`;
const AUDIO = `${F}audio Listen to the podcast version\n${INNER}\n${F}`;

test('parser: the label, the length, typed sources in order, and what it leaves out', () => {
  const a = parseAudio(`${INNER}\nsrc: https://cdn.example/a.ogg\nsrc: /media/podcasts/../secret.ogg\nsrc: /media/podcasts/Loud.MP3\nsrc: /media/other/a.ogg\nsrc: /media/podcasts/a.opus\nsrc: /media/podcasts/a.m4a\ncover: x`, 'Listen to the podcast version');
  assert.equal(a.label, 'Listen to the podcast version');
  assert.equal(a.length, '22 minutes');
  assert.deepEqual(a.sources, [{ src: OGG, type: 'audio/ogg; codecs=opus' }, { src: MP3, type: 'audio/mpeg' }]);
  // .opus and .m4a are refused: Cloudflare served them uncached and without byte ranges, so the length never showed.
  assert.deepEqual(a.bad, ['https://cdn.example/a.ogg', '/media/podcasts/../secret.ogg', '/media/podcasts/Loud.MP3', '/media/other/a.ogg', '/media/podcasts/a.opus', '/media/podcasts/a.m4a']);
  assert.deepEqual(a.unknown, ['cover: x']);
  assert.equal(parseAudio(`src: ${OGG}`).label, 'Listen');
  assert.equal(renderDataBlock('audio', 'length: 22 minutes\nsrc: https://cdn.example/a.ogg', 'X'), null, 'no usable source, no player');
});

test('site: the label row, then a player that loads nothing until play, with both sources', async () => {
  const html = await site(AUDIO);
  assert.match(html, /^<div class="gbti-audio"><div class="gbti-audio-head"><span class="gbti-audio-label">Listen to the podcast version<\/span> <span class="gbti-audio-length">22 minutes<\/span><\/div>/);
  assert.match(html, /<audio class="gbti-audio-player" controls preload="none" aria-label="Listen to the podcast version">/);
  assert.ok(html.includes(`<source src="${OGG}" type="audio/ogg; codecs=opus"><source src="${MP3}" type="audio/mpeg"></audio></div>`), html);
  assert.doesNotMatch(html, /<pre|<code/);
});

test('sanitizer: a hand-written audio tag cannot autoplay, preload, or play anything but our own files', async () => {
  const html = await site([
    '<audio autoplay loop preload="auto" src="https://cdn.example/a.mp3" class="spy" onplay="x()"><source src="https://cdn.example/a.ogg" type="audio/ogg"></audio>',
    '',
    `<audio controls><source src="${MP3}" type="text/html"></audio>`,
  ].join('\n'));
  for (const bad of ['autoplay', 'loop', 'preload="auto"', 'cdn.example', 'spy', 'onplay', 'text/html']) assert.ok(!html.includes(bad), `${bad} survived: ${html}`);
  assert.ok(html.includes(`<audio controls><source src="${MP3}"></audio>`), html);
});

test('preview and reader: the same player, with the sources on gbti.network (the reader is chrome-extension://)', async () => {
  const r = renderMarkdown(AUDIO);
  const siteHtml = await site(AUDIO);
  assert.equal(r, siteHtml.replace(/src="\/media\//g, 'src="https://gbti.network/media/'));
  assert.ok(r.includes(`<source src="https://gbti.network${OGG}"`));
});

test('cross-posts: a link to the MP3 file with the length, no code block', () => {
  const md = stripSiteOnlyFences(`${AUDIO}\n\nThe article.`);
  assert.equal(md, `[Listen to the podcast version](https://gbti.network${MP3}) (22 minutes)\n\nThe article.`);
  assert.equal(stripSiteOnlyFences(`${F}audio Hear it\nsrc: ${OGG}\n${F}`), `[Hear it](https://gbti.network${OGG})`);
});

test('validator: none for a good block, a warning for each fault', () => {
  assert.deepEqual(checkComponentBlocks(AUDIO), []);
  const msgs = checkComponentBlocks([
    `${F}audio\nsrc: ${OGG}\n${F}`,
    `${F}audio Hear it\nlength: 3 minutes\nsrc: https://cdn.example/a.mp3\nspeed: 2x\n${F}`,
  ].join('\n\n')).map((x) => `${x.line}: ${x.message}`).join('\n');
  for (const re of [/^1: audio needs its label/m, /^1: audio needs a "length:" line/m, /^5: audio source "https:\/\/cdn\.example\/a\.mp3" is not a \/media\/podcasts\/ file/m,
    /^5: audio needs at least one "src:" line/m, /^5: audio line "speed: 2x" is not src: or length:/m]) assert.match(msgs, re);
});

test('styles and the editor: rules for every class, and the block round-trips unchanged', () => {
  const css = dataBlocksCss('.p', { fg: 'a', soft: 'b', mute: 'c', line: 'd', line2: 'e', rest: 'f', green: 'g', green700: 'h', green700Solid: 'h2', greenTint: 'i', greenBorder: 'j', surface: 'k', mono: 'm' });
  for (const c of ['gbti-audio', 'gbti-audio-head', 'gbti-audio-label', 'gbti-audio-length', 'gbti-audio-player']) assert.ok(css.includes(`.p .${c}{`), `no rule for ${c}`);
  assert.match(css, /\.p \.gbti-audio-player\{display:block;width:100%/);
  // At the top of an article it sits under the cover, whose frame ends 8px above the body; the board shows about 22px.
  assert.match(css, /\.p > \.gbti-audio:first-child\{margin-top:14px\}/);
  const doc = ['An opening line.', AUDIO, 'The rest.'].join('\n\n');
  assert.equal(serializeBlocks(parseBlocks(doc)), doc);
});

test('media rules: recordings only in public/media/podcasts/, Ogg (Opus) or MP3, under the cap; block sources listed', () => {
  assert.equal(podcastFileProblem({ rel: 'public/media/podcasts/how-ai-agents-replace-web-dashboards.ogg', bytes: 2876312 }), null);
  assert.equal(podcastFileProblem({ rel: 'public/media/podcasts/a.mp3', bytes: PODCAST_MAX_BYTES }), null);
  assert.match(podcastFileProblem({ rel: 'public/media/podcasts/a.mp3', bytes: PODCAST_MAX_BYTES + 1 }), /over 20 MB/);
  for (const rel of ['members/atwellpub/posts/x/talk.ogg', 'public/media/podcasts/a.opus', 'public/media/podcasts/a.m4a', 'public/media/a.ogg', 'public/media/podcasts/Big.ogg']) {
    assert.match(podcastFileProblem({ rel, bytes: 10 }), /recordings go in public\/media\/podcasts\//, rel);
  }
  assert.deepEqual(audioBlockSources(`Intro.\n\n${AUDIO}\n\n${F}audio Two\nsrc: https://cdn.example/a.ogg\nsrc: /media/podcasts/b.mp3\n${F}\n\n${F}js\nsrc: /media/podcasts/c.ogg\n${F}`), [OGG, MP3, '/media/podcasts/b.mp3']);
});
