// sow-493 (Cloudflare notice, 2026-11-07): Workers AI retires `@cf/meta/llama-3.2-3b-instruct` and others on
// 2026-11-20. The replacement replies OpenAI-style (`choices[0].message.content`), not with `response`, so every
// caller now reads replies through aiText. These tests pin the reader, prove each caller works with BOTH reply
// shapes, and guard against a retired model id creeping back into the source. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_TEXT_MODEL, aiText } from '../membership/ai-text.mjs';
import { classifyItem, analyzeItem } from '../workers/signup/news/src/classify.mjs';
import { suggestTopic, suggestTags } from '../workers/signup/topic-suggest.mjs';
import { TOPICS_MIRROR_KEY } from '../membership/topics-vocab.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The reply shapes a Workers AI text model can return.
const legacy = (text) => ({ response: text });
const openai = (text) => ({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
const SHAPES = { legacy, openai };

// ---------- aiText ----------

test('aiText reads the older `response` shape', () => {
  assert.equal(aiText({ response: '  Security \n' }), 'Security');
});

test('aiText reads the OpenAI shape, as a string and as text parts', () => {
  assert.equal(aiText(openai('DevOps/Cloud')), 'DevOps/Cloud');
  const parts = { choices: [{ message: { content: [{ type: 'text', text: 'Dev' }, { type: 'text', text: 'Ops' }] } }] };
  assert.equal(aiText(parts), 'DevOps');
  assert.equal(aiText({ choices: [{ text: 'legacy completion' }] }), 'legacy completion');
});

test('aiText unwraps the REST API `result` envelope, in either shape, and reads a string result', () => {
  assert.equal(aiText({ success: true, result: { response: 'wireguard, tailscale' } }), 'wireguard, tailscale');
  assert.equal(aiText({ success: true, result: openai('wireguard, tailscale') }), 'wireguard, tailscale');
  assert.equal(aiText({ result: 'plain' }), 'plain');
  assert.equal(aiText('already text'), 'already text');
});

test('aiText removes reasoning notes, closed or cut off by the token budget', () => {
  assert.equal(aiText(openai('<think>The item is about a CVE.</think>\nSecurity')), 'Security');
  assert.equal(aiText(openai('<THINK>first</THINK>A<think>second</think>B')), 'AB');
  assert.equal(aiText(openai('<think>ran out of tokens before answering')), '');
});

test('aiText gives an empty string for empty or unknown replies', () => {
  for (const out of [null, undefined, {}, { choices: [] }, { choices: [{ message: { content: null } }] }, { response: 42 }, 7]) {
    assert.equal(aiText(out), '', JSON.stringify(out));
  }
});

// ---------- the callers, with both reply shapes ----------

for (const [shape, wrap] of Object.entries(SHAPES)) {
  test(`classifyItem labels a story from a ${shape} reply`, async () => {
    const env = { AI: { run: async () => wrap('Security') } };
    assert.deepEqual(await classifyItem(env, { title: 'quarterly update', summary: '' }), { category: 'Security', classified: true });
  });

  test(`analyzeItem categorises and summarises from a ${shape} reply`, async () => {
    const env = { AI: { run: async () => wrap('CATEGORY: DevOps/Cloud\nSUMMARY: Kubernetes 2.0 ships with a new scheduler.') } };
    const r = await analyzeItem(env, { title: 'k8s 2.0', contentText: 'long body' });
    assert.equal(r.category, 'DevOps/Cloud');
    assert.equal(r.classified, true);
    assert.equal(r.digest, 'Kubernetes 2.0 ships with a new scheduler.');
    assert.equal(r.summarized, true);
  });

  test(`suggestTopic and suggestTags read a ${shape} reply`, async () => {
    const vocab = { devops: { label: 'DevOps' }, gardening: { label: 'Gardening' } };
    const store = new Map([[TOPICS_MIRROR_KEY, { generatedAt: 'T0', topics: vocab }], ['synd:config', { enabled: true, classify: 'ai' }]]);
    const kv = { get: async (k) => store.get(k) ?? null };
    const topicEnv = { SIGNUP_KV: kv, AI: { run: async () => wrap('DevOps') } };
    assert.equal(await suggestTopic(topicEnv, { title: 'nothing that matches a keyword' }), 'devops');
    const tagEnv = { SIGNUP_KV: kv, AI: { run: async () => wrap('wireguard, tailscale') } };
    assert.deepEqual(await suggestTags(tagEnv, { title: 'T', tags: ['Declared'] }), ['wireguard', 'tailscale']);
  });
}

test('analyzeItem never lets reasoning notes into the category or the summary', async () => {
  const reply = openai('<think>CATEGORY: Security\nSUMMARY: draft thought</think>\nCATEGORY: Hardware\nSUMMARY: A new GPU ships.');
  const r = await analyzeItem({ AI: { run: async () => reply } }, { title: 'x', contentText: 'y' });
  assert.equal(r.category, 'Hardware');
  assert.equal(r.digest, 'A new GPU ships.');
});

test('every caller asks for AI_TEXT_MODEL by default, and the AI_MODEL setting overrides it', async () => {
  const seen = [];
  const run = async (model) => { seen.push(model); return legacy('Security'); };
  const store = new Map([[TOPICS_MIRROR_KEY, { generatedAt: 'T0', topics: { security: { label: 'Security' } } }], ['synd:config', { classify: 'ai' }]]);
  const kv = { get: async (k) => store.get(k) ?? null };
  await classifyItem({ AI: { run } }, { title: 't' });
  await analyzeItem({ AI: { run } }, { title: 't' });
  await suggestTopic({ SIGNUP_KV: kv, AI: { run } }, { title: 't' });
  await suggestTags({ SIGNUP_KV: kv, AI: { run } }, { title: 't' });
  assert.deepEqual(seen, [AI_TEXT_MODEL, AI_TEXT_MODEL, AI_TEXT_MODEL, AI_TEXT_MODEL]);
  seen.length = 0;
  await classifyItem({ AI: { run }, AI_MODEL: '@cf/test/override' }, { title: 't' });
  assert.deepEqual(seen, ['@cf/test/override']);
});

test('the label calls leave a reasoning model room to answer', async () => {
  const budgets = {};
  const run = (name) => async (_m, opts) => { budgets[name] = opts.max_tokens; return legacy(''); };
  const store = new Map([[TOPICS_MIRROR_KEY, { generatedAt: 'T0', topics: { ai: { label: 'AI' } } }], ['synd:config', { classify: 'ai' }]]);
  const kv = { get: async (k) => store.get(k) ?? null };
  await classifyItem({ AI: { run: run('classify') } }, { title: 't' });
  await analyzeItem({ AI: { run: run('analyze') } }, { title: 't' });
  await suggestTopic({ SIGNUP_KV: kv, AI: { run: run('topic') } }, { title: 't' });
  await suggestTags({ SIGNUP_KV: kv, AI: { run: run('tags') } }, { title: 't' });
  assert.ok(budgets.classify >= 64, `classify ${budgets.classify}`);
  assert.ok(budgets.topic >= 64, `topic ${budgets.topic}`);
  assert.ok(budgets.tags >= 96, `tags ${budgets.tags}`);
  assert.ok(budgets.analyze >= 160, `analyze ${budgets.analyze}`);
});

// ---------- the retirement guard ----------

// Cloudflare's list for 2026-11-20 (https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/).
// After that date a call to any of these fails with HTTP 410, error 5028, and every caller here fails soft, so a
// stray reference would only show as quietly missing AI output. Add the next notice's list here when it arrives.
const RETIRED = [
  '@cf/myshell-ai/melotts', '@cf/stabilityai/stable-diffusion-xl-base-1.0', '@cf/runwayml/stable-diffusion-v1-5-inpainting',
  '@cf/bytedance/stable-diffusion-xl-lightning', '@cf/openai/whisper-tiny-en', '@cf/llava-hf/llava-1.5-7b-hf',
  '@cf/lykon/dreamshaper-8-lcm', '@cf/google/embeddinggemma-300m',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', '@cf/nvidia/nemotron-3-120b-a12b', '@cf/deepseek-ai/deepseek-v4-pro-0813',
  '@cf/deepseek-ai/deepseek-v4-flash-0731', '@cf/qwen/qwq-32b', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/moonshotai/kimi-k2.6',
  '@cf/moonshotai/kimi-k2.7-code', '@cf/zai-org/glm-5.2', '@cf/zai-org/glm-5.3-flash', '@cf/meta-llama/llama-2-7b-chat-hf-lora',
  '@cf/google/gemma-2b-it-lora', '@cf/google/gemma-7b-it-lora', '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/meta/llama-3.2-1b-instruct', '@cf/meta/llama-3.2-3b-instruct',
];

// THE ROLLBACK (2026-11-07). The replacement failed live, so production went back to the old model while the next
// candidate is proven. This one retired id is allowed in these two files only, and only BEFORE the day it stops
// answering. From 2026-11-20 this guard fails again, because from then on the setting names a model that is gone.
const ROLLBACK = { id: '@cf/meta/llama-3.2-3b-instruct', until: '2026-11-20', files: ['membership/ai-text.mjs', 'workers/signup/wrangler.toml'] };
function rollbackOpen(day = new Date().toISOString().slice(0, 10)) { return day < ROLLBACK.until; }
const allowedHit = (rel, id) => rollbackOpen() && id === ROLLBACK.id && ROLLBACK.files.includes(rel.split(path.sep).join('/'));

test('the rollback window closes on the day the old model stops answering', () => {
  assert.equal(rollbackOpen('2026-11-07'), true);
  assert.equal(rollbackOpen('2026-11-19'), true);
  assert.equal(rollbackOpen('2026-11-20'), false);
  assert.equal(rollbackOpen('2027-01-01'), false);
  assert.ok(RETIRED.includes(ROLLBACK.id), 'the rollback names a retired model, or it would not need an exception');
  // The exception covers one id in two files, never another retired id and never another file.
  assert.equal(allowedHit('membership/ai-text.mjs', '@cf/meta/llama-3.2-1b-instruct'), false);
  assert.equal(allowedHit('workers/signup/wrangler.toml', '@cf/qwen/qwq-32b'), false);
  assert.equal(allowedHit('workers/signup/topic-suggest.mjs', ROLLBACK.id), false);
});

const SCAN_ROOTS = ['membership', 'workers', 'scripts', 'src', 'client/src', 'client-ui/src', 'extension/src', 'clients', 'house', '.github'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.wt', '.astro', '.git', '.wrangler']);
const SCAN_EXT = /\.(mjs|cjs|js|ts|astro|toml|json|jsonc|ya?ml)$/;

function sourceFiles(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) sourceFiles(path.join(dir, e.name), out); }
    else if (SCAN_EXT.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

test('no source file names a Workers AI model Cloudflare retires on 2026-11-20', () => {
  const files = SCAN_ROOTS.flatMap((r) => sourceFiles(path.join(ROOT, r)));
  assert.ok(files.length > 200, `the scan found only ${files.length} files, so it is not looking where the code is`);
  assert.ok(files.some((f) => f.endsWith(path.join('news', 'src', 'classify.mjs'))), 'the scan reaches the news classifier');
  assert.ok(files.some((f) => f.endsWith(path.join('signup', 'wrangler.toml'))), 'the scan reaches the Worker settings');
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const id of RETIRED) {
      // A whole id only: `@cf/meta/llama-3.2-3b-instruct` must not match a longer, current id that starts with it.
      const re = new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`);
      if (re.test(text) && !allowedHit(path.relative(ROOT, f), id)) hits.push(`${path.relative(ROOT, f)}: ${id}`);
    }
  }
  assert.deepEqual(hits, []);
  assert.ok(!RETIRED.includes(AI_TEXT_MODEL) || (rollbackOpen() && AI_TEXT_MODEL === ROLLBACK.id),
    `the default model ${AI_TEXT_MODEL} is retired: prove a replacement with POST /membership/admin/ai-probe and set it`);
});

test('both Worker environments set AI_MODEL to AI_TEXT_MODEL', () => {
  const toml = fs.readFileSync(path.join(ROOT, 'workers/signup/wrangler.toml'), 'utf8');
  const values = [...toml.matchAll(/^AI_MODEL\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
  assert.equal(values.length, 2, 'top level and [env.production]');
  assert.deepEqual(values, [AI_TEXT_MODEL, AI_TEXT_MODEL]);
});
