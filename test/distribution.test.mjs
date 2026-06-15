// SOW-007/008 revenue distribution v2: the pure commission splitter (owner keep + 7% contributions + 3% comments).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitCommission, eligibleComments, DEFAULT_DISTRIBUTION_CONFIG } from '../membership/distribution.mjs';

const COMMISSION = 4500; // $45 = 30% of a $150 membership, in cents

test('default delegation: the owner keeps 100% of the commission', () => {
  const r = splitCommission({ commissionAmount: COMMISSION });
  assert.equal(r.owner, 4500);
  assert.deepEqual(r.contributions, []);
  assert.deepEqual(r.comments, []);
});

test('worked example: full 7% + 3% delegation, one contributor + one commenter', () => {
  const r = splitCommission({
    commissionAmount: COMMISSION,
    delegation: { contributions: 0.07, comments: 0.03 },
    contributors: [{ id: 'c1', points: 7 }],
    comments: [{ id: 'm1', points: 7 }],
  });
  assert.equal(r.pools.contributions, 315); // 7% of $45 = $3.15
  assert.equal(r.pools.comments, 135);       // 3% of $45 = $1.35
  assert.equal(r.contributions[0].amount, 315);
  assert.equal(r.comments[0].amount, 135);
  assert.equal(r.owner, 4050);               // keeps $40.50
  // conservation
  assert.equal(r.owner + r.contributions[0].amount + r.comments[0].amount, COMMISSION);
});

test('dilution: two equal contributions split the 7% pool evenly (largest-remainder rounding)', () => {
  const r = splitCommission({
    commissionAmount: COMMISSION,
    delegation: { contributions: 0.07 },
    contributors: [{ id: 'c1', points: 7 }, { id: 'c2', points: 7 }],
  });
  const amounts = r.contributions.map((c) => c.amount).sort((a, b) => a - b);
  assert.deepEqual(amounts, [157, 158]); // 315 split, off by the rounding cent
  assert.equal(amounts[0] + amounts[1], 315);
  assert.equal(r.owner, 4500 - 315);
});

test('below the 7-point threshold, the unallocated remainder stays with the owner', () => {
  const r = splitCommission({
    commissionAmount: COMMISSION,
    delegation: { contributions: 0.07 },
    contributors: [{ id: 'c1', points: 3 }], // only 3 of the 7 points needed for the full pool
  });
  assert.equal(r.pools.contributions, 315);
  assert.equal(r.contributions[0].amount, 135); // 3/7 of the 315 pool
  assert.equal(r.owner, 4500 - 135);            // the other 180 of the pool returns to the owner
});

test('delegation shares are clamped to the 7% / 3% caps', () => {
  const r = splitCommission({
    commissionAmount: COMMISSION,
    delegation: { contributions: 0.5, comments: 0.5 }, // way over the caps
    contributors: [{ id: 'c1', points: 7 }],
    comments: [{ id: 'm1', points: 7 }],
  });
  assert.equal(r.pools.contributions, 315); // capped at 7%
  assert.equal(r.pools.comments, 135);       // capped at 3%
});

test('comment eligibility: only the first 10, and only those under 90 days old', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, points: 7, ageDays: 10 }));
  assert.equal(eligibleComments(many).length, 10);

  const mixed = [
    { id: 'fresh', points: 7, ageDays: 30 },
    { id: 'old', points: 7, ageDays: 100 }, // excluded (> 90 days)
    { id: 'nodate', points: 7 },            // no age = eligible
  ];
  const elig = eligibleComments(mixed).map((c) => c.id);
  assert.deepEqual(elig, ['fresh', 'nodate']);

  const r = splitCommission({ commissionAmount: COMMISSION, delegation: { comments: 0.03 }, comments: mixed });
  // the 135 pool is split between the two eligible commenters only
  assert.equal(r.comments.reduce((s, c) => s + c.amount, 0), 135);
  assert.equal(r.comments.length, 2);
});

test('no points means no allocation; the owner keeps everything', () => {
  const r = splitCommission({
    commissionAmount: COMMISSION,
    delegation: { contributions: 0.07 },
    contributors: [{ id: 'c1', points: 0 }],
  });
  assert.equal(r.contributions[0].amount, 0);
  assert.equal(r.owner, 4500);
});

test('non-finite contributor points (Infinity from a malformed ledger) count as 0; the owner keep never vanishes', () => {
  const r = splitCommission({
    commissionAmount: 4500,
    delegation: { contributions: 0.07 },
    contributors: [{ id: 'c1', points: Infinity }],
  });
  assert.equal(r.contributions[0].amount, 0);
  assert.equal(r.owner, 4500); // the owner's keep is not NaN'd away
});

test('conservation always holds: owner + contributions + comments == commission', () => {
  const r = splitCommission({
    commissionAmount: 9999,
    delegation: { contributions: 0.07, comments: 0.03 },
    contributors: [{ id: 'a', points: 7 }, { id: 'b', points: 14 }, { id: 'c', points: 7 }],
    comments: [{ id: 'm1', points: 7 }, { id: 'm2', points: 7 }, { id: 'm3', points: 7 }],
  });
  const total = r.owner + r.contributions.reduce((s, x) => s + x.amount, 0) + r.comments.reduce((s, x) => s + x.amount, 0);
  assert.equal(total, 9999);
  assert.ok(r.owner >= Math.floor(9999 * (1 - DEFAULT_DISTRIBUTION_CONFIG.contributionCap - DEFAULT_DISTRIBUTION_CONFIG.commentCap)));
});
