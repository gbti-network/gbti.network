// A share's card names its category the way the website's feed card does. The website resolves the share's topic key
// to a label at build time (src/lib/feed-items.ts topicLabel); the extension and the in-app Browse read shares live,
// so they resolve it from the public /topics.json (client-ui/src/topic-labels.mjs) and the shared share projection
// carries it as the card's categoryLabels, which <gbti-card-list> prints as the category pill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { topicLabelMap, topicLabelFor, sameTopicLabels, rememberedTopicLabels, loadTopicLabels, TOPIC_LABELS_KEY } from '../client-ui/src/topic-labels.mjs';
import { shareToItem, mergeAll } from '../client-ui/src/all-merge.mjs';
import { categoryLeaf } from '../client-ui/src/elements/gbti-card-list.mjs';
import { topicVocabList, topicVocabLabel } from '../membership/topics-vocab.mjs';

const PARSED = yaml.load(fs.readFileSync(new URL('../house/topics.yml', import.meta.url), 'utf8'));
const PAYLOAD = { topics: topicVocabList(PARSED) }; // the shape /topics.json serves (key + label per topic)
const LABELS = topicLabelMap(PAYLOAD);

test('every topic key names its share exactly as the website does', () => {
  assert.ok(LABELS.size > 20, 'the real vocabulary loaded');
  for (const key of [...LABELS.keys(), 'not-a-listed-topic', 'aws', 'nextjs']) {
    assert.equal(topicLabelFor(key, LABELS), topicVocabLabel(PARSED, key), key);
  }
  assert.equal(topicLabelFor('nextjs', LABELS), 'Next.js'); // the label, not the key title-cased
});

test('no pill until a vocabulary is known, and none for a blank key', () => {
  assert.equal(topicLabelFor('music', new Map()), ''); // a first run offline shows no pill rather than a guessed one
  assert.equal(topicLabelFor('music', undefined), '');
  assert.equal(topicLabelFor('', LABELS), '');
  assert.equal(topicLabelFor(null, LABELS), '');
  assert.equal(topicLabelFor('  music  ', LABELS), LABELS.get('music'));
});

test('topicLabelMap drops malformed entries and reads the remembered copy', () => {
  const m = topicLabelMap({ topics: [{ key: 'music', label: 'Music' }, { label: 'no key' }, null, { key: 'go' }] });
  assert.deepEqual([...m], [['music', 'Music'], ['go', 'go']]);
  assert.equal(topicLabelMap(null).size, 0);
  assert.equal(topicLabelMap({ topics: 'nope' }).size, 0);
});

test('sameTopicLabels compares content, not identity', () => {
  assert.equal(sameTopicLabels(new Map([['a', 'A']]), new Map([['a', 'A']])), true);
  assert.equal(sameTopicLabels(new Map([['a', 'A']]), new Map([['a', 'B']])), false);
  assert.equal(sameTopicLabels(new Map([['a', 'A']]), new Map()), false);
  assert.equal(sameTopicLabels(null, new Map()), false);
});

test('a share card carries its topic name as the category pill', () => {
  const raw = { id: 's1', author: 'gbtilabs', title: 'Smoked Fish', visibility: 'public', createdAt: '2026-10-08T00:00:00Z', category: 'music' };
  const it = shareToItem(raw, { topicLabels: LABELS });
  assert.deepEqual(it.categoryLabels, [LABELS.get('music')]);
  assert.equal(categoryLeaf(it.categoryLabels), LABELS.get('music')); // what the card's category chip prints
  assert.equal(it.category, 'music'); // the stored key still travels for the reader and an edit
  // No vocabulary, or no category: no pill, and nothing invented.
  assert.equal('categoryLabels' in shareToItem(raw), false);
  assert.equal('categoryLabels' in shareToItem({ ...raw, category: null }, { topicLabels: LABELS }), false);
});

test('mergeAll hands the vocabulary to every share it projects', () => {
  const shares = [
    { id: 'a', author: 'x', visibility: 'public', createdAt: '2026-10-08T00:00:00Z', category: 'ai' },
    { id: 'b', author: 'y', visibility: 'members', createdAt: '2026-10-07T00:00:00Z', category: 'music' },
  ];
  const out = mergeAll({ items: [], shares, membership: 'paid', topicLabels: LABELS });
  assert.deepEqual(out.map((s) => s.categoryLabels), [[LABELS.get('ai')], [LABELS.get('music')]]);
});

test('every surface that lists shares passes the vocabulary to the projection', () => {
  const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.match(read('extension/src/newtab.mjs'), /mergeAll\(\{[^}]*topicLabels: TOPIC_LABELS[^}]*\}\)/);
  assert.match(read('client-ui/src/elements/gbti-browse.mjs'), /mergeAll\(\{[^}]*topicLabels: this\._topicLabels[^}]*\}\)/);
  assert.match(read('client-ui/src/elements/gbti-shares-feed.mjs'), /shareToItem\(it, \{ topicLabels: this\._topicLabels \}\)/);
});

test('the vocabulary loads once, is remembered, and a failure is retried', async () => {
  const store = new Map();
  const realLS = globalThis.localStorage, realFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  let calls = 0;
  let fail = true;
  globalThis.fetch = async () => { calls += 1; if (fail) throw new Error('offline'); return { ok: true, json: async () => PAYLOAD }; };
  try {
    assert.equal(rememberedTopicLabels().size, 0);
    assert.equal(await loadTopicLabels(), null); // offline: nothing, and nothing remembered
    assert.equal(store.has(TOPIC_LABELS_KEY), false);
    fail = false;
    const map = await loadTopicLabels(); // the failure was not cached, so this fetches again
    assert.equal(calls, 2);
    assert.ok(sameTopicLabels(map, LABELS));
    assert.ok(sameTopicLabels(rememberedTopicLabels(), LABELS)); // the next page paints from this
    await loadTopicLabels();
    assert.equal(calls, 2); // once per page after a success
    store.set(TOPIC_LABELS_KEY, '{not json');
    assert.equal(rememberedTopicLabels().size, 0); // a damaged copy is ignored, not thrown
  } finally {
    globalThis.localStorage = realLS; globalThis.fetch = realFetch;
  }
});
