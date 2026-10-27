// sow-483 Phase 3 (owner, 2026-10-27): every paid member can upload a recording of up to about 20 MB for the podcast
// block, stored in the git repository beside the article. The file is staged once as raw bytes under the member's own
// key, the publish names it and the Worker commits it into the item's audio/ folder, and a prerendered route serves it
// for a published, public item at /media/audio/<author>/<dir>/<slug>/<file>, which every renderer resolves
// `./audio/<file>` to. These drive each piece with fakes: no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import {
  DRAFT_AUDIO_MAX_BYTES, DRAFT_AUDIO_MAX_COUNT, DRAFT_AUDIO_TTL_SECONDS, AUDIO_NAME_RE, draftAudioKey, audioNameOf, looksLikeAudio,
  checkDraftAudioQuota, validateDraftAudio, DraftAudioError,
} from '../membership/draft-audio.mjs';
import { stagedAudioName, AUDIO_MAX_BYTES } from '../client/src/audio-block-edit.mjs';
import { handleDraftAudio, eraseMemberDraftAudio, readStagedAudioBase64 } from '../workers/signup/membership-draft-audio.mjs';
import { checkAudioEntries, resolveAudioEntry, readMainBase64 } from '../workers/signup/hosted-audio.mjs';
import { commitHostedFiles } from '../workers/signup/hosted-commit.mjs';
import { validateHostedRequest, audioPathProblem, HOSTED_MAX_AUDIO_FILES } from '../membership/hosted-author.mjs';
import { planPublishAudio } from '../client/src/audio-publish.mjs';
import { AUDIO_SRC_RE, audioBaseFor, audioServedPath, audioUploadNames, renderDataBlock, dataBlockToMarkdown } from '../client/src/content-blocks.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema } from '../src/lib/markdown-sanitize.mjs';
import { stripSiteOnlyFences } from '../clients/syndication/devto-body.mjs';
import { contentAudioProblem, audioBlockSources } from '../scripts/lib/media-rules.mjs';
import { checkBuildSecrets } from '../scripts/check-build-secrets.mjs';

const F = '```';
const GID = '42';
const ITEM = 'post:crystal-ball';
const MP3 = (n = 64) => { const b = new Uint8Array(n); b.set([0x49, 0x44, 0x33, 0x04]); return b; }; // an ID3 tag
const OGG = (n = 64) => { const b = new Uint8Array(n); b.set([0x4f, 0x67, 0x67, 0x53]); return b; }; // OggS

/** A KV namespace with the calls the store makes, recording each put's options. */
function fakeKv() {
  const m = new Map();
  return {
    m,
    async put(key, value, opts = {}) { m.set(key, { value, opts }); },
    async get(key, type) {
      const e = m.get(key);
      if (!e) return null;
      if (type === 'arrayBuffer') return e.value instanceof ArrayBuffer ? e.value : new Uint8Array(e.value).buffer;
      return e.value;
    },
    async delete(key) { m.delete(key); },
    async list({ prefix }) {
      return { keys: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.opts.metadata })), list_complete: true };
    },
  };
}
const paid = async () => ({ ok: true, githubId: GID, via: 'cookie' });
const allow = async () => ({ allowed: true });
const req = (method, q, body, headers = {}) => new Request(`https://signup.gbti.network/membership/draft-audio?${q}`, { method, body, headers });
const q = (name = 'talk.mp3', item = ITEM) => `item=${encodeURIComponent(item)}&name=${encodeURIComponent(name)}`;

test('names: what a picked file is stored as, and what the Worker accepts', () => {
  for (const [picked, stored] of [['How_AI Agents (final).OPUS', 'how_ai-agents-final.ogg'], ['Episode 12.mp3', 'episode-12.mp3'], ['---.ogg', 'recording.ogg'], ['C:\\Users\\x\\talk.MP3', 'talk.mp3']]) {
    assert.equal(stagedAudioName(picked), stored, picked);
    assert.match(stored, AUDIO_NAME_RE, 'every stored name is one the Worker accepts');
  }
  assert.equal(stagedAudioName(`${'a'.repeat(200)}.mp3`).length, 64, 'at most 60 characters before the extension');
  for (const n of ['talk.wav', 'talk.m4a', 'noext']) assert.equal(stagedAudioName(n), null, n);
  for (const n of ['Talk.mp3', 'a/b.mp3', '../x.mp3', 'x.opus', '.mp3']) assert.equal(audioNameOf(n), null, n);
  assert.equal(DRAFT_AUDIO_MAX_BYTES, AUDIO_MAX_BYTES, 'the store and the form share one cap');
});

