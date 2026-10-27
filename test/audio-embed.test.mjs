// sow-483 (owner, 2026-10-27): the ```audio block can play a SoundCloud, Spotify or Apple Podcasts recording in the
// provider's own player, under our label and length, and any block can carry a link out to the recording's page.
// The parser admits only those three players; the sanitizer and the site's frame-src admit exactly those hosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { audioEmbed, embedProblem } from '../client/src/audio-embed.mjs';
import { parseAudio, audioLinkLabel, renderDataBlock, dataBlocksCss, checkComponentBlocks } from '../client/src/content-blocks.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeIframeHostAllowlist, IFRAME_HOSTS } from '../src/lib/markdown-sanitize.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { stripSiteOnlyFences } from '../clients/syndication/devto-body.mjs';
import { parseHeaders, parseCsp, cspForPath } from '../scripts/check-headers.mjs';

const site = async (md) => String(await unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema).use(rehypeIframeHostAllowlist)
  .use(rehypeStringify).process(md));
const F = '```';
const SC = 'https://soundcloud.com/gbti-network/how-ai-agents-replace-web-dashboards';
const SP_ID = 'A1b2C3d4E5f6G7h8I9j0K1';
const AP = 'https://podcasts.apple.com/us/podcast/gbti-talks/id1700000001?i=1000600000001';

test('SoundCloud: tracks and playlists, query dropped, its own sections and short links refused', () => {
  const t = audioEmbed('soundcloud', `${SC}?si=abc&utm_source=clipboard`);
  assert.deepEqual([t.kind, t.page, t.height], ['track', SC, 166]);
  assert.equal(t.src, `https://w.soundcloud.com/player/?url=${encodeURIComponent(SC)}&color=%231f9e5f&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`);
  assert.equal(audioEmbed('soundcloud', 'https://m.soundcloud.com/gbti-network/sets/season-one').kind, 'playlist');
  assert.equal(audioEmbed('soundcloud', 'https://soundcloud.com/gbti-network/sets/season-one').height, 300);
  assert.equal(audioEmbed('soundcloud', `${SC}/s-Ab12Cd`).page, `${SC}/s-Ab12Cd`, 'a private share link keeps its token');
  for (const bad of ['https://soundcloud.com/gbti-network', 'https://soundcloud.com/discover/sets/x', 'https://soundcloud.com/gbti-network/tracks',
    'https://on.soundcloud.com/AbCd', 'https://evil.example/gbti-network/x', 'javascript:alert(1)', 'https://soundcloud.com/a/b/c/d']) {
    assert.equal(audioEmbed('soundcloud', bad), null, bad);
  }
});

test('Spotify and Apple Podcasts: episodes and shows only', () => {
  assert.deepEqual(audioEmbed('spotify', `https://open.spotify.com/episode/${SP_ID}?si=x`), { provider: 'spotify', kind: 'episode', page: `https://open.spotify.com/episode/${SP_ID}`, src: `https://open.spotify.com/embed/episode/${SP_ID}`, height: 152 });
  assert.equal(audioEmbed('spotify', `https://open.spotify.com/intl-de/show/${SP_ID}`).src, `https://open.spotify.com/embed/show/${SP_ID}`);
  for (const bad of [`https://open.spotify.com/track/${SP_ID}`, 'https://open.spotify.com/episode/short', 'https://spotify.link/x', `https://evil.example/episode/${SP_ID}`]) assert.equal(audioEmbed('spotify', bad), null, bad);
  const ep = audioEmbed('apple', AP);
  assert.deepEqual([ep.kind, ep.src, ep.height], ['episode', 'https://embed.podcasts.apple.com/us/podcast/gbti-talks/id1700000001?i=1000600000001', 175]);
  assert.deepEqual([audioEmbed('apple', 'https://podcasts.apple.com/gb/podcast/id1700000001').kind, audioEmbed('apple', 'https://podcasts.apple.com/gb/podcast/id1700000001').height], ['show', 450]);
  for (const bad of ['https://music.apple.com/us/album/x/id1', 'https://podcasts.apple.com/us/podcast/x/id1?i=abc', 'https://podcasts.apple.com/podcast/id1']) assert.equal(audioEmbed('apple', bad), null, bad);
});

