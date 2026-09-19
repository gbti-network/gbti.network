// sow-338 Phase 2: how much the news pipeline takes from each source.
//
// Owner, 2026-09-18: a weight changes how much we TAKE from a source, not how its stories rank, and an
// unweighted source behaves exactly as it did before weights existed. Five steps, -2 to +2. The bottom step is
// "rarely", never "off": muting is the explicit Disable toggle on the source pool.
//
// The problem it answers is measured, not theoretical. Over a 31-day window the store held 15,979 items from 106
// active sources, of which node-js sent 1,054, clickhouse 881, engadget 730, xda-developers 678 and
// ethereum-foundation-blog 639: five sources, about a quarter of everything, in a stream that is newest-first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { clampWeight, fetchCap, rotationOrder, cleanSources, nextChunk, WEIGHT_MIN, WEIGHT_MAX } from '../workers/signup/news/src/sources.mjs';
import { selectFresh } from '../workers/signup/news/src/ingest.mjs';
import { setSourceWeight, weightInput, readWeights, weightOf, weightLabel, stepToward, NewsWeightEditError } from '../membership/news-source-weight-edits.mjs';
import { SUPERADMIN_HOUSE_FILES, rankForPath, ROLE_RANK } from '../membership/path-rank.mjs';

const src = (id, weight) => ({ id, name: id, url: `https://${id}.test/feed`, description: '', ...(weight === undefined ? {} : { weight }) });

// ---------------------------------------------------------------------------
// The scale
// ---------------------------------------------------------------------------

test('sow-338: a weight is a step in range, and anything unreadable is neutral', () => {
  assert.equal(clampWeight(2), 2);
  assert.equal(clampWeight(-2), -2);
  assert.equal(clampWeight(0), 0);
  assert.equal(clampWeight(7), WEIGHT_MAX, 'out of range clamps rather than amplifying');
  assert.equal(clampWeight(-7), WEIGHT_MIN);
  assert.equal(clampWeight(1.4), 1, 'a fraction rounds to a step');
  for (const junk of [undefined, null, '', 'up', NaN, {}, []]) {
    assert.equal(clampWeight(junk), 0, `${JSON.stringify(junk)} is neutral`);
  }
});

test('sow-338: only a source voted DOWN keeps fewer stories per check', () => {
  // Neutral is uncapped BY DECISION (owner): nothing changes until somebody votes, so the floods stay until the
  // noisy sources are voted down. A cap on neutral would have changed all 125 sources on day one.
  assert.equal(fetchCap(0), Infinity);
  assert.equal(fetchCap(1), Infinity);
  assert.equal(fetchCap(2), Infinity);
  assert.equal(fetchCap(-1), 6);
  assert.equal(fetchCap(-2), 3);
  assert.equal(fetchCap(undefined), Infinity, 'an unweighted source is untouched');
});

// ---------------------------------------------------------------------------
// The rotation
// ---------------------------------------------------------------------------

test('sow-338: every enabled source still comes round, whatever its weight', () => {
  // The floor of the scale is "rarely", not "off". A weight that could silence a source would be a second,
  // invisible disable switch beside the real one.
  const pool = [src('a', -2), src('b', -1), src('c', 0), src('d', 1), src('e', 2), src('f')];
  const order = rotationOrder(pool).map((s) => s.id);
  for (const s of pool) assert.ok(order.includes(s.id), `${s.id} appears`);
});

test('sow-338: a step changes how OFTEN a source comes round', () => {
  const pool = [src('down2', -2), src('down1', -1), src('neutral', 0), src('up1', 1), src('up2', 2)];
  const order = rotationOrder(pool).map((s) => s.id);
  const times = (id) => order.filter((x) => x === id).length;
  // Appearances per supercycle (two cycles), which is how a half-step is expressed with no wall clock.
  assert.equal(times('down2'), 1, 'once every two cycles');
  assert.equal(times('down1'), 2, 'once per cycle, like neutral: the difference is the cap');
  assert.equal(times('neutral'), 2, 'once per cycle, which is today');
  assert.equal(times('up1'), 3, 'three times per two cycles');
  assert.equal(times('up2'), 4, 'twice per cycle');
  assert.ok(times('up2') > times('neutral') && times('neutral') > times('down2'), 'and the order is monotonic');
});

