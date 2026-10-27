// sow-483 Phase 2 (owner, 2026-10-27, "A, one form"): the WorkBench edits the ```audio block through a form that
// rewrites one line of the fence at a time. These pin the line editing (a block nobody touched saves byte for byte),
// the source switch that loses nothing, the provider and file messages, and what the form draws in each state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AUDIO_SOURCES, AUDIO_MAX_BYTES, audioLabelOf, setAudioLabel, audioLineValue, setAudioLine, audioSourceOf, setAudioSource,
  audioLinkNote, formatBytes, audioFileProblem,
} from '../client/src/audio-block-edit.mjs';
import { audioBlockHtml, audioSourceKind, switchAudioSource, setAudioProviderLink } from '../client-ui/src/audio-block-ui.mjs';
import { parseBlocks, serializeBlocks, emptyBlock } from '../client-ui/src/markdown-blocks.mjs';
import { blockNoun } from '../client-ui/src/publish-diff.mjs';
import { PODCAST_MAX_BYTES } from '../scripts/lib/media-rules.mjs';

const F = '```';
const MP3 = '/media/podcasts/how-ai-agents-replace-web-dashboards.mp3';
const SC = 'https://soundcloud.com/gbti-network/how-ai-agents-replace-web-dashboards';
const SP = 'https://open.spotify.com/episode/A1b2C3d4E5f6G7h8I9j0K1';

test('the block model: ```audio is its own block, written back exactly as it was read', () => {
  const docs = [
    `Intro.\n\n${F}audio Listen to the podcast version\nstyle: card\nlength: 22 minutes\nsrc: ${MP3}\n${F}\n\nThe rest.`,
    `${F}audio\nsoundcloud: ${SC}\nlink: ${SC}\nLink-Label:   Hear it there\nan odd line the form does not know\n${F}`,
    `${F}audio   Two  spaces kept\n\nlength: 1 minute\n${F}`,
  ];
  for (const doc of docs) {
    const blocks = parseBlocks(doc);
    assert.ok(blocks.some((b) => b.type === 'audio'), doc);
    assert.equal(serializeBlocks(blocks), doc);
  }
  assert.deepEqual(parseBlocks(`${F}audio Hear it\nsrc: ${MP3}\n${F}`)[0], { type: 'audio', lang: 'audio Hear it', code: `src: ${MP3}` });
  assert.equal(parseBlocks(`${F}audiobook\nx\n${F}`)[0].type, 'code', 'only the word audio makes the block');
  assert.equal(serializeBlocks([emptyBlock('audio')]), `${F}audio\n\n${F}`);
  assert.equal(serializeBlocks(parseBlocks(serializeBlocks([emptyBlock('audio')]))), `${F}audio\n\n${F}`, 'a new block is stable');
  assert.equal(blockNoun('audio'), 'Podcast player');
});

test('setAudioLine: rewrites in place, keeps an unchanged line as written, removes, and adds in order', () => {
  const body = `Length:  22 minutes\nsrc: ${MP3}\nan odd line`;
  assert.equal(setAudioLine(body, 'length', '22 minutes'), body, 'the same value leaves the line alone');
  assert.equal(setAudioLine(body, 'length', '23 minutes'), `length: 23 minutes\nsrc: ${MP3}\nan odd line`);
  assert.equal(setAudioLine(body, 'length', ''), `src: ${MP3}\nan odd line`);
  assert.equal(setAudioLine(body, 'link', SC), `Length:  22 minutes\nsrc: ${MP3}\nan odd line\nlink: ${SC}`);
  assert.equal(setAudioLine(`src: ${MP3}`, 'length', '5 minutes'), `length: 5 minutes\nsrc: ${MP3}`, 'length goes before the source');
  assert.equal(setAudioLine(`src: ${MP3}\nlink: ${SC}`, 'link-label', 'Hear it'), `src: ${MP3}\nlink: ${SC}\nlink-label: Hear it`);
  assert.equal(setAudioLine('length: 1\nlength: 2', 'length', '3'), 'length: 3', 'never two of one key');
  assert.equal(setAudioLine('', 'length', 'a\nb'), 'length: a b', 'a value is always one line');
  assert.equal(audioLineValue(body, 'LENGTH'), '22 minutes');
  assert.equal(audioLineValue(body, 'link'), '');
});

test('the label lives in the info string', () => {
  assert.equal(audioLabelOf('audio Listen to the podcast version'), 'Listen to the podcast version');
  assert.equal(audioLabelOf('audio'), '');
  assert.equal(setAudioLabel('audio Old', 'New words'), 'audio New words');
  assert.equal(setAudioLabel('audio Old', '  '), 'audio');
  assert.equal(setAudioLabel('audio   Two  spaces kept', 'Two  spaces kept'), 'audio   Two  spaces kept', 'unchanged text is left alone');
});

