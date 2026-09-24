// SOW-080: the flat topic vocabulary reader (membership/topics-vocab.mjs). Pure, no IO (except the one integration
// test that parses the real house/topics.yml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { topicsVocabFromParsed, topicVocabList, topicVocabLabel, topicVocabKeys, toTopicsMirror, TOPICS_MIRROR_KEY, topicGroupsFromParsed, topicVocabGrouped, MORE_TOPICS } from '../membership/topics-vocab.mjs';

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

// ---- sow-227: the headings mirror the Categories screen ----

const TREE = { devops: { label: 'DevOps' }, ai: { label: 'AI', children: { llms: { label: 'LLMs' } } }, blog: { label: 'Blog' } };

test('sow-227: a heading named by a tree key takes the tree label and order; the file\'s own headings follow', () => {
  const parsed = {
    groups: { life: { label: 'Life & Interests' }, making: 'Making & Science' },
    topics: {
      cooking: { label: 'Cooking', group: 'life' },
      hardware: { label: 'Hardware', group: 'making' },
      llm: { label: 'LLM', group: 'ai' },
      docker: { label: 'Docker', group: 'devops' },
    },
  };
  const { groups, topics } = topicVocabGrouped(parsed, TREE);
  // Tree order (devops before ai, blog unused and so absent), then the file's headings in FILE order.
  assert.deepEqual(groups, [
    { key: 'devops', label: 'DevOps' }, { key: 'ai', label: 'AI' },
    { key: 'life', label: 'Life & Interests' }, { key: 'making', label: 'Making & Science' },
  ]);
  // `group` is the heading LABEL (the /topics.json contract the published extension reads), `groupKey` the key.
  assert.deepEqual(topics.find((t) => t.key === 'llm'), { key: 'llm', label: 'LLM', group: 'AI', groupKey: 'ai' });
  // A rename in the Categories screen renames the heading with no edit to the topic file.
  const renamed = topicVocabGrouped(parsed, { ...TREE, devops: { label: 'Development' } });
  assert.equal(renamed.topics.find((t) => t.key === 'docker').group, 'Development');
});

test('sow-227: a group that resolves to nothing lands under "More topics", last, never hidden', () => {
  const { groups, topics } = topicVocabGrouped({ topics: { ai: { label: 'AI', group: 'ai' }, rust: { label: 'Rust', group: 'gone' } } }, TREE);
  assert.deepEqual(groups.map((g) => g.key), ['ai', MORE_TOPICS.key]);
  assert.deepEqual(topics.find((t) => t.key === 'rust'), { key: 'rust', label: 'Rust', group: 'More topics', groupKey: 'more' });
});

test('sow-227: a vocabulary with no groups at all stays flat (no headings, no group fields)', () => {
  const { groups, topics } = topicVocabGrouped({ topics: { ai: 'AI', devops: 'DevOps' } }, TREE);
  assert.deepEqual(groups, []);
  assert.deepEqual(topics, [{ key: 'ai', label: 'AI' }, { key: 'devops', label: 'DevOps' }]);
});

test('sow-227: topicGroupsFromParsed reads string or {label} values, drops bad keys, keeps file order', () => {
  assert.deepEqual(topicGroupsFromParsed({ groups: { b: 'Bee', a: { label: 'Ay' }, 'Bad Key': 'x', c: null } }),
    [{ key: 'b', label: 'Bee' }, { key: 'a', label: 'Ay' }, { key: 'c', label: 'C' }]);
  assert.deepEqual(topicGroupsFromParsed({}), []);
  assert.deepEqual(topicGroupsFromParsed(null), []);
});

test('sow-227: every REAL topic resolves to a heading, in the Categories screen order the owner approved', () => {
  const topicsParsed = yaml.load(fs.readFileSync(new URL('../house/topics.yml', import.meta.url), 'utf8'));
  const tree = yaml.load(fs.readFileSync(new URL('../house/taxonomy.yml', import.meta.url), 'utf8')).tree;
  const { groups, topics } = topicVocabGrouped(topicsParsed, tree);
  assert.equal(topics.length, topicVocabKeys(topicsParsed).length);
  const lost = topics.filter((t) => t.groupKey === MORE_TOPICS.key).map((t) => t.key);
  assert.deepEqual(lost, [], 'a topic names a group that is neither a top-level category nor declared under groups:');
  assert.deepEqual(groups.map((g) => g.label),
    ['DevOps', 'AI', 'Blockchain', 'Entertainment', 'Business', 'Design', 'Making & Science', 'Life & Interests']);
  // The tree headings are exactly the tree's top-level keys, in the tree's own order.
  const treeKeys = Object.keys(tree);
  const used = groups.map((g) => g.key).filter((k) => treeKeys.includes(k));
  assert.deepEqual(used, treeKeys.filter((k) => used.includes(k)));
});