test('sow-338: repeats are SPREAD, so one chunk never fetches the same source twice', () => {
  // Built in passes rather than by repeating a source in place. Repeating in place would put both appearances of
  // an up-voted source inside the same 16-source chunk, which fetches it twice in one run and gains nothing.
  const pool = Array.from({ length: 30 }, (_, i) => src(`s${i}`, i === 0 ? 2 : 0));
  const order = rotationOrder(pool).map((s) => s.id);
  const first = order.indexOf('s0');
  const second = order.indexOf('s0', first + 1);
  assert.ok(second - first >= pool.length, `two appearances are a full pass apart (${second - first})`);
});

test('sow-338: an unweighted pool rotates exactly as it did before weights existed', () => {
  // The safest property in the whole change: with nobody voted up or down, the rotation is the pool, twice, in
  // order, so the cursor walks it the way it always has.
  const pool = [src('a'), src('b'), src('c')];
  assert.deepEqual(rotationOrder(pool).map((s) => s.id), ['a', 'b', 'c', 'a', 'b', 'c']);
});

test('sow-338: the measured floods are cut by a step, by a number', () => {
  // node-js sent 1,054 items in 31 days, about 34 a day, at roughly 3 checks a day: ~11 a check. A supercycle is
  // two cycles, about 16 hours, so today it contributes ~22 in that span.
  const perCheck = 11;
  const yieldOf = (w) => rotationOrder([src('x', w)]).length * Math.min(perCheck, fetchCap(w));
  assert.equal(yieldOf(0), 22, 'neutral: unchanged');
  assert.equal(yieldOf(-1), 12, 'one step down roughly halves it');
  assert.equal(yieldOf(-2), 3, 'two steps down cuts it by about seven eighths');
  assert.equal(yieldOf(2), 44, 'and a source worth more doubles');
});

test('sow-338: a chunk is deduped, so a repeat can never be fetched twice in one run', () => {
  // The passes keep repeats far apart, but a pool smaller than one chunk can still wrap onto itself.
  const env = { NEWS_KV: { get: async () => null, put: async () => {} } };
  const pool = [src('a', 2), src('b', 0)];
  const picked = rotationOrder(pool);
  assert.ok(picked.length > pool.length, 'the rotation does carry repeats');
  return nextChunk(env, picked, 3, { save: false }).then((chunk) => {
    assert.deepEqual(chunk.map((s) => s.id).sort(), ['a', 'b'], 'but a chunk carries each source once');
  });
});

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

test('sow-338: the weight survives the pipeline normalization that drops everything else', () => {
  // cleanSources keeps four fields and consumes `enabled` as a filter. A new field is dropped unless it is added
  // on purpose, and this one is read on every run.
  const [one] = cleanSources([{ id: 'a', name: 'A', url: 'https://a.test/f', description: 'd', weight: -2, nonsense: 'x' }]);
  assert.deepEqual(one, { id: 'a', name: 'A', url: 'https://a.test/f', description: 'd', weight: -2 });
  const [plain] = cleanSources([{ id: 'b', url: 'https://b.test/f' }]);
  assert.equal(plain.weight, 0, 'a source with no weight is neutral, not undefined');
  const [wild] = cleanSources([{ id: 'c', url: 'https://c.test/f', weight: 99 }]);
  assert.equal(wild.weight, WEIGHT_MAX, 'and a wild value is clamped at the boundary of the system');
});

test('sow-338: the weights file ships in the repository, superadmin-owned, and starts empty', () => {
  const raw = fs.readFileSync(new URL('../house/news-source-weights.yml', import.meta.url), 'utf8');
  assert.match(raw, /^weights: \{\}$/m, 'no source is weighted until somebody votes');
  // The lockstep that makes it a superadmin file: the rank module, CODEOWNERS, and the Worker action table.
  // test/path-rank.test.mjs and test/classify-pr-path-rank-agreement.test.mjs fail if the three disagree.
  assert.ok(SUPERADMIN_HOUSE_FILES.has('house/news-source-weights.yml'));
  assert.equal(rankForPath('house/news-source-weights.yml'), ROLE_RANK.superadmin);
  assert.equal(rankForPath('house/news-sources.yml'), ROLE_RANK.admin, 'while the source POOL stays an admin file');
  const owners = fs.readFileSync(new URL('../CODEOWNERS', import.meta.url), 'utf8');
  assert.match(owners, /^\/house\/news-source-weights\.yml\s+@atwellpub @gbtilabs$/m);
});