test('the bytes must look like the named kind of file', () => {
  assert.ok(looksLikeAudio(MP3(), 'a.mp3'));
  const frame = new Uint8Array([0xff, 0xfb, 0x90, 0x44]);
  assert.ok(looksLikeAudio(frame, 'a.mp3'), 'an MPEG frame header with no ID3 tag');
  assert.ok(looksLikeAudio(OGG(), 'a.ogg'));
  assert.ok(!looksLikeAudio(OGG(), 'a.mp3'));
  assert.ok(!looksLikeAudio(MP3(), 'a.ogg'), 'an MP3 renamed .ogg');
  assert.ok(!looksLikeAudio(new TextEncoder().encode('RIFF....WAVE'), 'a.mp3'), 'a renamed WAV');
  assert.throws(() => validateDraftAudio({ item: ITEM, name: 'a.mp3', bytes: new TextEncoder().encode('RIFF....WAVE').buffer }), /not an MP3 recording/);
  assert.throws(() => validateDraftAudio({ item: 'page:x', name: 'a.mp3', bytes: MP3().buffer }), DraftAudioError);
  assert.throws(() => validateDraftAudio({ item: ITEM, name: 'a.mp3', bytes: new ArrayBuffer(0) }), /empty/);
  assert.throws(() => validateDraftAudio({ item: ITEM, name: 'a.mp3', bytes: new ArrayBuffer(DRAFT_AUDIO_MAX_BYTES + 1) }), /over 20 MB/);
  assert.deepEqual(validateDraftAudio({ item: 'POST:Crystal-Ball', name: 'a.mp3', bytes: MP3().buffer }), { item: ITEM, name: 'a.mp3', bytes: 64 });
});

test('the quota: a count and a total, and replacing a staged file is not one more', () => {
  const six = Array.from({ length: DRAFT_AUDIO_MAX_COUNT }, (_, i) => ({ id: `${ITEM}:${i}.mp3`, bytes: 1 }));
  assert.throws(() => checkDraftAudioQuota(six, { id: `${ITEM}:new.mp3`, bytes: 1 }), /6 recordings waiting/);
  assert.doesNotThrow(() => checkDraftAudioQuota(six, { id: `${ITEM}:0.mp3`, bytes: 1 }));
  assert.throws(() => checkDraftAudioQuota([{ id: 'a', bytes: 70 * 1024 * 1024 }], { id: 'b', bytes: 15 * 1024 * 1024 }), /at their limit/);
});

test('the Worker store: PUT raw bytes under the caller\'s own key, read back, read the size alone, delete', async () => {
  const kv = fakeKv();
  const deps = { kv, authorize: paid, limiter: allow, now: () => 1000 };
  const put = await handleDraftAudio(req('PUT', q(), MP3(100)), {}, deps);
  assert.deepEqual([put.status, put.body], [200, { ok: true, name: 'talk.mp3', bytes: 100 }]);
  const key = draftAudioKey(GID, ITEM, 'talk.mp3');
  assert.equal(key, 'draftaudio:42:post:crystal-ball:talk.mp3');
  assert.deepEqual(kv.m.get(key).opts, { metadata: { bytes: 100, at: 1000 }, expirationTtl: DRAFT_AUDIO_TTL_SECONDS });
  const meta = await handleDraftAudio(req('GET', `${q()}&meta=1`), {}, deps);
  assert.deepEqual([meta.status, meta.body], [200, { ok: true, name: 'talk.mp3', bytes: 100 }]);
  const raw = await handleDraftAudio(req('GET', q()), {}, deps);
  assert.equal(raw.contentType, 'audio/mpeg');
  assert.deepEqual(new Uint8Array(raw.raw).slice(0, 3), new Uint8Array([0x49, 0x44, 0x33]));
  assert.equal(await readStagedAudioBase64(kv, GID, ITEM, 'talk.mp3'), Buffer.from(MP3(100)).toString('base64'));
  assert.equal(await readStagedAudioBase64(kv, '99', ITEM, 'talk.mp3'), null, 'another member cannot read it');
  const del = await handleDraftAudio(req('DELETE', q()), {}, deps);
  assert.equal(del.status, 200);
  assert.equal((await handleDraftAudio(req('GET', q()), {}, deps)).status, 404, 'a miss is the normal state after publish');
});