test('a refused link gets a sentence an author can act on', () => {
  assert.equal(embedProblem('soundcloud', 'https://www.youtube.com/watch?v=x'), 'This is a YouTube link. Paste a SoundCloud track or playlist link, or add the video with a Video block.');
  assert.equal(embedProblem('soundcloud', 'https://on.soundcloud.com/AbCd'), 'This is a short link. Open it, then copy the full SoundCloud address from the page.');
  assert.equal(embedProblem('spotify', `https://open.spotify.com/track/${SP_ID}`), 'This link is not a Spotify episode or show. Paste a Spotify episode or show link.');
  assert.equal(embedProblem('apple', 'nope'), '"nope" is not a web address. Paste an Apple Podcasts episode or show link.');
});

test('on the site: the label row, the provider player and the link out survive the sanitizer', async () => {
  const html = await site(`${F}audio Listen to the podcast version\nlength: 22 minutes\nsoundcloud: ${SC}\nlink: ${SC}\n${F}`);
  assert.match(html, /^<div class="gbti-audio"><div class="gbti-audio-head"><span class="gbti-audio-label">Listen to the podcast version<\/span> <span class="gbti-audio-length">22 minutes<\/span><\/div><div class="gbti-audio-embed gbti-audio-embed-soundcloud"><iframe src="https:\/\/w\.soundcloud\.com\/player\/\?url=/);
  assert.match(html, /title="SoundCloud player: Listen to the podcast version" loading="lazy" allow="autoplay"><\/iframe><\/div><a class="gbti-audio-link" href="https:\/\/soundcloud\.com\/gbti-network\/how-ai-agents-replace-web-dashboards" target="_blank" rel="noopener nofollow">Listen on SoundCloud<\/a><\/div>$/);
  const apple = await site(`${F}audio Hear it\napple: ${AP}\n${F}`);
  assert.match(apple, /<div class="gbti-audio-embed gbti-audio-embed-apple"><iframe src="https:\/\/embed\.podcasts\.apple\.com\/[^"]+" title="Apple Podcasts player: Hear it" loading="lazy" allow="autoplay \*; encrypted-media \*; fullscreen \*; clipboard-write" sandbox="allow-forms allow-popups allow-same-origin allow-scripts/);
  assert.match(await site(`${F}audio Hear it\nspotify: https://open.spotify.com/show/${SP_ID}\n${F}`), /gbti-audio-embed gbti-audio-embed-spotify"><iframe src="https:\/\/open\.spotify\.com\/embed\/show\//);
  assert.match(await site(`${F}audio Hear it\nsoundcloud: https://soundcloud.com/gbti-network/sets/season-one\n${F}`), /gbti-audio-embed-soundcloud-tall/);
  // An unrecognized link renders no frame at all (the fence stays a code block, and validation names the problem).
  assert.doesNotMatch(await site(`${F}audio Hear it\nsoundcloud: https://evil.example/a/b\n${F}`), /<iframe/);
});

test('the sanitizer keeps a raw frame only on the three player hosts, and only our link class', async () => {
  for (const host of ['w.soundcloud.com', 'open.spotify.com', 'embed.podcasts.apple.com']) assert.ok(IFRAME_HOSTS.has(host), host);
  assert.doesNotMatch(await site('<iframe src="https://evil.example/player"></iframe>\n'), /<iframe/);
  assert.match(await site('<iframe src="https://open.spotify.com/embed/episode/x"></iframe>\n'), /<iframe src="https:\/\/open\.spotify\.com/);
  const a = await site('<a class="gbti-audio-link gbti-audio-linky" href="https://a.example">x</a>\n');
  assert.match(a, /<a class="gbti-audio-link" href=/);
  assert.match(await site('<div class="gbti-audio-embed-apple-tall gbti-audio-embed-evil">x</div>\n'), /<div class="gbti-audio-embed-apple-tall">x<\/div>/);
});

test('the site policy frames every host the sanitizer admits (public/_headers, the global rule)', () => {
  const rules = parseHeaders(fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'));
  const frameSrc = parseCsp(cspForPath(rules, '/articles/x/')).get('frame-src').tokens;
  for (const host of IFRAME_HOSTS) assert.ok(frameSrc.includes(`https://${host}`), `frame-src lacks ${host}`);
});

test('the link out: its words, its place in the markup, the bar and the card, and cross-posts', async () => {
  assert.equal(audioLinkLabel(`https://open.spotify.com/episode/${SP_ID}`), 'Listen on Spotify');
  assert.equal(audioLinkLabel(AP), 'Open in Apple Podcasts');
  assert.equal(audioLinkLabel('https://www.example.org/episode/7'), 'Listen on example.org');
  assert.equal(audioLinkLabel('https://www.example.org/episode/7', 'Show notes'), 'Show notes');
  const FILE = 'src: /media/podcasts/how-ai-agents-replace-web-dashboards.ogg\nsrc: /media/podcasts/how-ai-agents-replace-web-dashboards.mp3';
  const bar = await site(`${F}audio Listen\nlength: 22 minutes\n${FILE}\nlink: https://open.spotify.com/episode/${SP_ID}\n${F}`);
  assert.match(bar, /<\/audio><a class="gbti-audio-link" href="https:\/\/open\.spotify\.com\/episode\/[^"]+" target="_blank" rel="noopener nofollow">Listen on Spotify<\/a><\/div>$/);
  const card = await site(`${F}audio Listen\nstyle: card\n${FILE}\nlink: https://example.org/ep\nlink-label: Show notes\n${F}`);
  assert.match(card, /^<div class="gbti-audio gbti-audio-card">.*<\/audio><a class="gbti-audio-link"[^>]*>Show notes<\/a><\/div>$/);
  const embedMd = `${F}audio Listen\nlength: 22 minutes\nsoundcloud: ${SC}\nlink: https://open.spotify.com/episode/${SP_ID}\n${F}`;
  assert.equal(stripSiteOnlyFences(embedMd), `[Listen](${SC}) (22 minutes) · [Listen on Spotify](https://open.spotify.com/episode/${SP_ID})`);
  assert.equal(stripSiteOnlyFences(`${F}audio Listen\nsoundcloud: ${SC}\nlink: ${SC}\n${F}`), `[Listen](${SC})`, 'no second link to the same page');
  // The preview and the reader draw the same thing (a provider's address is absolute already).
  assert.equal(renderMarkdown(embedMd), (await site(embedMd)).replace(/&#x26;/g, '&amp;'), 'the same markup; the site serializer writes & as &#x26;');
});

test('the styles: the link out, the grid that moves it under the player on a phone, and each frame size', () => {
  const css = dataBlocksCss('.p', { fg: 'a', soft: 'b', mute: 'c', line: 'd', line2: 'e', rest: 'f', green: 'g', green700: 'h', green700Solid: 'h2', greenTint: 'i', greenBorder: 'j', surface: 'k', card: 'n', mono: 'm' });
  for (const [cls, h] of [['soundcloud', 166], ['soundcloud-tall', 300], ['spotify', 152], ['apple', 175], ['apple-tall', 450]]) {
    assert.match(css, new RegExp(`\\.p \\.gbti-audio-embed-${cls} iframe\\{height:${h}px`), cls);
  }
  // The card's row wraps so the link out can drop under it on a phone; the text must shrink, never wrap off the button.
  assert.match(css, /\.p \.gbti-audio-row \.gbti-audio-head\{flex:1 1 0;min-width:0\}/);
  // The prose rule gives every iframe a 16:9 ratio and a margin; the frame rule has to undo both.
  assert.match(css, /\.p \.gbti-audio-embed iframe\{[^}]*margin:0[^}]*aspect-ratio:auto/);
  assert.match(css, /\.p a\.gbti-audio-link::after\{content:"\\2197"/);
  assert.match(css, /@media \(max-width:560px\)\{\n\.p \.gbti-audio:not\(\.gbti-audio-card\)>\.gbti-audio-link\{grid-column:1\/-1;grid-row:auto/);
  // The responsive block must come after the rule it overrides (a media query adds no specificity).
  assert.ok(css.indexOf('@media (max-width:560px)') > css.indexOf('>.gbti-audio-link{grid-column:2'));
  assert.doesNotMatch(css, /undefined/);
});

test('validation: two sources, a refused link, a card on a provider, a bad link out', () => {
  assert.deepEqual(checkComponentBlocks(`${F}audio Listen\nlength: 22 minutes\nsoundcloud: ${SC}\nlink: ${SC}\nlink-label: Listen on SoundCloud\n${F}`), []);
  const msgs = checkComponentBlocks(`${F}audio Listen\nlength: 2 minutes\nsoundcloud: https://www.youtube.com/watch?v=x\nspotify: https://open.spotify.com/episode/${SP_ID}\nstyle: card\nlink: ftp://x\n${F}\n\n${F}audio Two\nlength: 1 minute\napple: ${AP}\nlink-label: Notes\n${F}`).map((x) => x.message);
  for (const re of [/^audio has more than one source/, /^audio soundcloud: This is a YouTube link/, /^audio style: card applies to a file only/, /^audio link: "ftp:\/\/x" is not an http or https address/, /^audio link-label: has no link: line/]) {
    assert.ok(msgs.some((m) => re.test(m)), `${re} in ${msgs.join(' | ')}`);
  }
  assert.equal(parseAudio(`spotify: https://open.spotify.com/episode/${SP_ID}`).embed.provider, 'spotify');
});