// ---------------------------------------------------------------------------
// The edit
// ---------------------------------------------------------------------------

test('sow-338: setting a weight writes one line, and neutral removes it', () => {
  const doc = { weights: { 'node-js': -1 } };
  const down = setSourceWeight(doc, { id: 'node-js', weight: -2 }, { actor: { login: 'atwellpub' } });
  assert.equal(down.changed, true);
  assert.deepEqual(down.next.weights, { 'node-js': -2 });
  assert.equal(down.audit.target.id, 'node-js');
  assert.deepEqual(down.audit.detail, { from: -1, to: -2 });

  // Neutral is ABSENCE, so the file lists only what somebody actually weighted.
  const back = setSourceWeight(down.next, { id: 'node-js', weight: 0 }, {});
  assert.equal(back.changed, true);
  assert.deepEqual(back.next.weights, {});
});

test('sow-338: setting the weight it already carries changes nothing', () => {
  const doc = { weights: { wired: 1 } };
  const same = setSourceWeight(doc, { id: 'wired', weight: 1 }, {});
  assert.equal(same.changed, false);
  assert.equal(same.audit, null, 'and records nothing, so a double click does not open a pull request');
});

test('sow-338: the map stays sorted, so a diff shows the line that changed', () => {
  let doc = { weights: {} };
  for (const id of ['wired', 'clickhouse', 'node-js']) doc = setSourceWeight(doc, { id, weight: -1 }, {}).next;
  assert.deepEqual(Object.keys(doc.weights), ['clickhouse', 'node-js', 'wired']);
});

test('sow-338: an id or a step that is not one is refused, never clamped', () => {
  // A caller asking for 5 has a bug or is probing. Silently writing 2 would hide both.
  for (const bad of [{ id: 'x', weight: 5 }, { id: 'x', weight: -5 }, { id: 'x', weight: 1.5 }, { id: 'x', weight: 'up' }, { id: 'x' }]) {
    assert.throws(() => setSourceWeight({}, bad, {}), NewsWeightEditError, JSON.stringify(bad));
    assert.throws(() => weightInput(bad), NewsWeightEditError, JSON.stringify(bad));
  }
  for (const bad of [{ id: '', weight: 1 }, { id: 'Not Kebab', weight: 1 }, { id: '../escape', weight: 1 }, { weight: 1 }]) {
    assert.throws(() => setSourceWeight({}, bad, {}), NewsWeightEditError, JSON.stringify(bad));
    assert.throws(() => weightInput(bad), NewsWeightEditError, JSON.stringify(bad));
  }
  assert.deepEqual(weightInput({ id: 'node-js', weight: -2 }), { id: 'node-js', weight: -2 });
});

test('sow-338: a malformed weights file reads as neutral rather than failing a run', () => {
  // The pipeline must keep running on a hand-edited file: an unreadable entry means "nobody voted on this".
  assert.deepEqual(readWeights(null), {});
  assert.deepEqual(readWeights({ weights: 'nonsense' }), {});
  assert.deepEqual(readWeights({ weights: ['a'] }), {});
  assert.deepEqual(readWeights({ weights: { 'node-js': 'down', wired: 0, 'Bad Id': 2, ok: -1, huge: 99 } }), { ok: -1, huge: 2 });
  assert.equal(weightOf({ weights: { wired: 2 } }, 'wired'), 2);
  assert.equal(weightOf({ weights: {} }, 'wired'), 0);
});

// ---------------------------------------------------------------------------
// What one check actually keeps
// ---------------------------------------------------------------------------

const story = (source, n) => ({ guid: `${source}-${n}`, source, title: `${source} ${n}` });
const batch = (source, count) => Array.from({ length: count }, (_, i) => story(source, i));

test('sow-338: a source voted down keeps only its newest few, per check', () => {
  // Feeds list newest first and the fetch preserves that order, so the first N are the newest N.
  const parsed = batch('node-js', 11);
  const capped = selectFresh(parsed, { capFor: new Map([['node-js', fetchCap(-2)]]) });
  assert.equal(capped.length, 3);
  assert.deepEqual(capped.map((it) => it.guid), ['node-js-0', 'node-js-1', 'node-js-2'], 'the newest three');
  assert.equal(selectFresh(parsed, { capFor: new Map([['node-js', fetchCap(-1)]]) }).length, 6);
});