test('the Worker store refuses: not paid, a bad name, a WAV, too big before reading, over quota, too many uploads', async () => {
  const kv = fakeKv();
  const deps = { kv, authorize: paid, limiter: allow };
  const notPaid = await handleDraftAudio(req('PUT', q(), MP3()), {}, { ...deps, authorize: async () => ({ ok: false, status: 403, body: { error: 'forbidden' } }) });
  assert.equal(notPaid.status, 403);
  assert.equal((await handleDraftAudio(req('PUT', q('talk.wav'), MP3()), {}, deps)).status, 400);
  assert.equal((await handleDraftAudio(req('PUT', q('talk.mp3', 'page:x'), MP3()), {}, deps)).status, 400);
  const wav = await handleDraftAudio(req('PUT', q(), new TextEncoder().encode('RIFF....WAVEfmt ')), {}, deps);
  assert.deepEqual([wav.status, /not an MP3 recording/.test(wav.body.message)], [400, true]);
  const big = await handleDraftAudio(req('PUT', q(), MP3(), { 'Content-Length': String(DRAFT_AUDIO_MAX_BYTES + 1) }), {}, deps);
  assert.equal(big.status, 413);
  for (let i = 0; i < DRAFT_AUDIO_MAX_COUNT; i++) kv.m.set(draftAudioKey(GID, ITEM, `t${i}.mp3`), { value: MP3(), opts: { metadata: { bytes: 64 } } });
  const full = await handleDraftAudio(req('PUT', q(), MP3()), {}, deps);
  assert.deepEqual([full.status, /recordings waiting/.test(full.body.message)], [400, true]);
  const limited = await handleDraftAudio(req('PUT', q(), MP3()), {}, { ...deps, limiter: async () => ({ allowed: false }) });
  assert.equal(limited.status, 429);
  assert.equal((await handleDraftAudio(req('POST', q(), MP3()), {}, deps)).status, 405);
  const erased = await eraseMemberDraftAudio({}, GID, { kv });
  assert.deepEqual([erased.ok, erased.deleted, kv.m.size], [true, DRAFT_AUDIO_MAX_COUNT, 0], 'SOW-024 erasure takes every staged recording');
});

test('the publish wall: a recording by reference, in the item\'s own audio/ folder, and never as content', () => {
  const v = (files, extra = {}) => validateHostedRequest({ files, itemId: 'post-crystal-ball', folder: 'atwellpub', ...extra });
  const md = { path: 'members/atwellpub/posts/crystal-ball/index.md', content: 'x' };
  const staged = (name = 'talk.mp3', p = `members/atwellpub/posts/crystal-ball/audio/${name}`) => ({ path: p, stagedAudio: { item: ITEM, name } });
  assert.equal(v([md, staged()]).ok, true);
  assert.match(v([staged('talk.mp3', 'members/atwellpub/posts/crystal-ball/talk.mp3')]).error, /audio\/ folder beside its item/);
  assert.match(v([staged('talk.mp3', 'members/atwellpub/audio/talk.mp3')]).error, /audio\/ folder beside its item/);
  assert.match(v([staged('Talk.mp3', 'members/atwellpub/posts/crystal-ball/audio/Talk.mp3')]).error, /lowercase/);
  assert.match(v([staged('talk.mp3', 'members/someone/posts/x/audio/talk.mp3')]).error, /your own member folder/);
  assert.match(v([{ ...staged(), contentBase64: 'AAAA' }]).error, /carries a reference, not content/);
  assert.match(v([{ path: staged().path, stagedAudio: { item: ITEM, name: 'other.mp3' } }]).error, /does not name its staged copy/);
  assert.match(v([{ path: staged().path, stagedAudio: { item: 'page:x', name: 'talk.mp3' } }]).error, /does not name its staged copy/);
  assert.match(v(['a', 'b', 'c'].map((n) => staged(`${n}.mp3`))).error, new RegExp(`at most ${HOSTED_MAX_AUDIO_FILES} recordings`));
  // A copy for a moved item: from an audio/ folder the caller can write, same name, somewhere else.
  const copy = (from, to = 'members/atwellpub/posts/new-slug/audio/talk.mp3') => ({ path: to, copyFrom: from });
  assert.equal(v([copy('members/atwellpub/posts/crystal-ball/audio/talk.mp3')]).ok, true);
  assert.match(v([copy('members/someone/posts/x/audio/talk.mp3')]).error, /can only be copied from/);
  assert.equal(v([copy('members/someone/posts/x/audio/talk.mp3')], { allowAnyFolder: true }).ok, true, 'a superadmin may carry another member\'s item');
  assert.match(v([copy('members/atwellpub/posts/crystal-ball/audio/other.mp3')]).error, /can only be copied from/);
  assert.match(v([copy('members/atwellpub/posts/crystal-ball/images/talk.mp3')]).error, /can only be copied from/);
  assert.match(v([{ ...copy('members/atwellpub/posts/crystal-ball/audio/talk.mp3'), stagedAudio: { item: ITEM, name: 'talk.mp3' } }]).error, /either staged or copied/);
  assert.equal(audioPathProblem('prompts/p1/audio/a_b-c.ogg'), null);
});