test('one source at a time, set where it stands', () => {
  assert.deepEqual(audioSourceOf(`length: 1\nsrc: ${MP3}`), { kind: 'upload', value: MP3 });
  assert.deepEqual(audioSourceOf(`spotify: ${SP}`), { kind: 'spotify', value: SP });
  assert.equal(audioSourceOf('length: 1'), null);
  assert.equal(setAudioSource(`length: 1\nsrc: ${MP3}\nlink: ${SC}`, 'soundcloud', SC), `length: 1\nsoundcloud: ${SC}\nlink: ${SC}`);
  assert.equal(setAudioSource(`src: a\nsrc: b\nspotify: ${SP}`, 'spotify', SP), `spotify: ${SP}`, 'every other source line goes');
  assert.deepEqual(AUDIO_SOURCES, ['upload', 'soundcloud', 'spotify', 'apple']);
});

test('switching source keeps what each one held, and a link out the form filled in follows its source', () => {
  const b = { _id: 1, type: 'audio', lang: 'audio Listen', code: `style: card\nlength: 22 minutes\nsrc: ${MP3}` };
  assert.equal(audioSourceKind(b), 'upload');
  assert.ok(switchAudioSource(b, 'soundcloud'));
  assert.equal(b.code, 'length: 22 minutes', 'the file and its card style step aside');
  assert.equal(audioSourceKind(b), 'soundcloud', 'the empty source is still the chosen one');
  const r = setAudioProviderLink(b, 'soundcloud', SC);
  assert.equal(r.linkChanged, true);
  assert.equal(b.code, `length: 22 minutes\nsoundcloud: ${SC}\nlink: ${SC}`, 'the link out is filled in from the provider link');
  assert.ok(switchAudioSource(b, 'upload'));
  assert.equal(b.code, `style: card\nlength: 22 minutes\nsrc: ${MP3}`, 'the file, its style and no SoundCloud link');
  assert.ok(switchAudioSource(b, 'soundcloud'));
  assert.equal(b.code, `length: 22 minutes\nsoundcloud: ${SC}\nlink: ${SC}`, 'coming back restores both');
  assert.equal(switchAudioSource(b, 'soundcloud'), false);
  // A link out the author typed stays put through a switch and is never replaced by a provider link.
  const c = { _id: 2, type: 'audio', lang: 'audio', code: `src: ${MP3}\nlink: https://example.com/show` };
  switchAudioSource(c, 'spotify');
  setAudioProviderLink(c, 'spotify', SP);
  assert.equal(c.code, `spotify: ${SP}\nlink: https://example.com/show`);
});

test('the line under a provider link names what it is', () => {
  assert.deepEqual(audioLinkNote('soundcloud', SC), { ok: true, text: "A SoundCloud track. It plays in SoundCloud's own player.", page: SC });
  assert.equal(audioLinkNote('spotify', SP).text, "A Spotify episode. It plays in Spotify's own player.");
  assert.equal(audioLinkNote('apple', 'https://podcasts.apple.com/us/podcast/gbti-talks/id1700000001').text, 'An Apple Podcasts show. It plays in the Apple Podcasts player.');
  assert.deepEqual(audioLinkNote('soundcloud', 'https://www.youtube.com/watch?v=abc'),
    { ok: false, text: 'This is a YouTube link. Paste a SoundCloud track or playlist link, or add the video with a Video block.' });
  assert.equal(audioLinkNote('soundcloud', '  '), null);
});

test('a picked file: MP3, Ogg or Opus up to 20 MB, and a message that says what to do otherwise', () => {
  assert.equal(AUDIO_MAX_BYTES, PODCAST_MAX_BYTES, 'the editor and the media check share one cap');
  for (const name of ['a.mp3', 'b.OGG', 'c.opus']) assert.equal(audioFileProblem({ name, size: 8e6 }), null, name);
  assert.deepEqual(audioFileProblem({ name: 'how-ai-agents-replace-web-dashboards.wav', size: 231 * 1024 * 1024 }), {
    title: 'This file is 231 MB. The limit is 20 MB.', name: 'how-ai-agents-replace-web-dashboards.wav',
    rest: ' is a WAV recording. Export it as MP3, then choose it again.' });
  assert.deepEqual(audioFileProblem({ name: 'talk.m4a', size: 5e6 }),
    { title: 'The player takes MP3 or Ogg files.', name: 'talk.m4a', rest: ' is an M4A recording. Export it as MP3, then choose it again.' });
  assert.match(audioFileProblem({ name: 'long.mp3', size: AUDIO_MAX_BYTES + 1 }).rest, /lower bitrate, such as 64 kbps for speech/);
  assert.equal(audioFileProblem({ name: 'edge.mp3', size: AUDIO_MAX_BYTES }), null, 'the limit itself is allowed');
  assert.match(audioFileProblem({ name: 'notes.txt', size: 10 }).rest, /^ is a kind of file the player cannot play\./);
  assert.deepEqual([formatBytes(7.9 * 1024 * 1024), formatBytes(231 * 1024 * 1024), formatBytes(512 * 1024), formatBytes(20 * 1024 * 1024)], ['7.9 MB', '231 MB', '512 KB', '20 MB']);
});

