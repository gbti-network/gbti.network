// SOW-100: the categories-workspace pure core. Tree flatten, count rollup (descendants + empties + orphans),
// channel status, the pending set (dedupe + batch plan), pagination windows. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenTree, countRollup, channelStatusFor, channelFor,
  opId, upsertOp, describeOp, batchPlan, pageWindow, paginate, relAge,
} from '../client-ui/src/categories-core.mjs';

const TREE = {
  devops: { label: 'DevOps', children: { frameworks: { label: 'Frameworks', children: { wordpress: { label: 'WordPress' } } }, hosting: { label: 'Hosting' } } },
  ai: { label: 'AI' },
};

test('flattenTree: ordered nodes with paths, levels, hasChildren', () => {
  const flat = flattenTree(TREE);
  assert.deepEqual(flat.map((n) => n.path.join('/')), ['devops', 'devops/frameworks', 'devops/frameworks/wordpress', 'devops/hosting', 'ai']);
  assert.equal(flat[0].hasChildren, true);
  assert.equal(flat[2].level, 2);
  assert.equal(flat[4].hasChildren, false);
});

test('countRollup: descendants roll up to every ancestor; empty nodes stay 0; orphan paths count nowhere', () => {
  const items = {
    post: [
      { categories: ['devops', 'frameworks', 'wordpress'] },
      { categories: ['devops', 'hosting'] },
      { categories: ['ghost-category'] }, // orphaned: not in the tree
    ],
    prompt: [{ categories: ['devops'] }],
    product: [],
  };
  const c = countRollup(TREE, items);
  assert.deepEqual(c.get('devops'), { post: 2, prompt: 1, product: 0, total: 3 });
  assert.deepEqual(c.get('devops/frameworks'), { post: 1, prompt: 0, product: 0, total: 1 });
  assert.deepEqual(c.get('devops/frameworks/wordpress'), { post: 1, prompt: 0, product: 0, total: 1 });
  assert.deepEqual(c.get('ai'), { post: 0, prompt: 0, product: 0, total: 0 }); // empty renders 0
  assert.equal(c.has('ghost-category'), false);
});

test('channel status: pending op wins as review; pool presence is synced; else none (case-insensitive)', () => {
  const pool = [{ category: 'devops', channelId: '123' }];
  assert.equal(channelStatusFor('DevOps', pool, []), 'synced');
  assert.equal(channelStatusFor('ai', pool, []), 'none');
  assert.equal(channelStatusFor('ai', pool, [{ kind: 'channel-set', args: { category: 'ai', channelId: '9' } }]), 'review');
  assert.equal(channelStatusFor('devops', pool, [{ kind: 'channel-remove', args: { category: 'devops' } }]), 'review');
  assert.equal(channelFor('devops', pool), '123');
  assert.equal(channelFor('ai', pool), null);
});

test('pending set: re-edits replace by id; set-over-remove replaces; batchPlan splits by house file', () => {
  const pending = new Map();
  upsertOp(pending, { kind: 'label', args: { path: ['devops'], label: 'Dev Ops' } });
  upsertOp(pending, { kind: 'label', args: { path: ['devops'], label: 'DevOps and Cloud' } }); // replaces
  upsertOp(pending, { kind: 'channel-remove', args: { category: 'ai' } });
  upsertOp(pending, { kind: 'channel-set', args: { category: 'ai', channelId: '55' } }); // replaces the remove
  upsertOp(pending, { kind: 'add', args: { parentPath: ['devops'], key: 'observability', label: 'Observability' } });
  assert.equal(pending.size, 3);
  const plan = batchPlan(pending);
  assert.equal(plan.count, 3);
  assert.equal(plan.taxonomy.length, 2);
  assert.equal(plan.channels.length, 1);
  assert.equal(plan.channels[0].args.channelId, '55');
  assert.match(describeOp(plan.taxonomy[0]), /DevOps and Cloud/);
  assert.equal(opId({ kind: 'add', args: { parentPath: null, key: 'x' } }), 'add:x');
});

test('pageWindow + paginate: short lists plain, long lists windowed with ellipses', () => {
  assert.deepEqual(pageWindow(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(5, 12), [1, 2, '…', 4, 5, 6, '…', 11, 12]);
  const p = paginate(Array.from({ length: 20 }, (_, i) => i), 2, 6);
  assert.deepEqual([p.page, p.pages, p.from, p.to, p.total], [2, 4, 7, 12, 20]);
  assert.equal(paginate([], 3, 6).from, 0);
  assert.equal(paginate([1], 99, 6).page, 1); // clamped
});

test('relAge buckets', () => {
  const now = Date.parse('2026-07-07T12:00:00Z');
  assert.equal(relAge(now - 3600e3, now), 'today');
  assert.equal(relAge(now - 5 * 86400e3, now), '5d ago');
  assert.equal(relAge(now - 90 * 86400e3, now), '3mo ago');
  assert.equal(relAge(null, now), '');
});