test('the Worker checks every reference first, then reads each recording only as its own file is written', async () => {
  const kv = fakeKv();
  kv.m.set(draftAudioKey(GID, ITEM, 'talk.mp3'), { value: MP3(10), opts: { metadata: { bytes: 10 } } });
  const calls = [];
  const gh = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    if (/\/contents\/.*old\.mp3\?ref=main$/.test(url)) return new Response(JSON.stringify({ sha: 'abc', size: 20971520, encoding: 'none', content: '' }), { status: 200 });
    if (/\/git\/blobs\/abc$/.test(url)) return new Response(JSON.stringify({ encoding: 'base64', content: 'SUQz\nBAAA' }), { status: 200 });
    if (/\/git\/ref\/heads\/main$/.test(url)) return new Response(JSON.stringify({ object: { sha: 'm1' } }), { status: 200 });
    if (/\/git\/refs$/.test(url)) return new Response('{}', { status: 201 });
    if (/\/pulls$/.test(url)) return new Response(JSON.stringify({ number: 7, html_url: 'u' }), { status: 201 });
    if (init.method === 'PUT') return new Response('{}', { status: 201 });
    return new Response('{}', { status: 404 });
  };
  const deps = { kv, githubId: GID, fetchImpl: gh, instToken: 't', upstream: 'gbti-network/gbti.network' };
  const files = [
    { path: 'members/atwellpub/posts/crystal-ball/index.md', content: 'x' },
    { path: 'members/atwellpub/posts/crystal-ball/audio/talk.mp3', stagedAudio: { item: ITEM, name: 'talk.mp3' } },
    { path: 'members/atwellpub/posts/new/audio/old.mp3', copyFrom: 'members/atwellpub/posts/crystal-ball/audio/old.mp3' },
  ];
  assert.deepEqual(await checkAudioEntries({ files, ...deps }), { ok: true });
  assert.ok(!calls.some((c) => /blobs/.test(c)), 'the check reads no bytes');
  const missing = await checkAudioEntries({ files: [files[1]], ...deps, kv: fakeKv() });
  assert.deepEqual([missing.ok, missing.status, /talk\.mp3 is no longer staged/.test(missing.message)], [false, 409, true]);
  assert.equal((await checkAudioEntries({ files: [files[1]], ...deps, githubId: '99' })).ok, false, 'the key comes from the verified caller');
  const gone = await checkAudioEntries({ files: [{ ...files[2], copyFrom: 'members/atwellpub/posts/x/audio/none.mp3' }], ...deps });
  assert.match(gone.message, /could not be found where the item used to be/);
  assert.deepEqual(await resolveAudioEntry(files[0], deps), files[0], 'everything else passes through');
  assert.deepEqual(await resolveAudioEntry(files[1], deps), { path: files[1].path, contentBase64: Buffer.from(MP3(10)).toString('base64') });
  assert.deepEqual(await resolveAudioEntry(files[2], deps), { path: files[2].path, contentBase64: 'SUQzBAAA' }, 'the blob, whitespace removed');
  // The commit loop resolves each entry just before writing it: one recording in memory at a time.
  const order = [];
  const committed = await commitHostedFiles({ ...deps, branch: 'hosted/42/post-crystal-ball', files, title: 't', body: 'b',
    resolveFile: async (f) => { order.push(`resolve ${f.path.split('/').pop()}`); calls.push(`RESOLVE ${f.path}`); return resolveAudioEntry(f, deps); } });
  assert.equal(committed.ok, true);
  const puts = calls.filter((c) => c.startsWith('PUT'));
  assert.equal(puts.length, 3);
  assert.deepEqual(order, ['resolve index.md', 'resolve talk.mp3', 'resolve old.mp3']);
  const writes = calls.filter((c) => /^(RESOLVE|PUT) /.test(c)).map((c) => `${c.split(' ')[0]} ${c.split('/').pop()}`);
  assert.deepEqual(writes, ['RESOLVE index.md', 'PUT index.md', 'RESOLVE talk.mp3', 'PUT talk.mp3', 'RESOLVE old.mp3', 'PUT old.mp3'],
    'each recording is read just before its own write, never all up front');
  const failed = await commitHostedFiles({ ...deps, branch: 'b', files: [files[1]], title: 't', body: 'b', resolveFile: async () => null });
  assert.deepEqual([failed.ok, failed.error, failed.message], [false, 'git_failed', `could not read ${files[1].path}`]);
  const small = async () => new Response(JSON.stringify({ sha: 's', encoding: 'base64', content: 'T2dn\nUw==' }), { status: 200 });
  assert.equal(await readMainBase64({ fetchImpl: small, instToken: 't', upstream: 'x/y', path: 'a' }), 'T2dnUw==', 'under 1 MB the contents call carries it');
  assert.equal(await readMainBase64({ fetchImpl: async () => new Response('{}', { status: 404 }), instToken: 't', upstream: 'x/y', path: 'a' }), null);
});

