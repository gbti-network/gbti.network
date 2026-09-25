import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLabel, keywordCategory, buildMessages, buildAnalysisMessages, parseAnalysis, analyzeItem, fitSummary, MAX_SUMMARY_CHARS } from '../workers/signup/news/src/classify.mjs';
import { CATEGORY_NAMES } from '../workers/signup/news/config/categories.mjs';

test('normalizeLabel matches exact labels (case-insensitive)', () => {
  assert.equal(normalizeLabel('Security'), 'Security');
  assert.equal(normalizeLabel('security'), 'Security');
  assert.equal(normalizeLabel('AI/ML'), 'AI/ML');
});

test('normalizeLabel recovers a label from a chatty reply', () => {
  assert.equal(normalizeLabel('The best category is Security.'), 'Security');
});

test('normalizeLabel returns null when nothing matches', () => {
  assert.equal(normalizeLabel('Sports'), null);
  assert.equal(normalizeLabel(''), null);
  assert.equal(normalizeLabel(undefined), null);
});

test('keywordCategory classifies obvious cases', () => {
  assert.equal(keywordCategory({ title: 'Critical CVE in OpenSSL exploited' }), 'Security');
  assert.equal(keywordCategory({ title: 'Acme raises $20M Series B' }), 'Business/Funding');
  assert.equal(keywordCategory({ title: 'Some unrelated cooking blog post' }), null);
});

test('buildMessages embeds every category name and the item', () => {
  const [system, user] = buildMessages({ title: 'T', summary: 'S' });
  assert.equal(system.role, 'system');
  for (const name of CATEGORY_NAMES) assert.ok(system.content.includes(name), `missing ${name}`);
  assert.ok(user.content.includes('T'));
  assert.ok(user.content.includes('S'));
});

// ---- SOW-046 A: combined classify + summarize ----

test('buildAnalysisMessages prefers the full contentText over the short excerpt', () => {
  const [system, user] = buildAnalysisMessages({ title: 'T', summary: 'short', contentText: 'the full article body' });
  assert.match(system.content, /CATEGORY:/);
  assert.match(system.content, /SUMMARY:/);
  assert.ok(user.content.includes('the full article body'));
  // falls back to the excerpt when no contentText
  const [, user2] = buildAnalysisMessages({ title: 'T', summary: 'short' });
  assert.ok(user2.content.includes('short'));
});

test('parseAnalysis extracts the category from its OWN line and the summary text', () => {
  const r = parseAnalysis('CATEGORY: Security\nSUMMARY: A critical bug was patched today.');
  assert.equal(r.category, 'Security');
  assert.equal(r.digest, 'A critical bug was patched today.');
});

test('parseAnalysis does not let a category word inside the summary hijack the label', () => {
  // the labelled CATEGORY line is AI/ML; "security" only appears inside the summary prose
  const r = parseAnalysis('CATEGORY: AI/ML\nSUMMARY: The model improves security posture for everyone.');
  assert.equal(r.category, 'AI/ML');
  assert.match(r.digest, /improves security posture/);
});

test('parseAnalysis fails closed per field on a malformed reply', () => {
  assert.deepEqual(parseAnalysis('here is some unrelated chatter'), { category: null, digest: null });
  // a summary but no parseable category
  const r = parseAnalysis('SUMMARY: just a summary, no category line');
  assert.equal(r.category, null);
  assert.equal(r.digest, 'just a summary, no category line');
  assert.deepEqual(parseAnalysis(''), { category: null, digest: null });
});

test('parseAnalysis strips wrapping quotes and collapses whitespace', () => {
  const r = parseAnalysis('CATEGORY: Hardware\nSUMMARY:   "A new   GPU   ships."  ');
  assert.equal(r.digest, 'A new GPU ships.');
});

test('analyzeItem: a good AI reply yields category + digest (one AI call)', async () => {
  let calls = 0;
  const env = { AI: { run: async () => { calls++; return { response: 'CATEGORY: DevOps/Cloud\nSUMMARY: Kubernetes 2.0 ships with a new scheduler.' }; } } };
  const r = await analyzeItem(env, { title: 'k8s 2.0', contentText: 'long body about kubernetes' });
  assert.equal(calls, 1, 'exactly one AI call (classify + summarize combined)');
  assert.equal(r.category, 'DevOps/Cloud');
  assert.equal(r.classified, true);
  assert.match(r.digest, /Kubernetes 2.0/);
  assert.equal(r.summarized, true);
});

