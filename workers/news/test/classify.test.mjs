import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLabel, keywordCategory, buildMessages } from '../src/classify.mjs';
import { CATEGORY_NAMES } from '../config/categories.mjs';

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
