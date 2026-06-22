// SOW-055: the pure category-manager edit core (add + rename-label). No fs, no yaml, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCategory, renameLabel, nodeAt, TaxonomyEditError } from '../membership/taxonomy-edits.mjs';

const NOW = new Date('2026-06-22T00:00:00Z');
const CTX = { actor: { githubId: '2002207', login: 'atwellpub' }, now: NOW };
const base = () => ({ tree: { devops: { label: 'DevOps', children: { frameworks: { label: 'Frameworks', children: { react: { label: 'React' } } } } }, ai: { label: 'AI' } } });

test('nodeAt resolves a nested path and returns null for a miss', () => {
  const t = base();
  assert.equal(nodeAt(t, ['devops', 'frameworks', 'react']).label, 'React');
  assert.equal(nodeAt(t, ['devops', 'nope']), null);
  assert.equal(nodeAt(t, []), null);
});

test('addCategory: top-level add', () => {
  const t = base();
  const { next, changed, audit } = addCategory(t, { key: 'blockchain', label: 'Blockchain' }, CTX);
  assert.equal(changed, true);
  assert.equal(next.tree.blockchain.label, 'Blockchain');
  assert.deepEqual(audit.target.path, ['blockchain']);
  assert.equal(audit.actor.login, 'atwellpub');
  assert.equal(audit.action, 'taxonomy.add');
  // input not mutated
  assert.equal(t.tree.blockchain, undefined);
});

test('addCategory: nested add creates the parent children map when absent', () => {
  const t = base();
  const r = addCategory(t, { parentPath: ['ai'], key: 'llms', label: 'LLMs' }, CTX); // ai is a leaf -> gains children
  assert.equal(r.changed, true);
  assert.equal(r.next.tree.ai.children.llms.label, 'LLMs');
  // existing nested parent
  const r2 = addCategory(t, { parentPath: ['devops', 'frameworks'], key: 'vue', label: 'Vue' }, CTX);
  assert.equal(r2.next.tree.devops.children.frameworks.children.vue.label, 'Vue');
});

test('addCategory: idempotent re-add is a no-op; a clashing label errors', () => {
  const t = base();
  const once = addCategory(t, { key: 'blockchain', label: 'Blockchain' }, CTX).next;
  const again = addCategory(once, { key: 'blockchain', label: 'Blockchain' }, CTX);
  assert.equal(again.changed, false);
  assert.throws(() => addCategory(once, { key: 'blockchain', label: 'Web3' }, CTX), TaxonomyEditError);
});

test('addCategory: rejects a bad key, missing label, missing parent', () => {
  const t = base();
  assert.throws(() => addCategory(t, { key: 'Not Kebab', label: 'x' }, CTX), TaxonomyEditError);
  assert.throws(() => addCategory(t, { key: 'ok', label: '  ' }, CTX), TaxonomyEditError);
  assert.throws(() => addCategory(t, { parentPath: ['ghost'], key: 'ok', label: 'OK' }, CTX), TaxonomyEditError);
});

test('renameLabel: changes the label, leaves the key/path unchanged', () => {
  const t = base();
  const { next, changed, audit } = renameLabel(t, { path: ['devops', 'frameworks'], label: 'Frameworks & Libs' }, CTX);
  assert.equal(changed, true);
  assert.equal(next.tree.devops.children.frameworks.label, 'Frameworks & Libs');
  assert.ok(next.tree.devops.children.frameworks.children.react, 'children preserved'); // path/structure intact
  assert.deepEqual(audit.target.path, ['devops', 'frameworks']);
  assert.equal(t.tree.devops.children.frameworks.label, 'Frameworks'); // input not mutated
});

test('renameLabel: idempotent when the label already matches; errors on a missing path', () => {
  const t = base();
  assert.equal(renameLabel(t, { path: ['ai'], label: 'AI' }, CTX).changed, false);
  assert.throws(() => renameLabel(t, { path: ['nope'], label: 'X' }, CTX), TaxonomyEditError);
  assert.throws(() => renameLabel(t, { path: [], label: 'X' }, CTX), TaxonomyEditError);
});