test('analyzeItem: fail-closed per field — bad category falls back to keyword, missing summary -> null', async () => {
  // AI returns an off-list category but a usable summary
  const env = { AI: { run: async () => ({ response: 'CATEGORY: Sports\nSUMMARY: A CVE was exploited in the wild.' }) } };
  const r = await analyzeItem(env, { title: 'Critical CVE in OpenSSL exploited', summary: 'cve' });
  assert.equal(r.classified, false); // no valid AI category
  assert.equal(r.category, 'Security'); // keyword fallback from the title
  assert.equal(r.summarized, true);
  assert.match(r.digest, /CVE was exploited/);
});

test('analyzeItem: an AI throw fails closed to keyword/default, no digest', async () => {
  const env = { AI: { run: async () => { throw new Error('ai down'); } } };
  const r = await analyzeItem(env, { title: 'Acme raises $20M Series B', summary: 'x' });
  assert.equal(r.classified, false);
  assert.equal(r.category, 'Business/Funding');
  assert.equal(r.digest, null);
  assert.equal(r.summarized, false);
});

// sow-402 (owner, 2026-09-24): "all future news summaries that are AI generated are under 150 chars", and when the
// model runs long, trim at a clean point (whole sentences, else a whole word with an ellipsis), never mid-word.
const endsClean = (t) => /[.!?"'’”)\]]$/.test(t) || /[A-Za-z0-9]…$/.test(t);

test('sow-402: the limit is under 150 characters, and the prompt asks for it', () => {
  assert.equal(MAX_SUMMARY_CHARS, 149);
  const [system] = buildAnalysisMessages({ title: 'T', summary: 'S' });
  assert.match(system.content, /SUMMARY: <one plain sentence under 150 characters/);
});

test('sow-402: fitSummary leaves a short summary untouched', () => {
  assert.equal(fitSummary('Acme shipped a faster build tool.'), 'Acme shipped a faster build tool.');
  assert.equal(fitSummary('   '), null);
  assert.equal(fitSummary(null), null);
});

test('sow-402: over the limit, the whole sentences that fit are kept and the rest dropped', () => {
  const first = 'Google Cloud API Gateway now serves REST APIs as MCP tools.';
  const second = 'Teams can expose existing specifications to AI agents without writing custom middleware for each one.';
  const out = fitSummary(`${first} ${second}`);
  assert.equal(out, first);
  // Six short sentences: the first five fit (141 characters), the sixth would overflow, so it goes.
  const d = 'More detail follows here and goes on.';
  const out2 = fitSummary(`It ships today. It is free. ${d} ${d} ${d} ${d}`);
  assert.equal(out2, `It ships today. It is free. ${d} ${d} ${d}`);
  assert.equal(out2.length, 141);
});

test('sow-402: a single over-long sentence ends on a whole word with an ellipsis, within the limit', () => {
  const long = 'Google Cloud API Gateway now acts as a native remote Model Context Protocol server, eliminating the need to build and maintain custom middleware to expose REST APIs to AI agents by adding annotations';
  const out = fitSummary(long);
  assert.ok(out.length <= 149, `too long: ${out.length}`);
  assert.ok(out.endsWith('…'));
  const body = out.slice(0, -1);
  assert.ok(long.startsWith(body), 'the kept text is a prefix of the original');
  assert.equal(long[body.length], ' ', 'the cut landed inside a word');
  assert.ok(!/[,;:]$/.test(body), 'the text should not end on a comma before the ellipsis');
});

test('sow-402: "v2.0" and "e.g. this" do not count as sentence ends', () => {
  const s = 'Version 2.0 of the toolkit adds streaming, e.g. token by token, plus retries and a new plugin system that lets teams extend the runtime without forking it at all.';
  const out = fitSummary(s);
  assert.ok(out.length <= 149);
  assert.ok(out.endsWith('…'), `expected a word cut, got a false sentence end: ${out}`);
  assert.ok(!out.startsWith('Version 2.') || out.length > 11);
});

test('sow-402: parseAnalysis applies the limit to a long model reply, on a clean boundary', () => {
  const reply = 'CATEGORY: AI/ML\nSUMMARY: ' + 'Researchers released an open model that matches much larger systems on coding benchmarks while running on a single consumer graphics card, and they published the weights, the training recipe and an evaluation harness so other teams can reproduce every result.';
  const { category, digest } = parseAnalysis(reply);
  assert.equal(category, 'AI/ML');
  assert.ok(digest.length <= 149, `digest is ${digest.length} characters`);
  assert.ok(endsClean(digest), `digest ends mid-word: ${digest}`);
});
