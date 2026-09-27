// sow-417 (owner, 2026-09-26): a share of a mix, a track, an album or a podcast says "Listen to it on <site>", not
// "Read article on <site>". The owner chose the wording and all four groups of sites. One decision in
// client/src/link-kind.mjs, used by the extension reader, the extension's Shares feed and the website share page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUDIO_HOSTS, isAudioLink, linkKind, shareLinkVerb } from '../client/src/link-kind.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('sow-417: every group the owner picked reads as audio', () => {
  for (const url of [
    // The owner's share.
    'https://www.mixcloud.com/baseline519/dms-age-of-enlightenment/?utm_source=gbti-network',
    // Music for artists.
    'https://soundcloud.com/forss/flickermood', 'https://m.soundcloud.com/forss/flickermood', 'https://on.soundcloud.com/abc',
    'https://bandcamp.com/discover', 'https://someartist.bandcamp.com/album/first', 'https://audiomack.com/artist/song/x',
    // Streaming catalogs.
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'https://open.spotify.com/episode/abc', 'https://spotify.link/abc',
    'https://music.apple.com/us/album/random-access-memories/617154241', 'https://listen.tidal.com/album/1', 'https://www.deezer.com/track/1',
    // YouTube Music.
    'https://music.youtube.com/watch?v=N_GfH09iP9c',
    // Podcasts.
    'https://podcasts.apple.com/us/podcast/the-changelog/id341623264', 'https://pocketcasts.com/podcast/x', 'https://pca.st/abc', 'https://overcast.fm/+abc',
  ]) {
    assert.equal(isAudioLink(url), true, url);
    assert.equal(linkKind(url), 'audio', url);
    assert.equal(shareLinkVerb(url), 'Listen to it', url);
  }
});

test('sow-417: video and everything else keep their words', () => {
  assert.equal(linkKind('https://www.youtube.com/watch?v=N_GfH09iP9c'), 'video', 'plain YouTube is still a video');
  assert.equal(shareLinkVerb('https://vimeo.com/123456789'), 'Watch video');
  for (const url of [
    'https://www.apple.com/iphone/', 'https://apple.com', 'https://www.youtube.com/@somechannel',
    'https://mixcloud.com.example.net/a/b/', 'https://notmixcloud.com/a/b/', 'https://example.com/soundcloud.com',
    'ftp://soundcloud.com/x', 'javascript:alert(1)', 'not a url', '', null, undefined,
  ]) {
    assert.equal(isAudioLink(url), false, String(url));
    assert.equal(shareLinkVerb(url), 'Read article', String(url));
  }
});

test('sow-417: the list holds bare hosts only, so the subdomain rule cannot be widened by a typo', () => {
  for (const h of AUDIO_HOSTS) assert.match(h, /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/, h);
  assert.equal(AUDIO_HOSTS.includes('apple.com'), false);
  assert.equal(AUDIO_HOSTS.includes('youtube.com'), false);
});

test('sow-417: the three surfaces take their verb from linkKind, not from embedUrl alone', () => {
  const reader = read('client-ui/src/elements/gbti-reader.mjs');
  const feed = read('client-ui/src/elements/gbti-shares-feed.mjs');
  const page = read('src/pages/shares/[author]/[id].astro');
  assert.match(reader, /\$\{shareLinkVerb\(it\.url\)\} on \$\{esc\(hostOf\(it\.url\)\)\}/);
  assert.match(feed, /\$\{shareLinkVerb\(share\.url\)\} on \$\{esc\(hostOf\(share\.url\)\)\}/);
  assert.match(page, /audio: 'Listen to it on'/);
  assert.match(page, /\{linkWords\} \{srcDomain \?\? 'the source'\}/);
  for (const src of [reader, feed, page]) assert.equal(/'Watch video' : 'Read article'|'Watch video on' : 'Read on'/.test(src), false);
});
