// sow-494: the Community rules every surface shares (Worker, website, MCP): entry, answer and post validation, typed
// answer matching, ids, reactions, and image checks by magic bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEntryInput, validateAnswer, validatePostInput, normalizeTyped, sniffImage, validateImageUpload,
  newId, isId, REACTIONS, REACTION_NAMES, isReaction, LIMITS, bytesFromBase64, imageNameOf, typedMax,
} from '../membership/community-shared.mjs';
import { PNG, JPG, toB64 } from './lib/community-sqlite.mjs';

test('entries: each kind keeps only its own fields, and problems read as sentences', () => {
  const poll = validateEntryInput({ kind: 'poll', title: '  Which   topic? ', options: ['A', ' B ', ''], settings: { publishOnClose: true, hint: 'x' } });
  assert.equal(poll.ok, true);
  assert.deepEqual(poll.value.options, ['A', 'B']);
  assert.equal(poll.value.title, 'Which topic?');
  assert.deepEqual(poll.value.settings, { changeable: true, publishOnClose: true });
  const typed = validateEntryInput({ kind: 'typed', title: 'Movie?', settings: { hint: 'A movie title', answerLength: 'long' } });
  assert.deepEqual(typed.value.settings, { changeable: true, hint: 'A movie title', answerLength: 'long', countMatching: true, publishOnClose: false });
  assert.deepEqual(typed.value.options, []);
  const topic = validateEntryInput({ kind: 'topic', title: 'Desks', prompt: 'Post a photo.\r\nThanks', settings: { imagesAllowed: false } });
  assert.deepEqual(topic.value.settings, { imagesAllowed: false });
  assert.equal(topic.value.prompt, 'Post a photo.\nThanks');
  assert.deepEqual(topic.value.access, { mode: 'all', members: [] });
  const bad = [
    [{ kind: 'quiz', title: 'x' }, /kind/],
    [{ kind: 'poll', title: '' }, /question/],
    [{ kind: 'topic', title: '' }, /title/],
    [{ kind: 'poll', title: 'x', options: ['only one'] }, /at least 2/],
    [{ kind: 'poll', title: 'x', options: Array.from({ length: 9 }, (_, i) => `o${i}`) }, /up to 8/],
    [{ kind: 'poll', title: 'x', options: ['Same', 'same'] }, /same/],
    [{ kind: 'poll', title: 'x'.repeat(201), options: ['a', 'b'] }, /200/],
    [{ kind: 'topic', title: 'x', prompt: 'p'.repeat(8001) }, /too long/],
    [{ kind: 'topic', title: 'x', meeting: { label: 'Shop Talk', date: '7 Nov' } }, /YYYY-MM-DD/],
    [{ kind: 'topic', title: 'x', access: { mode: 'some' } }, /access/],
    [{ kind: 'topic', title: 'x', access: { mode: 'chosen', members: ['priya'] } }, /GitHub id/],
  ];
  for (const [input, re] of bad) {
    const r = validateEntryInput(input);
    assert.equal(r.ok, false, JSON.stringify(input).slice(0, 60));
    assert.match(r.problem, re);
    assert.doesNotMatch(r.problem, /[—–]|n't|'re|'s /, 'no dashes or contractions in shipped copy');
  }
  const chosen = validateEntryInput({ kind: 'topic', title: 'x', access: { mode: 'chosen', members: ['1', 1, '1', '22'] } });
  assert.deepEqual(chosen.value.access, { mode: 'chosen', members: ['1', '22'] });
});

test('answers: a poll takes a valid choice index, a typed poll takes text within its length', () => {
  const poll = { kind: 'poll', options: ['a', 'b'] };
  assert.deepEqual(validateAnswer(poll, { choice: 1 }).value, { value: '1', norm: '1' });
  for (const choice of [-1, 2, 1.5, '1', null]) assert.equal(validateAnswer(poll, { choice }).ok, false);
  const typed = { kind: 'typed', settings: {} };
  assert.deepEqual(validateAnswer(typed, { text: '  Project  Hail Mary! ' }).value, { value: 'Project Hail Mary!', norm: 'project hail mary' });
  assert.equal(validateAnswer(typed, { text: 'x'.repeat(81) }).ok, false);
  assert.equal(typedMax({ settings: { answerLength: 'long' } }), 280);
  assert.equal(validateAnswer({ kind: 'topic' }, { text: 'x' }).ok, false);
});

test('typed answers match regardless of case, spacing, quotes and trailing punctuation', () => {
  for (const s of ['Project Hail Mary', 'project hail mary', '  PROJECT   hail mary!! ', '"Project Hail Mary"', 'Project Hail Mary.']) {
    assert.equal(normalizeTyped(s), 'project hail mary', s);
  }
  assert.notEqual(normalizeTyped('Hail Mary'), normalizeTyped('Project Hail Mary'), 'spelling still differs; the host merges it');
});

test('posts: text or images, within the caps, replies by a valid id', () => {
  assert.equal(validatePostInput({ body: '' }).ok, false);
  assert.equal(validatePostInput({ body: 'x'.repeat(8001) }).ok, false);
  const id = newId();
  assert.deepEqual(validatePostInput({ body: '', images: [id, id] }).value, { body: '', images: [id], parentId: null });
  assert.equal(validatePostInput({ body: 'x', images: Array.from({ length: 7 }, () => newId()) }).ok, false);
  assert.equal(validatePostInput({ body: 'x', images: ['../etc'] }).ok, false);
  assert.equal(validatePostInput({ body: 'x', parentId: 'nope' }).ok, false);
});

test('ids are 16 characters of a look-alike-free alphabet, and reactions are the standard eight', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.ok(isId(id), id);
  assert.equal(isId('ABCDEFGHJKMNPQRS'), false);
  assert.equal(isId('abcdefghjkmnpqr0'), false, 'no zero');
  assert.equal(REACTIONS.length, 8);
  assert.deepEqual(REACTION_NAMES, ['+1', '-1', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes']);
  assert.equal(isReaction('heart'), true);
  assert.equal(isReaction('❤️'), false, 'stored by name, never as free text');
});

test('images are judged by their bytes: PNG, JPG, GIF and WebP pass; SVG and renamed files do not', () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPG), 'image/jpeg');
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a......')), 'image/gif');
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\u0001\u0000\u0000\u0000WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  const ok = validateImageUpload({ name: 'C:\\photos\\My Desk.png', dataBase64: toB64(PNG) });
  assert.deepEqual([ok.ok, ok.value.contentType, ok.value.name], [true, 'image/png', 'My Desk.png']);
  assert.equal(validateImageUpload({ name: 'evil.png', dataBase64: toB64(new TextEncoder().encode('<svg onload=alert(1)></svg>')) }).ok, false);
  const big = new Uint8Array(LIMITS.imageBytes + 10);
  big.set(PNG);
  const tooBig = validateImageUpload({ name: 'desk-full.jpg', dataBase64: toB64(big) });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.problem, /1 MB/);
  assert.equal(validateImageUpload({ dataBase64: '' }).ok, false);
  assert.equal(validateImageUpload({ dataBase64: '###' }).ok, false);
  assert.deepEqual([...bytesFromBase64(`data:image/png;base64,${toB64(PNG)}`)], [...PNG], 'a data URL header is accepted');
  assert.equal(imageNameOf(''), 'image');
});