test('the publish plan: staged, on main, moved, refused, and only the public part', async () => {
  const body = `Intro.\n\n${F}audio Hear it\nsrc: ./audio/talk.mp3\n${F}\n\n${F}audio Again\nsrc: ./audio/talk.mp3\n${F}`;
  const base = { body, visibility: 'public', builtPath: 'members/a/posts/b/index.md', itemTokens: ['post:b'] };
  const none = { stagedBytes: async () => null, onMain: async () => false };
  const staged = await planPublishAudio(base, { ...none, stagedBytes: async (n, it) => (it === 'post:b' ? 9 : null) });
  assert.deepEqual(staged, { files: [{ path: 'members/a/posts/b/audio/talk.mp3', stagedAudio: { item: 'post:b', name: 'talk.mp3' } }], cleanup: [{ name: 'talk.mp3', item: 'post:b' }] }, 'once, though named twice');
  const renamedDraft = await planPublishAudio({ ...base, itemTokens: ['post:b', 'post:old'] }, { ...none, stagedBytes: async (n, it) => (it === 'post:old' ? 9 : null) });
  assert.deepEqual(renamedDraft.files[0].stagedAudio, { item: 'post:old', name: 'talk.mp3' }, 'found under the earlier slug');
  assert.deepEqual(await planPublishAudio(base, { ...none, onMain: async (p) => p === 'members/a/posts/b/audio/talk.mp3' }), { files: [], cleanup: [] });
  const moved = await planPublishAudio({ ...base, moved: true, oldPath: 'members/a/posts/old/index.md' }, { ...none, onMain: async (p) => p.includes('/old/') });
  assert.deepEqual(moved.files, [
    { path: 'members/a/posts/b/audio/talk.mp3', copyFrom: 'members/a/posts/old/audio/talk.mp3' },
    { path: 'members/a/posts/old/audio/talk.mp3', content: null },
  ]);
  assert.match((await planPublishAudio(base, none)).refuse, /talk\.mp3 is no longer staged; choose it again/);
  const gated = `${F}audio Public\nsrc: ./audio/pub.mp3\n${F}\n\n<!-- members-only -->\n\n${F}audio Members\nsrc: ./audio/secret.mp3\n${F}`;
  const seen = [];
  await planPublishAudio({ ...base, body: gated }, { stagedBytes: async (n) => { seen.push(n); return 1; }, onMain: async () => false });
  assert.deepEqual(seen, ['pub.mp3'], 'a block below the members-only marker is never committed as plain bytes');
  assert.deepEqual(await planPublishAudio({ ...base, visibility: 'members' }, { ...none, stagedBytes: async () => 1 }), { files: [], cleanup: [] }, 'nor is any on a members item');
});

const site = async (md, filePath) => String(await unified().use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, sanitizeSchema).use(rehypeStringify)
  .process({ value: md, path: filePath }));

