// SOW-007/008: assembling the planner's per-content maps from the ledger + content index + ledgers (pure).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assembleDistributionInputs, readContentIndex } from '../scripts/lib/distribution-gather.mjs';
import { membersIndexFromParsed } from '../membership/overrides.mjs';
import { AWARD_STATUS } from '../membership/points.mjs';

const NOW = Date.parse('2026-06-04T00:00:00Z');
const membersIndex = membersIndexFromParsed({ members: { '100': 'alice', '200': 'bob', '300': 'carol' } });

const entries = [{ state: 'payable', amount: 4500, currency: 'usd', invoiceId: 'in_a', referrerGithubId: '100', via: 'post:hello' }];
// 1 ledger point per accepted contribution (points.mjs); contributorsForContent scales it to the 7-point weight.
const awards = [{ contributor_github_id: '200', target: { type: 'post', slug: 'hello' }, points: 1, status: AWARD_STATUS.awarded }];
const comments = [{ author: 'carol', targetType: 'post', targetSlug: 'hello', status: 'published', createdAt: '2026-05-30T00:00:00Z' }];

test('assembles delegation + contributors + commenters and the trusted owner for a delegating content', () => {
  const contentIndex = new Map([['post:hello', { author: 'alice', delegation: { contributions: 0.07, comments: 0.03 } }]]);
  const out = assembleDistributionInputs({ entries, contentIndex, awards, comments, membersIndex, bannedGithubIds: new Set(), nowMs: NOW });

  assert.equal(out.contentOwnerByVia.get('post:hello'), '100'); // alice -> 100
  assert.deepEqual(out.delegationByContent.get('post:hello'), { contributions: 0.07, comments: 0.03 });
  assert.deepEqual(out.contributorsByContent.get('post:hello'), [{ id: '200', points: 7 }]);
  assert.equal(out.commentsByContent.get('post:hello')[0].id, '300');
  assert.deepEqual([...out.delegateIds].sort(), ['200', '300']);
});

test('content with zero delegation is skipped entirely (owner keeps 100%)', () => {
  const contentIndex = new Map([['post:hello', { author: 'alice', delegation: { contributions: 0, comments: 0 } }]]);
  const out = assembleDistributionInputs({ entries, contentIndex, awards, comments, membersIndex, bannedGithubIds: new Set(), nowMs: NOW });
  assert.equal(out.delegationByContent.size, 0);
  assert.equal(out.delegateIds.size, 0);
});

test('unknown content (not in the index) is skipped', () => {
  const out = assembleDistributionInputs({ entries, contentIndex: new Map(), awards, comments, membersIndex, bannedGithubIds: new Set(), nowMs: NOW });
  assert.equal(out.contentOwnerByVia.size, 0);
});

test('content whose author cannot be resolved to a github_id is skipped (cannot trust the split)', () => {
  const contentIndex = new Map([['post:hello', { author: 'ghost', delegation: { contributions: 0.07, comments: 0 } }]]);
  const out = assembleDistributionInputs({ entries, contentIndex, awards, comments, membersIndex, bannedGithubIds: new Set(), nowMs: NOW });
  assert.equal(out.contentOwnerByVia.size, 0);
});

test('SOW-016: a Mode A item (members-only, no public stub) is excluded from delegation entirely', () => {
  const contentIndex = new Map([['post:hello', { author: 'alice', delegation: { contributions: 0.07, comments: 0.03 }, visibility: 'members', publicStub: false }]]);
  const out = assembleDistributionInputs({ entries, contentIndex, awards, comments, membersIndex, bannedGithubIds: new Set(), nowMs: NOW });
  assert.equal(out.delegationByContent.size, 0, 'a Mode A target earns no referral share, so its pools are empty');
  assert.equal(out.delegateIds.size, 0);
});

test('SOW-016: a Mode B stub (members-only WITH a public stub) still participates in delegation', () => {
  const contentIndex = new Map([['post:hello', { author: 'alice', delegation: { contributions: 0.07, comments: 0.03 }, visibility: 'members', publicStub: true }]]);
  const out = assembleDistributionInputs({ entries, contentIndex, awards, comments, membersIndex, bannedGithubIds: new Set(), nowMs: NOW });
  assert.equal(out.delegationByContent.get('post:hello').comments, 0.03);
  assert.deepEqual(out.contributorsByContent.get('post:hello'), [{ id: '200', points: 7 }]);
});

test("SOW-016: the author's own comment is excluded from their commenter pool (no self-delegation)", () => {
  const contentIndex = new Map([['post:hello', { author: 'alice', delegation: { contributions: 0, comments: 0.03 } }]]);
  const withOwnerComment = [
    { author: 'alice', targetType: 'post', targetSlug: 'hello', status: 'published', createdAt: '2026-05-29T00:00:00Z' }, // the owner's from-the-author intro
    { author: 'carol', targetType: 'post', targetSlug: 'hello', status: 'published', createdAt: '2026-05-30T00:00:00Z' },
  ];
  const out = assembleDistributionInputs({ entries, contentIndex, awards, comments: withOwnerComment, membersIndex, bannedGithubIds: new Set(), nowMs: NOW });
  assert.deepEqual(out.commentsByContent.get('post:hello').map((c) => c.id), ['300'], 'only carol (300) earns; alice (100) the owner is excluded');
});

test('readContentIndex drops a slug that collides across two member folders (fail closed, no misroute)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-collide-'));
  const write = (user, slug, author) => {
    const dir = path.join(root, 'members', user, 'posts', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.md'), `---\ntype: post\nslug: ${slug}\nauthor: ${author}\ndelegation:\n  contributions: 0.05\n---\nbody\n`);
  };
  try {
    write('alice', 'hello', 'alice');
    write('bob', 'hello', 'bob'); // SAME slug in a different folder -> ambiguous -> must be dropped
    write('alice', 'unique', 'alice');
    const idx = readContentIndex(root);
    assert.equal(idx.has('post:hello'), false, 'the colliding slug is dropped so it cannot misroute a payout');
    assert.equal(idx.get('post:unique').author, 'alice'); // a non-colliding slug is unaffected
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
