// SOW-080: the flat topic vocabulary reader (membership/topics-vocab.mjs). Pure, no IO (except the one integration
// test that parses the real house/topics.yml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { topicsVocabFromParsed, topicVocabList, topicVocabLabel, topicVocabKeys, toTopicsMirror, TOPICS_MIRROR_KEY } from '../membership/topics-vocab.mjs';

test('topicsVocabFromParsed accepts {topics:{}} + a bare map; string|object|null values; defaults the label', () => {
  const m = topicsVocabFromParsed({ topics: { ai: { label: 'AI' }, 'home-network': 'Home Network', foo: null } });
  assert.deepEqual(m.ai, { label: 'AI' });
  assert.deepEqual(m['home-network'], { label: 'Home Network' });
  assert.deepEqual(m.foo, { label: 'Foo' }); // null -> Title-Cased key
  assert.deepEqual(topicsVocabFromParsed({ ai: 'AI' }).ai, { label: 'AI' }); // bare map (no topics wrapper)
  assert.deepEqual(topicsVocabFromParsed(null), {});
});

test('topicsVocabFromParsed drops malformed / non-kebab keys + preserves an optional group', () => {
  const m = topicsVocabFromParsed({ topics: { 'Bad Key': 'x', UPPER: 'y', _under: 'z', ok: { label: 'Ok', group: 'Tech' } } });
  assert.ok(!('Bad Key' in m) && !('UPPER' in m) && !('_under' in m));
  assert.deepEqual(m.ok, { label: 'Ok', group: 'Tech' });
});

test('topicVocabList sorts by label; topicVocabLabel + topicVocabKeys behave', () => {
  const parsed = { topics: { zebra: 'Zebra', ai: 'AI' } };
  assert.deepEqual(topicVocabList(parsed), [{ key: 'ai', label: 'AI' }, { key: 'zebra', label: 'Zebra' }]);
  assert.equal(topicVocabLabel(parsed, 'ai'), 'AI');
  assert.equal(topicVocabLabel(parsed, 'missing'), 'Missing'); // Title-Cased fallback
  assert.deepEqual(topicVocabKeys(parsed).sort(), ['ai', 'zebra']);
});

test('a group is carried through topicVocabList', () => {
  const list = topicVocabList({ topics: { ai: { label: 'AI', group: 'Tech' } } });
  assert.deepEqual(list, [{ key: 'ai', label: 'AI', group: 'Tech' }]);
});

test('the real house/topics.yml parses; keys are unique + kebab-case', () => {
  const parsed = yaml.load(fs.readFileSync(new URL('../house/topics.yml', import.meta.url), 'utf8'));
  const keys = topicVocabKeys(parsed);
  assert.ok(keys.length >= 14, 'has at least the seeded topics');
  assert.equal(keys.length, new Set(keys).size, 'unique keys');
  for (const k of keys) assert.match(k, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${k} is kebab-case`);
});

// SOW-087: the topics:vocab KV mirror payload for the share category suggester.
test('toTopicsMirror wraps the clean vocabulary with a generatedAt stamp', () => {
  const m = toTopicsMirror({ topics: { ai: { label: 'AI' }, 'BAD KEY': 'x' } }, () => 'T0');
  assert.deepEqual(m, { generatedAt: 'T0', topics: { ai: { label: 'AI' } } });
  assert.equal(TOPICS_MIRROR_KEY, 'topics:vocab');
});