test('the renderers resolve ./audio/<file> to the item\'s own route, and the site admits only that', async () => {
  assert.match('./audio/talk.mp3', AUDIO_SRC_RE);
  assert.doesNotMatch('./audio/../x.mp3', AUDIO_SRC_RE);
  assert.doesNotMatch('./images/talk.mp3', AUDIO_SRC_RE);
  assert.equal(audioBaseFor('members/atwellpub/projects/gbti-ui/index.md'), '/media/audio/atwellpub/projects/gbti-ui');
  assert.equal(audioBaseFor('/abs/repo/members/a/prompts/p/index.md'), '/media/audio/a/prompts/p');
  for (const p of ['house/posts/x/index.md', 'members/a/posts/x.md', 'members/a/shares/x.md', null]) assert.equal(audioBaseFor(p), null, String(p));
  assert.equal(audioServedPath('/media/podcasts/x.mp3', null), '/media/podcasts/x.mp3');
  const md = `${F}audio Hear it\nlength: 3 minutes\nsrc: ./audio/talk.ogg\nsrc: ./audio/talk.mp3\n${F}`;
  const html = await site(md, 'members/atwellpub/posts/crystal-ball/index.md');
  assert.match(html, /<source src="\/media\/audio\/atwellpub\/posts\/crystal-ball\/talk\.ogg" type="audio\/ogg; codecs=opus"><source src="\/media\/audio\/atwellpub\/posts\/crystal-ball\/talk\.mp3" type="audio\/mpeg">/);
  assert.equal(renderMarkdown(md, { itemPath: 'members/atwellpub/posts/crystal-ball/index.md' }), html.replace(/src="\/media\//g, 'src="https://gbti.network/media/'), 'the reader and the site agree');
  const bare = renderDataBlock('audio', 'src: ./audio/talk.mp3\nlink: https://soundcloud.com/a/b', 'Hear it');
  assert.doesNotMatch(bare, /<audio/, 'with no item there is nothing to play');
  assert.match(bare, /Listen on SoundCloud/, 'the label and the link out still show');
  assert.match(renderMarkdown(md, { relativeAudio: true }), /<source src="\.\/audio\/talk\.ogg"/, 'the WorkBench preview resolves it itself');
  for (const evil of ['<audio controls><source src="./audio/talk.mp3" type="audio/mpeg"></audio>',
    '<audio controls><source src="/media/audio/a/posts/b/../../x.mp3" type="audio/mpeg"></audio>',
    '<audio controls><source src="https://evil.example/media/audio/a/posts/b/x.mp3" type="audio/mpeg"></audio>']) {
    assert.doesNotMatch(await site(evil, 'members/a/posts/b/index.md'), /<source src=/, evil);
  }
  assert.deepEqual(audioUploadNames(`${md}\n\n${F}audio Two\nsrc: /media/podcasts/x.mp3\nsrc: ./audio/talk.mp3\n${F}`), ['talk.ogg', 'talk.mp3']);
});

test('a cross-post links the served recording; the media check knows the new place', () => {
  const md = `${F}audio Hear it\nlength: 3 minutes\nsrc: ./audio/talk.mp3\n${F}\n`;
  assert.equal(stripSiteOnlyFences(md, { source: 'post', author: 'atwellpub', targetSlug: 'crystal-ball' }).trim(),
    '[Hear it](https://gbti.network/media/audio/atwellpub/posts/crystal-ball/talk.mp3) (3 minutes)');
  assert.equal(dataBlockToMarkdown('audio', 'src: ./audio/talk.mp3\nlink: https://open.spotify.com/show/A1b2C3d4E5f6G7h8I9j0K1', 'Hear it'),
    '[Hear it](https://open.spotify.com/show/A1b2C3d4E5f6G7h8I9j0K1)', 'with no item, the link out stands in');
  assert.equal(contentAudioProblem({ rel: 'members/a/posts/b/audio/talk.mp3', bytes: 1000 }), null);
  assert.equal(contentAudioProblem({ rel: 'members/a/prompts/p/audio/t_1.ogg', bytes: 1000 }), null);
  for (const rel of ['members/a/posts/b/talk.mp3', 'members/a/audio/talk.mp3', 'house/posts/b/audio/talk.mp3', 'members/a/posts/b/audio/talk.wav', 'members/a/posts/b/audio/Talk.mp3', 'members/a/posts/b/c/audio/talk.mp3', 'members/a/shares/b/audio/talk.mp3']) {
    assert.match(contentAudioProblem({ rel, bytes: 1 }), /goes in the audio\/ folder beside its item/, rel);
  }
  assert.match(contentAudioProblem({ rel: 'members/a/posts/b/audio/talk.mp3', bytes: 21 * 1024 * 1024 }), /over 20 MB/);
  assert.deepEqual(audioBlockSources(md), ['./audio/talk.mp3']);
});

test('the build guard: only a published, public item\'s recording may reach dist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-audio-'));
  fs.mkdirSync(path.join(root, 'house/_enc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<html>ok</html>');
  const item = (slug, fm) => { const d = path.join(root, 'members/a/posts', slug); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'index.md'), `---\n${fm}\n---\nbody`); };
  const served = (rel) => { const f = path.join(root, 'dist/media/audio', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); };
  item('pub', 'title: P\nstatus: published\nvisibility: public');
  item('dflt', 'title: D\nstatus: published');
  served('a/posts/pub/talk.mp3');
  served('a/posts/dflt/talk.ogg');
  assert.deepEqual(checkBuildSecrets({ root, env: {} }).errors, []);
  item('draft', 'title: X\nstatus: draft\nvisibility: public');
  item('members', 'title: M\nstatus: published\nvisibility: members');
  served('a/posts/draft/talk.mp3');
  served('a/posts/members/talk.mp3');
  served('a/posts/ghost/talk.mp3');
  served('a/posts/pub/notes.txt');
  const errors = checkBuildSecrets({ root, env: {} }).errors.filter((e) => /sow-483/.test(e));
  assert.equal(errors.length, 4, errors.join('\n'));
  for (const rel of ['draft/talk.mp3', 'members/talk.mp3', 'ghost/talk.mp3', 'pub/notes.txt']) assert.ok(errors.some((e) => e.includes(rel)), rel);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the wiring: the served route, the site policy, the WorkBench preview and the website client', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const route = read('src/pages/media/audio/[...path].ts');
  assert.match(route, /\]\.filter\(isPublic\);/, 'only published, public items');
  assert.match(route, /if \(!NAME_RE\.test\(file\) \|\| !named\.has\(file\)\) continue;/, 'only recordings the public body names');
  assert.match(route, /export const prerender = true;/);
  const csp = read('public/_headers').split('\n')[28];
  assert.match(csp, /media-src 'self' blob: https:\/\/raw\.githubusercontent\.com;/, 'the preview plays a staged copy (blob:) or the repository copy');
  const preview = read('src/lib/preview-page.ts');
  assert.match(preview, /stagedSrc\[`\.\/audio\/\$\{name\}`\] = URL\.createObjectURL\(await r\.blob\(\)\);/);
  assert.equal([...preview.matchAll(/\{ relativeAudio: true \}/g)].length, 3, 'every preview render leaves ./audio/ for asset() to resolve');
  const publish = read('src/lib/workbench-client-publish.ts');
  assert.match(publish, /\{ body, visibility: effInput\.visibility, builtPath: built\.path, oldPath: origin\?\.oldPath, moved, itemTokens \}/);
  assert.match(publish, /for \(const c of audioPlan\.cleanup\) await deleteStagedAudio\(c\.name, c\.item\);/);
  const worker = read('workers/signup/membership-author.mjs');
  assert.match(worker, /const audio = await checkAudioEntries\(\{ files: payload\.files, \.\.\.audioDeps \}\);\s*if \(!audio\.ok\) return/);
  assert.match(worker, /commitHostedFiles\(\{ fetchImpl, instToken, upstream, branch, files: payload\.files, title, body, resolveFile: \(f\) => resolveAudioEntry\(f, audioDeps\) \}\)/);
  assert.match(read('workers/signup/member-routes.mjs'), /corsHeaders\(request, env, \{ credentials: true, methods: 'GET, PUT, DELETE, OPTIONS' \}\)/);
  assert.match(read('src/lib/workbench-client-audio.ts'), /if \(csrf\) xhr\.setRequestHeader\('X-GBTI-CSRF', csrf\);/, 'a cookie PUT clears the CSRF gate');
  // Owner, 2026-10-27: every PAID member can upload. The tests above inject the authorizer, so the default is pinned here.
  assert.match(read('workers/signup/membership-draft-audio.mjs'), /export async function handleDraftAudio\(request, env, \{ kv = env\?\.SIGNUP_KV, now, authorize = authorizePaid, /);
});