test('the form in each state from the canvas', () => {
  const html = (code, extra = {}) => audioBlockHtml({ _id: 7, type: 'audio', lang: 'audio Listen to the podcast version', code, ...extra });
  const empty = audioBlockHtml({ _id: 7, ...emptyBlock('audio') });
  assert.match(empty, /placeholder="Label, such as Listen to the podcast version"/);
  assert.match(empty, /placeholder="Length, such as 22 minutes"/);
  assert.match(empty, /data-ab-src="upload" data-id="7" aria-pressed="true">Upload</);
  assert.match(empty, /Drop an MP3 or Ogg file here, or click to choose one/);
  assert.match(empty, /Up to 20 MB, roughly an hour of speech as MP3\./);
  assert.match(empty, /Add a link out/);
  assert.doesNotMatch(empty, /Player style/, 'the style waits for a file');

  const file = html(`style: card\nlength: 22 minutes\nsrc: ${MP3}`);
  assert.match(file, /class="ab-mono ab-file-n">how-ai-agents-replace-web-dashboards\.mp3</);
  assert.match(file, />MP3 · published on gbti\.network</);
  assert.match(file, /data-ab-pick="7">Replace<\/button><button type="button" class="ab-btn" data-ab-remove="7">Remove/);
  assert.match(file, /data-ab-style="card" data-id="7" aria-pressed="true">Card/);

  const sc = html(`soundcloud: ${SC}\nlink: ${SC}`);
  assert.match(sc, /aria-pressed="true">SoundCloud</);
  assert.match(sc, /class="ab-in ab-ok" data-ab="source" data-kind="soundcloud"/);
  assert.match(sc, /A SoundCloud track\. It plays in SoundCloud&#39;s own player\./);
  assert.match(sc, /aria-label="Link out words" placeholder="Listen on SoundCloud"/);
  assert.doesNotMatch(sc, /Player style/, 'a provider has its own player');

  const bad = html('soundcloud: https://www.youtube.com/watch?v=abc');
  assert.match(bad, /class="ab-in ab-bad"[^>]*aria-invalid="true"/);
  assert.match(bad, /This is a YouTube link\./);

  const big = html('', { _file: { problem: audioFileProblem({ name: 'x.wav', size: 231 * 1024 * 1024 }) } });
  assert.match(big, /role="alert"[\s\S]*This file is 231 MB\. The limit is 20 MB\.[\s\S]*<span class="ab-mono">x\.wav<\/span> is a WAV recording/);
  assert.match(big, /Choose another file/);

  assert.match(html('', { _file: { waiting: { name: 'talk.mp3' } } }), /Uploads arrive in the next update\. Choose <span class="ab-mono">talk\.mp3<\/span> again once it lands\./);
  assert.match(html('link: javascript:alert(1)'), /Paste a full web address, starting with https:\/\/\./);
  assert.doesNotMatch(html('', { lang: 'audio <img src=x onerror=alert(1)>' }), /<img/, 'the label is escaped');
  assert.doesNotMatch(html('', { _file: { problem: audioFileProblem({ name: '<img src=x onerror=alert(1)>.wav', size: 1 }) } }), /<img/, 'a file name is escaped');
  assert.doesNotMatch(html('', { _file: { waiting: { name: '<b>x</b>.mp3' } } }), /<b>/, 'so is a waiting one');
});

test('the doc editor draws the form for an audio block and offers it in Turn into', () => {
  const src = fs.readFileSync(new URL('../client-ui/src/elements/gbti-doc-editor.mjs', import.meta.url), 'utf8');
  assert.match(src, /case 'audio': return audioBlockHtml\(b\);/);
  assert.match(src, /wireAudioBlocks\(this\.root, \{/);
  assert.match(src, /\{ key: 'audio', label: 'Podcast player', icon: 'audio'/);
  assert.doesNotMatch(src, /data-astyle/, 'the old style bar over a code box is gone');
  // In a narrow editor a mouse press focused the block, its toolbar appeared above the form and the press missed
  // (measured 2026-10-27 at 390 px). The form's buttons keep focus where it is on a mouse press.
  const ui = fs.readFileSync(new URL('../client-ui/src/audio-block-ui.mjs', import.meta.url), 'utf8');
  assert.match(ui, /for \(const btn of all\('\.ab button'\)\) btn\.addEventListener\('mousedown', \(e\) => e\.preventDefault\(\)\);/);
  const css = fs.readFileSync(new URL('../client-ui/src/doc-editor-css.mjs', import.meta.url), 'utf8');
  assert.match(css, /\$\{AUDIO_BLOCK_CSS\}/);
});