test('sow-338: an unweighted source keeps everything it finds, exactly as before', () => {
  const parsed = batch('node-js', 11);
  assert.equal(selectFresh(parsed, { capFor: new Map([['node-js', fetchCap(0)]]) }).length, 11);
  assert.equal(selectFresh(parsed, { capFor: new Map([['node-js', fetchCap(2)]]) }).length, 11);
  assert.equal(selectFresh(parsed, {}).length, 11, 'and a source missing from the cap map is uncapped, not silenced');
});

test('sow-338: the cap is PER SOURCE, so a quiet source is not starved by a loud one', () => {
  // The batch is a whole chunk of sources interleaved. A cap that counted the BATCH rather than the source would
  // let whichever source parsed first consume it, and the effect is invisible unless a later source is capped
  // too: with one capped source in the batch the two readings agree, which is why the second case is here.
  const parsed = [...batch('node-js', 8), ...batch('wired', 4)];
  const kept = selectFresh(parsed, { capFor: new Map([['node-js', 3], ['wired', Infinity]]) });
  assert.equal(kept.filter((it) => it.source === 'node-js').length, 3);
  assert.equal(kept.filter((it) => it.source === 'wired').length, 4);

  // Two sources voted down in the same chunk. The second must still get its own three, not whatever the first
  // left over: a superadmin who votes down the five loudest sources would otherwise silence four of them.
  const both = [...batch('node-js', 8), ...batch('clickhouse', 8)];
  const capped = selectFresh(both, { capFor: new Map([['node-js', 3], ['clickhouse', 3]]) });
  assert.equal(capped.filter((it) => it.source === 'node-js').length, 3);
  assert.equal(capped.filter((it) => it.source === 'clickhouse').length, 3, 'the second voted-down source keeps its own three');
});

test('sow-338: a story we already hold, or one a superadmin removed, never uses up the cap', () => {
  // The cap counts what we KEEP. If a skipped story spent a slot, a down-weighted source would go quiet the
  // moment its feed stopped changing.
  const parsed = batch('node-js', 6);
  const kept = selectFresh(parsed, {
    guids: { 'node-js-0': '2026-09-18', 'node-js-1': '2026-09-18' },
    removed: { 'node-js-2': { at: 1 } },
    capFor: new Map([['node-js', 3]]),
  });
  assert.deepEqual(kept.map((it) => it.guid), ['node-js-3', 'node-js-4', 'node-js-5'], 'three kept, from what was left');
});

test('sow-338: the same story from two feeds still counts once', () => {
  const parsed = [story('node-js', 1), story('node-js', 1), story('node-js', 2)];
  const kept = selectFresh(parsed, { capFor: new Map([['node-js', 2]]) });
  assert.deepEqual(kept.map((it) => it.guid), ['node-js-1', 'node-js-2']);
});

// ---------------------------------------------------------------------------
// The control a superadmin reads
// ---------------------------------------------------------------------------

test('sow-338: a step says what it does, not what number it is', () => {
  // A superadmin looking at a story wants "take less from this publication". -1 is only meaningful to whoever
  // wrote the table.
  assert.equal(weightLabel(-2), 'Much less');
  assert.equal(weightLabel(-1), 'Less');
  assert.equal(weightLabel(0), 'Normal');
  assert.equal(weightLabel(1), 'More');
  assert.equal(weightLabel(2), 'Much more');
  assert.equal(weightLabel(undefined), 'Normal', 'a source nobody has weighted reads as normal, never blank');
  assert.equal(weightLabel('nonsense'), 'Normal');
  assert.equal(weightLabel(9), 'Much more', 'and a stored value out of range still has a label');
});

test('sow-338: the arrows cannot walk a source out of the scale', () => {
  assert.equal(stepToward(0, 1), 1);
  assert.equal(stepToward(0, -1), -1);
  assert.equal(stepToward(2, 1), 2, 'the top step is the top');
  assert.equal(stepToward(-2, -1), -2, 'and the bottom is "rarely", with nothing below it');
  assert.equal(stepToward(undefined, -1), -1, 'an unweighted source starts from normal');
  assert.equal(stepToward(9, -1), 1, 'a stored value out of range is pulled into the scale first');
  // The arrows disable themselves on the step that would not move, which is this equality.
  assert.equal(stepToward(2, 1) === 2, true);
  assert.equal(stepToward(1, 1) === 1, false);
});
