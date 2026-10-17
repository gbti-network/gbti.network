// A Mixcloud share plays in place (owner, 2026-10-17): Mixcloud's slim player under the share's picture, in the extension
// reader, the shares stream and the website share page. The VIDEO rule stays video-only, so comments, article videos and
// the editor never start treating a mix as a video. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audioEmbedUrl, shareEmbed, embedUrl, AUDIO_EMBED_HEIGHT } from '../client/src/video-embed.mjs';

const MIX = 'https://www.mixcloud.com/baseline519/dms-age-of-enlightenment/';
const WIDGET = `https://www.mixcloud.com/widget/iframe/?hide_cover=1&feed=${encodeURIComponent(MIX)}`;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a Mixcloud mix link becomes Mixcloud\'s own player address', () => {
  assert.equal(audioEmbedUrl(MIX), WIDGET);
  assert.equal(audioEmbedUrl('https://www.mixcloud.com/baseline519/dms-age-of-enlightenment'), WIDGET, 'no trailing slash');
  assert.equal(audioEmbedUrl('https://m.mixcloud.com/baseline519/dms-age-of-enlightenment/?utm_source=x'), WIDGET, 'mobile host, query dropped');
  assert.equal(audioEmbedUrl('http://mixcloud.com/baseline519/dms-age-of-enlightenment/'), WIDGET);
  assert.equal(AUDIO_EMBED_HEIGHT, 120);
});

test('anything that is not a single mix gets no player', () => {
  for (const u of [
    'https://www.mixcloud.com/baseline519/',                     // an account page
    'https://www.mixcloud.com/baseline519/uploads/',             // an account listing
    'https://www.mixcloud.com/baseline519/favorites/',
    'https://www.mixcloud.com/discover/drum-and-bass/',          // Mixcloud's own pages
    'https://www.mixcloud.com/widget/iframe/',                   // the player itself
    'https://www.mixcloud.com/a/b/c/',                           // too deep
    'https://mixcloud.com.example.net/baseline519/mix/',         // look-alike hosts
    'https://evilmixcloud.com/baseline519/mix/',
    'javascript:alert(1)//mixcloud.com/a/b/',
    'https://www.mixcloud.com/base%22line/mix/',                 // characters a handle cannot hold
    '',
  ]) assert.equal(audioEmbedUrl(u), null, u);
});

test('the video rule is untouched: a mix is not a video, and videos answer as before', () => {
  assert.equal(embedUrl(MIX), null);
  assert.deepEqual(shareEmbed(MIX), { src: WIDGET, kind: 'audio' });
  assert.deepEqual(shareEmbed('https://youtu.be/dQw4w9WgXcQ'), { src: 'https://www.youtube.com/embed/dQw4w9WgXcQ', kind: 'video' });
  assert.deepEqual(shareEmbed('https://www.tiktok.com/@a/video/123'), { src: 'https://www.tiktok.com/embed/v2/123', kind: 'portrait' });
  assert.equal(shareEmbed('https://example.com/article'), null);
});

test('the site allows the Mixcloud player wherever it lists players', () => {
  const headers = read('public/_headers');
  const frameSrcs = [...headers.matchAll(/frame-src ([^;]+);/g)].map((m) => m[1]);
  assert.equal(frameSrcs.length, 3, 'the site rule and the two player-page rules');
  // Mixcloud's player address forwards to player-widget.mixcloud.com, and a frame rule checks where the frame lands.
  const MIXCLOUD = ['https://www.mixcloud.com', 'https://player-widget.mixcloud.com'];
  for (const f of frameSrcs) for (const h of MIXCLOUD) assert.ok(f.split(/\s+/).includes(h), `${h} in ${f}`);
  const relay = read('src/pages/embed.astro');
  const meta = relay.match(/frame-src ([^;]+);/)[1];
  for (const h of MIXCLOUD) assert.ok(meta.split(/\s+/).includes(h), `the player page keeps its own copy in step: ${h}`);
  assert.match(relay, /shareEmbed\(u\)/, 'the extension\'s player page plays a mix, not only videos');
});

test('every share view asks the one shared question, and the share page adds the player under the picture', () => {
  for (const p of ['client-ui/src/elements/gbti-reader.mjs', 'client-ui/src/elements/gbti-shares-feed.mjs']) {
    const s = read(p);
    assert.match(s, /shareEmbed\((?:it|share)\.url\)/, p);
    assert.doesNotMatch(s, /embedUrl\(/, `${p} no longer decides on its own`);
    assert.match(s, /kind !== 'audio'/, `${p} keeps the picture for a mix`);
  }
  // The FRAME carries the 120 pixels (a border on it would leave 118, and Mixcloud then draws its 60 pixel bar).
  assert.match(read('client-ui/src/elements/gbti-reader.mjs'), /\.cover-audio iframe \{ display:block; width:100%; height:\$\{AUDIO_EMBED_HEIGHT\}px; border:0; \}/);
  assert.match(read('client-ui/src/elements/gbti-shares-feed.mjs'), /\.share-audio iframe \{ display:block; width:100%; height:\$\{AUDIO_EMBED_HEIGHT\}px; border:0; \}/);
  const page = read('src/pages/shares/[author]/[id].astro');
  assert.match(page, /<iframe src=\{audioSrc\}[^>]*height=\{AUDIO_EMBED_HEIGHT\}/);
  assert.match(page, /const audioSrc = !videoSrc && d\.url \? audioEmbedUrl\(d\.url\) : null;/);
  assert.match(page, /\{audioSrc && \(/);
});
