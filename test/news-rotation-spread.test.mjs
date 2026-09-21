// sow-384: the collection rotation deals sources out like cards, so sources on one topic arrive in different runs.
//
// The source list is grouped by topic (sources were added a topic at a time), and the rotation walked it in order,
// sixteen per hourly run. The six crypto outlets sit side by side, so they always arrived in one run; on 2026-09-21
// that run was the newest thing in the store when the weekly digest compiled, and the digest carried five crypto
// stories. These tests walk EVERY cursor position over the rotation, because a spread that holds from position zero
// and fails from position nine would look fine on any single sample.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { rotationOrder, dealIntoRuns } from '../workers/signup/news/src/sources.mjs';

const RUN = 16; // SOURCE_CHUNK in workers/signup/wrangler.toml

/** The smallest list distance between two different sources that ever share a run, over every cursor position. */
function closestInOneRun(rotation, runSize, indexOf) {
  let min = Infinity;
  for (let start = 0; start < rotation.length; start += 1) {
    const run = Array.from({ length: runSize }, (_, k) => indexOf(rotation[(start + k) % rotation.length]));
    for (let a = 0; a < run.length; a += 1) for (let b = a + 1; b < run.length; b += 1) {
      if (run[a] !== run[b]) min = Math.min(min, Math.abs(run[a] - run[b]));
    }
  }
  return min;
}

const synthetic = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, i }));

test('control: walked in list order, neighbouring sources share a run', () => {
  const list = synthetic(126);
  assert.equal(closestInOneRun(rotationOrder(list), RUN, (s) => s.i), 1);
});

test('sow-384: dealt, no two sources fewer than seven places apart ever share a run (126 sources, runs of 16)', () => {
  const list = synthetic(126);
  assert.ok(closestInOneRun(rotationOrder(list, { spread: RUN }), RUN, (s) => s.i) >= 7);
});

test('sow-384: the REAL source list: the crypto outlets never share a run, from any cursor position', () => {
  const doc = yaml.load(readFileSync(new URL('../house/news-sources.yml', import.meta.url), 'utf8'));
  const pool = (doc.sources || []).filter((s) => s.enabled !== false);
  const crypto = ['coindesk-bitcoin-ethereum-crypto-news-an', 'cointelegraph-com-news', 'decrypt', 'the-block', 'ethereum-foundation-blog', 'bitcoin-magazine'];
  const present = crypto.filter((id) => pool.some((s) => s.id === id));
  assert.ok(present.length >= 4, 'the fixture still has the outlets this is about');
  const rot = rotationOrder(pool, { spread: RUN });
  for (let start = 0; start < rot.length; start += 1) {
    const run = Array.from({ length: RUN }, (_, k) => rot[(start + k) % rot.length].id).filter((id) => present.includes(id));
    assert.ok(new Set(run).size === run.length && run.length <= 1, `run from ${start} holds ${run.join(', ')}`);
  }
  // And the control on the same list: in list order some run held several of them, which is the incident.
  const plain = rotationOrder(pool);
  let worst = 0;
  for (let start = 0; start < plain.length; start += 1) {
    worst = Math.max(worst, Array.from({ length: RUN }, (_, k) => plain[(start + k) % plain.length].id).filter((id) => present.includes(id)).length);
  }
  assert.ok(worst >= 4, `list order put ${worst} crypto outlets in one run`);
});

test('sow-384: dealing is a permutation of each pass, so every source keeps exactly its appearances', () => {
  const pool = synthetic(126).map((s, i) => ({ ...s, weight: [0, 0, 1, -1, 2, -2, 0][i % 7] }));
  const count = (rot) => rot.reduce((m, s) => m.set(s.id, (m.get(s.id) || 0) + 1), new Map());
  const dealt = rotationOrder(pool, { spread: RUN });
  const plain = rotationOrder(pool);
  assert.equal(dealt.length, plain.length);
  assert.deepEqual([...count(dealt)].sort(), [...count(plain)].sort(), 'the same appearances per source');
});

test('sow-384: without a spread, and for a list too short to deal, the order is exactly as before', () => {
  const pool = synthetic(126);
  assert.deepEqual(rotationOrder(pool, {}).map((s) => s.id), rotationOrder(pool).map((s) => s.id));
  assert.deepEqual(rotationOrder(pool, { spread: 0 }).map((s) => s.id), pool.concat(pool).map((s) => s.id), 'list order, twice for neutral weight');
  const short = synthetic(20);
  assert.deepEqual(dealIntoRuns(short, RUN).map((s) => s.id), short.map((s) => s.id), 'fewer than two runs of sources: unchanged');
  assert.deepEqual(dealIntoRuns(null, RUN), []);
});

test('sow-384: the collection run passes its chunk size as the spread', () => {
  // A source check, stated as one: the ingest needs the network and the AI binding, so it has no harness here. The
  // mutation run for this SOW deletes the option and confirms this goes red.
  const src = readFileSync(new URL('../workers/signup/news/src/ingest.mjs', import.meta.url), 'utf8');
  assert.match(src, /nextChunk\(env, rotationOrder\(pool, \{ spread: chunkSize \}\), chunkSize\)/);
});
