// sow-493: POST /membership/admin/ai-probe, the superadmin route that shows a Workers AI model's raw reply. The
// replacement model failed live with no way to see why, because every caller fails soft and no local credential can
// call Workers AI. These tests pin the gate, the input bounds, and that the raw reply, the read text and the parse
// all come back, including when the call throws. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { membershipAdminAiProbe, probeInput, rawPreview, PROBE_MAX_TOKENS } from '../workers/signup/membership-admin-ai-probe.mjs';
import { AI_TEXT_MODEL } from '../membership/ai-text.mjs';

const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const allow = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const deny = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const req = (body) => ({ json: async () => (typeof body === 'function' ? body() : body) });

function aiEnv(reply) {
  const calls = [];
  return { calls, env: { AI: { run: async (model, input) => { calls.push({ model, input }); return typeof reply === 'function' ? reply() : reply; } } } };
}

test('a caller who is not a superadmin is refused before any model call', async () => {
  const { env, calls } = aiEnv({ response: 'Security' });
  const r = await membershipAdminAiProbe(req({ model: GEMMA }), env, { authorize: deny });
  assert.equal(r.status, 403);
  assert.equal(calls.length, 0);
});

test('the probe returns the raw reply, the text read from it, and what the caller would parse', async () => {
  const reply = { choices: [{ message: { content: '<think>a release note</think>DevOps/Cloud' } }], usage: { completion_tokens: 9 } };
  const { env, calls } = aiEnv(reply);
  let t = 1000;
  const r = await membershipAdminAiProbe(req({ model: GEMMA, task: 'classify' }), env, { authorize: allow, now: () => (t += 250) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.model, GEMMA);
  assert.equal(r.body.text, 'DevOps/Cloud');
  assert.deepEqual(r.body.parsed, { label: 'DevOps/Cloud' });
  assert.match(r.body.raw, /<think>a release note<\/think>/, 'the raw reply is shown as it came, reasoning included');
  assert.equal(r.body.ms, 250);
  assert.deepEqual(r.body.settings, { max_tokens: 64, temperature: 0, chat_template_kwargs: { enable_thinking: false } }, 'production defaults');
  assert.equal(calls[0].model, GEMMA);
  assert.ok(Array.isArray(calls[0].input.messages) && calls[0].input.messages.length === 2);
});

test('analyze and tags parse as the news and share callers do', async () => {
  const a = aiEnv({ response: 'CATEGORY: DevOps/Cloud\nSUMMARY: Kubernetes 1.36 ships a new scheduler.' });
  const ra = await membershipAdminAiProbe(req({ task: 'analyze' }), a.env, { authorize: allow });
  assert.deepEqual(ra.body.parsed, { category: 'DevOps/Cloud', digest: 'Kubernetes 1.36 ships a new scheduler.' });
  assert.equal(ra.body.settings.max_tokens, 160);
  assert.equal(ra.body.model, AI_TEXT_MODEL, 'no model given means the current setting');
  const t = aiEnv({ response: 'kubernetes, scheduler, cloud-providers' });
  const rt = await membershipAdminAiProbe(req({ task: 'tags' }), t.env, { authorize: allow });
  assert.deepEqual(rt.body.parsed, { tags: ['kubernetes', 'scheduler', 'cloud-providers'] });
  assert.equal(rt.body.settings.max_tokens, 96);
});

test('a call that throws comes back as the result, with the error text', async () => {
  const { env } = aiEnv(() => { throw new Error('5028: model is deprecated'); });
  const r = await membershipAdminAiProbe(req({ model: GEMMA }), env, { authorize: allow });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /5028/);
});

test('settings under test reach the model exactly, and replace the default budget', async () => {
  const { env, calls } = aiEnv({ response: 'x' });
  await membershipAdminAiProbe(req({ model: GEMMA, max_completion_tokens: 300, temperature: 0.2, chat_template_kwargs: { enable_thinking: true } }), env, { authorize: allow });
  const input = calls[0].input;
  assert.equal(input.max_completion_tokens, 300);
  assert.equal(input.max_tokens, undefined, 'the default budget is not sent beside an explicit one');
  assert.equal(input.temperature, 0.2);
  assert.deepEqual(input.chat_template_kwargs, { enable_thinking: true }, 'an explicit setting replaces the production default');
});

test('probeInput refuses what it cannot pass through faithfully', () => {
  const bad = [
    null, [], 'x',
    { model: 'llama' }, { model: '@cf/a' }, { model: '@cf/x/y z' }, { model: 'https://evil/@cf/x/y' }, { model: 7 },
    { task: 'summarize' }, { task: 'constructor' },
    { max_tokens: 0 }, { max_tokens: PROBE_MAX_TOKENS + 1 }, { max_tokens: 1.5 }, { max_completion_tokens: '64' },
    { temperature: -1 }, { temperature: 3 }, { temperature: '0' },
    { chat_template_kwargs: 'x' }, { chat_template_kwargs: [] }, { chat_template_kwargs: { a: 1, b: 2, c: 3, d: 4, e: 5 } },
    { chat_template_kwargs: { nested: { x: 1 } } }, { chat_template_kwargs: { s: 'x'.repeat(41) } },
    { prompt: 'free text' }, { messages: [] },
  ];
  for (const b of bad) assert.ok(probeInput(b).error, JSON.stringify(b));
  assert.equal(probeInput({ max_tokens: PROBE_MAX_TOKENS }).input.max_tokens, PROBE_MAX_TOKENS);
  assert.equal(probeInput({ model: GEMMA }).model, GEMMA);
});

test('the route refuses a body that is not JSON, and a missing binding', async () => {
  const { env } = aiEnv({ response: 'x' });
  const r = await membershipAdminAiProbe(req(() => { throw new SyntaxError('bad'); }), env, { authorize: allow });
  assert.equal(r.status, 400);
  const none = await membershipAdminAiProbe(req({}), {}, { authorize: allow });
  assert.equal(none.status, 503);
});

test('rawPreview shows any reply and cuts a long one', () => {
  assert.equal(rawPreview({ a: 1 }), '{"a":1}');
  assert.equal(rawPreview('plain'), 'plain');
  assert.equal(rawPreview(undefined), 'undefined');
  const long = rawPreview({ s: 'x'.repeat(7000) });
  assert.ok(long.length < 6100 && /characters\)$/.test(long));
});

test('the admin router serves the probe at /membership/admin/ai-probe, POST only, never cached', () => {
  const src = fs.readFileSync(new URL('../workers/signup/admin-routes.mjs', import.meta.url), 'utf8');
  const i = src.indexOf("pathname === '/membership/admin/ai-probe'");
  assert.ok(i > 0);
  const block = src.slice(i, src.indexOf('\n  }\n', i));
  assert.match(block, /membershipAdminAiProbe\(request, env, \{ allowCookie: true \}\)/);
  assert.match(block, /method === 'POST'/);
  assert.doesNotMatch(block, /method === 'GET'/);
  assert.match(block, /'Cache-Control': 'no-store'/);
});
