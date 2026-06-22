// SOW-055 Phase 2: the pure migration planner (composes the tree edit + the content-categories rewrites + the
// orphan-refusal). No fs, no network — contentItems are passed in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCategoryMigration } from '../scripts/migrate-category.mjs';

const taxonomy = () => ({ tree: { devops: { label: 'DevOps', children: { frameworks: { label: 'Frameworks', children: { react: { label: 'React' } } } } }, ai: { label: 'AI' } } });
const items = () => ([
  { path: 'members/a/posts/p1/index.md', categories: ['devops', 'frameworks', 'react'] },
  { path: 'members/a/posts/p2/index.md', categories: ['devops', 'frameworks'] },
  { path: 'house/posts/p3/index.md', categories: ['ai'] },                 // unaffected by devops changes
  { path: 'members/b/products/x/index.md', categories: [] },               // uncategorized
]);

test('plan move: rewrites affected items, leaves others, edits the tree', () => {
  const plan = planCategoryMigration(taxonomy(), items(), { action: 'move', from: ['devops', 'frameworks'], toParentPath: [] });
  assert.equal(plan.changed, true);
  assert.equal(plan.orphaned.length, 0);
  assert.equal(plan.nextTaxonomy.tree.frameworks.label, 'Frameworks'); // moved to top
  const byPath = Object.fromEntries(plan.rewrites.map((r) => [r.path, r.categories]));
  assert.deepEqual(byPath['members/a/posts/p1/index.md'], ['frameworks', 'react']);
  assert.deepEqual(byPath['members/a/posts/p2/index.md'], ['frameworks']);
  assert.equal(byPath['house/posts/p3/index.md'], undefined); // ai unaffected
});

test('plan rename: rewrites the renamed prefix', () => {
  const plan = planCategoryMigration(taxonomy(), items(), { action: 'rename', from: ['devops', 'frameworks'], newKey: 'libs' });
  const byPath = Object.fromEntries(plan.rewrites.map((r) => [r.path, r.categories]));
  assert.deepEqual(byPath['members/a/posts/p1/index.md'], ['devops', 'libs', 'react']);
  assert.deepEqual(byPath['members/a/posts/p2/index.md'], ['devops', 'libs']);
});

test('plan remove WITHOUT reassign + references -> orphaned (the caller must refuse)', () => {
  const plan = planCategoryMigration(taxonomy(), items(), { action: 'remove', from: ['devops', 'frameworks'] });
  assert.deepEqual(plan.orphaned.sort(), ['members/a/posts/p1/index.md', 'members/a/posts/p2/index.md']);
  assert.equal(plan.rewrites.length, 0);
});

test('plan remove WITH reassign -> reattaches affected content to the parent, no orphans', () => {
  const plan = planCategoryMigration(taxonomy(), items(), { action: 'remove', from: ['devops', 'frameworks'], reassignToParent: true });
  assert.equal(plan.orphaned.length, 0);
  const byPath = Object.fromEntries(plan.rewrites.map((r) => [r.path, r.categories]));
  assert.deepEqual(byPath['members/a/posts/p1/index.md'], ['devops']);
  assert.deepEqual(byPath['members/a/posts/p2/index.md'], ['devops']);
  assert.equal(plan.nextTaxonomy.tree.devops.children.frameworks, undefined);
});

test('plan remove of a category with NO references is clean', () => {
  const plan = planCategoryMigration(taxonomy(), [{ path: 'house/posts/p3/index.md', categories: ['ai'] }], { action: 'remove', from: ['devops', 'frameworks'] });
  assert.equal(plan.orphaned.length, 0);
  assert.equal(plan.rewrites.length, 0);
  assert.equal(plan.changed, true);
});
