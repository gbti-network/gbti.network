// sow-337: the icon picker's reader of the site's icon library (client-ui/src/cta-icon-library.mjs), over a fake fetch.
// The index is fetched once; a shard only when a visible result lives in it, and once; a failed load is reported and a
// later call tries again, with no retry of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIconLibrary } from '../client-ui/src/cta-icon-library.mjs';
import { packIcon, unpackIcon, ICON_SHARD_SIZE } from '../membership/icon-catalog.mjs';

const shape = (d) => ({ v: '0 0 24 24', s: [{ tag: 'path', attrs: { d } }] });
const faNames = Array.from({ length: ICON_SHARD_SIZE + 2 }, (_, i) => `FaIcon${i}`);
faNames[ICON_SHARD_SIZE + 1] = 'FaAmazon';
const INDEX = { available: true, version: '5.7.0', shardSize: ICON_SHARD_SIZE, total: faNames.length + 1, sets: [
  { id: 'fa', name: 'Font Awesome 5', license: 'CC BY 4.0', names: faNames },
  { id: 'si', name: 'Simple Icons', license: 'CC0', names: ['SiAmazon'] },
] };
const SHARDS = {
  'fa-0': faNames.slice(0, ICON_SHARD_SIZE).map((n) => shape(`M${n}`)),
  'fa-1': [shape('MFaIcon250'), { ...shape('MFaAmazon'), a: { fill: 'none', stroke: 'currentColor', 'stroke-width': '2' } }],
  'si-0': [shape('MSiAmazon')],
};

function fakeFetch({ failIndex = 0, status = 200, body = INDEX } = {}) {
  const calls = [];
  let fails = failIndex;
  const impl = async (url) => {
    calls.push(url);
    const m = /\/icons\/(.+)\.json$/.exec(url);
    if (m[1] === 'index') {
      if (fails > 0) { fails -= 1; return { ok: false, status: 503, json: async () => ({}) }; }
      return { ok: status === 200, status, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({ shard: m[1], icons: SHARDS[m[1]] }) };
  };
  return { impl, calls };
}

test('a search fetches the index once and only the shards its results live in, each once', async () => {
  const f = fakeFetch();
  const lib = createIconLibrary({ base: 'https://gbti.network', fetchImpl: f.impl });
  const r = await lib.search('amazon');
  assert.equal(r.total, 2);
  assert.deepEqual(r.icons.map((i) => `${i.set}/${i.name}`), ['Font Awesome 5/FaAmazon', 'Simple Icons/SiAmazon']);
  assert.deepEqual(r.icons[0], unpackIcon('FaAmazon', 'Font Awesome 5', SHARDS['fa-1'][1]), 'the icon at its position in its shard');
  assert.deepEqual(f.calls.sort(), ['https://gbti.network/icons/fa-1.json', 'https://gbti.network/icons/index.json', 'https://gbti.network/icons/si-0.json']);
  await lib.search('amazon', { setId: 'fa' });
  await lib.sets();
  assert.equal(f.calls.length, 3, 'a second search and the set list reuse what was fetched');
  const g = fakeFetch();
  const fresh = createIconLibrary({ fetchImpl: g.impl });
  await Promise.all([fresh.sets(), fresh.search('amazon'), fresh.search('amazon', { setId: 'si' })]);
  assert.equal(g.calls.filter((u) => u.endsWith('/index.json')).length, 1, 'opening the picker asks for the chips and the results at once: one index fetch');
  assert.equal(g.calls.filter((u) => u.endsWith('/si-0.json')).length, 1, 'and one fetch per shard');
});

test('the set chips carry each set and its size', async () => {
  const lib = createIconLibrary({ fetchImpl: fakeFetch().impl });
  assert.deepEqual(await lib.sets(), [{ id: 'fa', name: 'Font Awesome 5', count: faNames.length }, { id: 'si', name: 'Simple Icons', count: 1 }]);
});

test('a failed index load rejects with the reason, and the next call tries again', async () => {
  const f = fakeFetch({ failIndex: 1 });
  const lib = createIconLibrary({ fetchImpl: f.impl });
  await assert.rejects(lib.search('amazon'), /the icon library returned 503/);
  assert.equal(f.calls.length, 1, 'no retry of its own');
  assert.equal((await lib.search('amazon')).total, 2);
});

test('a site whose build could not read the package says why', async () => {
  const lib = createIconLibrary({ fetchImpl: fakeFetch({ body: { available: false, problem: 'the icon library could not be read (ENOENT)' } }).impl });
  await assert.rejects(lib.sets(), /could not be read \(ENOENT\)/);
});

test('the first page of an empty search is the start of the library, drawn from the first shard only', async () => {
  const f = fakeFetch();
  const lib = createIconLibrary({ fetchImpl: f.impl });
  const r = await lib.search('', { limit: 3 });
  assert.equal(r.total, faNames.length + 1);
  assert.deepEqual(r.icons.map((i) => i.name), ['FaIcon0', 'FaIcon1', 'FaIcon2']);
  assert.deepEqual(r.icons[1].shapes, packIcon({ viewBox: '0 0 24 24', attrs: {}, shapes: [{ tag: 'path', attrs: { d: 'MFaIcon1' } }] }).s);
  assert.equal(f.calls.filter((u) => /fa-1|si-0/.test(u)).length, 0);
});
