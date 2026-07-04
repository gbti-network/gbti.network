// SOW-087: the share topic-category suggester (Worker-side). Vocabulary from the topics:vocab KV mirror, the
// classify knob from the synd:config mirror, Workers AI faked, keyword fallback, fail-open to null. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTopic, keywordTopic, buildTopicMessages, suggestTopic, readTopicsVocab } from '../workers/signup/topic-suggest.mjs';
import { TOPICS_MIRROR_KEY } from '../membership/topics-vocab.mjs';

const VOCAB = {
  ai: { label: 'AI' },
  devops: { label: 'DevOps' },
  'home-network': { label: 'Home Network' },
  gardening: { label: 'Gardening' },
};

function fakeKv({ topics = VOCAB, config = { enabled: true, classify: 'ai' } } = {}) {
  const store = new Map([
    [TOPICS_MIRROR_KEY, { generatedAt: 'T0', topics }],
    ['synd:config', config],
  ]);
  return { get: async (k) => store.get(k) ?? null };
}

test('normalizeTopic matches a key, a label, chatty containment; null off-list', () => {
  assert.equal(normalizeTopic('devops', VOCAB), 'devops');
  assert.equal(normalizeTopic(' "DevOps" ', VOCAB), 'devops'); // label + quotes
  assert.equal(normalizeTopic('The topic is home-network.', VOCAB), 'home-network');
  assert.equal(normalizeTopic('Home Network', VOCAB), 'home-network');
  assert.equal(normalizeTopic('cooking', VOCAB), null);
  assert.equal(normalizeTopic('', VOCAB), null);
  assert.equal(normalizeTopic(null, VOCAB), null);
});

test('keywordTopic: an exact declared-tag match wins first, then a whole-word hit in title/description', () => {
  assert.equal(keywordTopic({ title: 'x', tags: ['Home Network'] }, VOCAB), 'home-network');
  assert.equal(keywordTopic({ title: 'Scaling DevOps pipelines', tags: [] }, VOCAB), 'devops');
  assert.equal(keywordTopic({ description: 'about gardening at home' }, VOCAB), 'gardening');
  // no partial-word hits: "maids" must not match "ai"
  assert.equal(keywordTopic({ title: 'maids of honor' }, VOCAB), null);
  assert.equal(keywordTopic({}, VOCAB), null);
  assert.equal(keywordTopic({ title: 'anything' }, {}), null);
});

test('buildTopicMessages lists every key with its label and carries the tags line', () => {
  const msgs = buildTopicMessages({ title: 'T', description: 'D', tags: ['a', 'b'] }, VOCAB);
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[0].content.includes('- home-network: Home Network'));
  assert.ok(msgs[1].content.includes('Title: T'));
  assert.ok(msgs[1].content.includes('Tags: a, b'));
});

test('suggestTopic: mode ai uses Workers AI and validates the reply against the vocabulary', async () => {
  const env = { SIGNUP_KV: fakeKv(), AI: { run: async () => ({ response: 'DevOps' }) } };
  assert.equal(await suggestTopic(env, { title: 'anything' }), 'devops');
});

test('suggestTopic: an off-list AI reply or an AI error falls back to the keyword guess', async () => {
  const offList = { SIGNUP_KV: fakeKv(), AI: { run: async () => ({ response: 'volleyball' }) } };
  assert.equal(await suggestTopic(offList, { title: 'a gardening story' }), 'gardening');
  const boom = { SIGNUP_KV: fakeKv(), AI: { run: async () => { throw new Error('quota'); } } };
  assert.equal(await suggestTopic(boom, { title: 'a gardening story' }), 'gardening');
});

test('suggestTopic: mode keyword never calls AI; mode off suggests nothing', async () => {
  let called = false;
  const kw = { SIGNUP_KV: fakeKv({ config: { classify: 'keyword' } }), AI: { run: async () => { called = true; return { response: 'devops' }; } } };
  assert.equal(await suggestTopic(kw, { title: 'DevOps at scale' }), 'devops');
  assert.equal(called, false);
  const off = { SIGNUP_KV: fakeKv({ config: { classify: 'off' } }), AI: { run: async () => ({ response: 'devops' }) } };
  assert.equal(await suggestTopic(off, { title: 'DevOps at scale' }), null);
});

test('suggestTopic fails open to null: no KV, an empty vocabulary mirror, a broken KV read', async () => {
  assert.equal(await suggestTopic({}, { title: 'DevOps' }), null);
  assert.equal(await suggestTopic({ SIGNUP_KV: fakeKv({ topics: {} }) }, { title: 'DevOps' }), null);
  const broken = { get: async () => { throw new Error('kv down'); } };
  assert.deepEqual(await readTopicsVocab(broken), {});
  assert.equal(await suggestTopic({ SIGNUP_KV: broken }, { title: 'DevOps' }), null);
});
