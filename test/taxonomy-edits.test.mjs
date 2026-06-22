// SOW-055: the pure category-manager edit core (add + rename-label). No fs, no yaml, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCategory, renameLabel, renameKey, moveCategory, removeCategory, rewriteCategories, pathStartsWith, nodeAt, TaxonomyEditError } from '../membership/taxonomy-edits.mjs';

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

// ---- SOW-055 Phase 2: path-changing ops + content migration ----

test('renameKey: swaps the key in place (order + children preserved) and reports the pathChange', () => {
  const t = base();
  const { next, changed, pathChange } = renameKey(t, { path: ['devops', 'frameworks'], newKey: 'libs' }, CTX);
  assert.equal(changed, true);
  assert.equal(next.tree.devops.children.libs.label, 'Frameworks');
  assert.ok(next.tree.devops.children.libs.children.react, 'subtree preserved');
  assert.equal(next.tree.devops.children.frameworks, undefined);
  assert.deepEqual(Object.keys(next.tree.devops.children), ['libs'], 'order/position preserved');
  assert.deepEqual(pathChange, { kind: 'rename', from: ['devops', 'frameworks'], to: ['devops', 'libs'] });
  assert.equal(t.tree.devops.children.frameworks.label, 'Frameworks'); // input not mutated
});

test('renameKey: idempotent, sibling clash, bad key, missing path', () => {
  const t = base();
  assert.equal(renameKey(t, { path: ['ai'], newKey: 'ai' }, CTX).changed, false);
  const t2 = addCategory(base(), { parentPath: ['devops'], key: 'libs', label: 'Libs' }, CTX).next;
  assert.throws(() => renameKey(t2, { path: ['devops', 'frameworks'], newKey: 'libs' }, CTX), TaxonomyEditError); // clash
  assert.throws(() => renameKey(t, { path: ['ai'], newKey: 'Bad Key' }, CTX), TaxonomyEditError);
  assert.throws(() => renameKey(t, { path: ['nope'], newKey: 'x' }, CTX), TaxonomyEditError);
});

test('moveCategory: reparents a node, removes it from the source, reports the pathChange', () => {
  const t = base();
  const { next, changed, pathChange } = moveCategory(t, { fromPath: ['devops', 'frameworks'], toParentPath: [] }, CTX);
  assert.equal(changed, true);
  assert.equal(next.tree.frameworks.label, 'Frameworks');
  assert.ok(next.tree.frameworks.children.react, 'subtree moved with it');
  assert.equal(next.tree.devops.children.frameworks, undefined, 'removed from source');
  assert.deepEqual(pathChange, { kind: 'move', from: ['devops', 'frameworks'], to: ['frameworks'] });
});

test('moveCategory: no-op (same parent), under-itself, destination clash, missing', () => {
  const t = base();
  assert.equal(moveCategory(t, { fromPath: ['devops', 'frameworks'], toParentPath: ['devops'] }, CTX).changed, false); // same parent
  assert.throws(() => moveCategory(t, { fromPath: ['devops'], toParentPath: ['devops', 'frameworks'] }, CTX), TaxonomyEditError); // under descendant
  const t2 = addCategory(base(), { key: 'frameworks', label: 'FW' }, CTX).next; // top-level "frameworks" already exists
  assert.throws(() => moveCategory(t2, { fromPath: ['devops', 'frameworks'], toParentPath: [] }, CTX), TaxonomyEditError); // clash
  assert.throws(() => moveCategory(t, { fromPath: ['ghost'], toParentPath: [] }, CTX), TaxonomyEditError);
});

test('removeCategory: removes the node; reassignToParent sets the pathChange target', () => {
  const t = base();
  const r1 = removeCategory(t, { path: ['devops', 'frameworks'] }, CTX);
  assert.equal(r1.next.tree.devops.children.frameworks, undefined);
  assert.deepEqual(r1.pathChange, { kind: 'remove', from: ['devops', 'frameworks'], to: null });
  const r2 = removeCategory(base(), { path: ['devops', 'frameworks'], reassignToParent: true }, CTX);
  assert.deepEqual(r2.pathChange, { kind: 'remove', from: ['devops', 'frameworks'], to: ['devops'] });
  assert.throws(() => removeCategory(t, { path: ['nope'] }, CTX), TaxonomyEditError);
});

test('rewriteCategories: move/rename relocate the prefix and preserve deeper segments', () => {
  // unchanged when not under the path
  assert.equal(rewriteCategories(['ai'], { kind: 'move', from: ['devops', 'frameworks'], to: ['frameworks'] }), undefined);
  // move: deeper segments preserved
  assert.deepEqual(rewriteCategories(['devops', 'frameworks', 'react'], { kind: 'move', from: ['devops', 'frameworks'], to: ['frameworks'] }), ['frameworks', 'react']);
  // exact-match item relocates to the new path
  assert.deepEqual(rewriteCategories(['devops', 'frameworks'], { kind: 'move', from: ['devops', 'frameworks'], to: ['frameworks'] }), ['frameworks']);
  // rename: prefix swapped, deeper preserved
  assert.deepEqual(rewriteCategories(['devops', 'frameworks', 'react', 'hooks'], { kind: 'rename', from: ['devops', 'frameworks'], to: ['devops', 'libs'] }), ['devops', 'libs', 'react', 'hooks']);
});

test('rewriteCategories: remove orphans (null) without reassign, reattaches the subtree to the parent with reassign', () => {
  // no reassign -> orphan signal
  assert.equal(rewriteCategories(['devops', 'frameworks', 'react'], { kind: 'remove', from: ['devops', 'frameworks'], to: null }), null);
  // reassign -> the WHOLE affected subtree collapses to the parent (removed segments are gone)
  assert.deepEqual(rewriteCategories(['devops', 'frameworks', 'react'], { kind: 'remove', from: ['devops', 'frameworks'], to: ['devops'] }), ['devops']);
  assert.deepEqual(rewriteCategories(['devops', 'frameworks'], { kind: 'remove', from: ['devops', 'frameworks'], to: ['devops'] }), ['devops']);
  // removing a TOP-LEVEL category with reassign -> uncategorized ([])
  assert.deepEqual(rewriteCategories(['ai', 'llms'], { kind: 'remove', from: ['ai'], to: [] }), []);
  // not under the path -> unchanged
  assert.equal(rewriteCategories(['ai'], { kind: 'remove', from: ['devops'], to: null }), undefined);
});

test('pathStartsWith', () => {
  assert.equal(pathStartsWith(['devops', 'frameworks', 'react'], ['devops', 'frameworks']), true);
  assert.equal(pathStartsWith(['devops'], ['devops', 'frameworks']), false);
  assert.equal(pathStartsWith(['ai'], ['devops']), false);
});
