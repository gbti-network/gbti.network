// SOW-059 P1c-C-shell: the snapshot payout I/O shell's pure-ish helpers (fakes only, no network). The money math
// itself is in test/snapshot-payout-plan.test.mjs; this covers the gather/dedupe/eligibility seams the shell feeds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gatherSnapshots, paidPairsFromTransfers, recipientsFromSnapshots, buildEligible, parseArgs, formatAmount, connectReady } from '../scripts/payout-referrals.mjs';
import { applyOverridesSource } from '../scripts/lib/overrides-source.mjs';

test('parseArgs: dry-run by default; --apply enacts; --dry-run overrides --apply (fail safe)', () => {
  assert.deepEqual(parseArgs([]), { apply: false, dryRun: true });
  assert.deepEqual(parseArgs(['--apply']), { apply: true, dryRun: false });
  assert.deepEqual(parseArgs(['--apply', '--dry-run']), { apply: false, dryRun: true });
});

test('connectReady: only a fully-onboarded account is ready (fail closed)', () => {
  assert.equal(connectReady({ details_submitted: true, payouts_enabled: true }), true);
  assert.equal(connectReady({ details_submitted: true, payouts_enabled: false }), false);
  assert.equal(connectReady({ details_submitted: false, payouts_enabled: true }), false);
  assert.equal(connectReady(null), false);
});

test('formatAmount: minor units -> human', () => {
  assert.equal(formatAmount(4500, 'usd'), '45.00 USD');
});

test('gatherSnapshots: lists conv:* into a member->snapshot map; a record without member is skipped; missing KV -> empty', async () => {
  const listKv = async ({ prefix }) => {
    assert.equal(prefix, 'conv:');
    return { available: true, entries: [
      { key: 'conv:7', value: { member: '7', firstOwner: 'alice' } },
      { key: 'conv:9', value: { member: '9', firstOwner: 'bob' } },
      { key: 'conv:bad', value: { firstOwner: 'x' } },
    ] };
  };
  const m = await gatherSnapshots(listKv);
  assert.equal(m.size, 2);
  assert.equal(m.get('7').firstOwner, 'alice');
  const empty = await gatherSnapshots(async () => ({ available: false, reason: 'no creds' }));
  assert.equal(empty.size, 0);
});

test('paidPairsFromTransfers: builds recipient:invoice pairs from this job\'s own metadata (no legacy shape)', () => {
  const pairs = paidPairsFromTransfers([
    { metadata: { payout_recipient: 'alice', snapshot_invoice: 'in_1' } },
    { metadata: { payout_recipient: 'bob', snapshot_invoice: 'in_2' } },
    { metadata: {} },
    {},
  ]);
  assert.ok(pairs.has('alice:in_1'));
  assert.ok(pairs.has('bob:in_2'));
  assert.equal(pairs.size, 2);
});

test('recipientsFromSnapshots: unions first/last owners, inviter, and collaborators across snapshots', () => {
  const snaps = new Map([
    ['7', { firstOwner: 'alice', lastOwner: 'bob', inviter: 'carol', points: [{ member: 'dana', points: 1 }] }],
    ['9', { firstOwner: 'alice', lastOwner: null, inviter: null, points: [] }],
  ]);
  assert.deepEqual([...recipientsFromSnapshots(snaps)].sort(), ['alice', 'bob', 'carol', 'dana']);
});

test('buildEligible: banned beats active; grandfather active; lapsed/unknown inactive', () => {
  const nowMs = Date.parse('2026-06-28T00:00:00Z');
  const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
  const byGithubId = new Map([
    ['active', { subscriptions: { data: [{ status: 'active', start_date: sec('2026-01-01') }] } }],
    ['lapsed', { subscriptions: { data: [{ status: 'canceled', start_date: sec('2026-01-01'), ended_at: sec('2026-03-01') }] } }],
  ]);
  const grandfathers = new Map([['gf', { at: '2026-01-01' }]]);

  const eligible = buildEligible({ bannedGithubIds: new Set(['banned', 'active']), byGithubId, grandfathers, nowMs });
  assert.equal(eligible('active'), false);  // banned > active (ban beats everything)
  assert.equal(eligible('gf'), true);        // grandfather grant
  assert.equal(eligible('lapsed'), false);   // subscription ended before now
  assert.equal(eligible('unknown'), false);  // no customer, no grandfather -> fail closed

  const eligibleUnbanned = buildEligible({ bannedGithubIds: new Set(), byGithubId, grandfathers, nowMs });
  assert.equal(eligibleUnbanned('active'), true); // now the active sub counts
});

test('R11: the KV overlay makes a KV-only ban EXCLUDE a member the loader alone would pay (the fail-open contrast)', async () => {
  // sow-213 R11. This composes the two pieces main() composes: applyOverridesSource (the overlay) feeding the
  // ban set buildEligible reads. The finding is the CONTRAST: after the git files are deleted, loadOverrides
  // returns an empty ban set, so a banned member would be paid; the overlay is what pulls the KV ban back in.
  const nowMs = Date.parse('2026-06-28T00:00:00Z');
  const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
  const banned = '999';
  // An ACTIVE subscription, so eligibility turns ONLY on the ban check (same shape as the fixture above).
  const byGithubId = new Map([[banned, { subscriptions: { data: [{ status: 'active', start_date: sec('2026-01-01') }] } }]]);

  // Post-deletion shape: loadOverrides reads missing files -> empty maps.
  const overrides = { roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map() };

  // WITHOUT the overlay, the loader alone: bannedGithubIds is empty, so the banned member is PAID. Asserted so
  // the fix is measured against a state that really pays them, not against a hypothetical.
  const loaderOnly = buildEligible({ bannedGithubIds: new Set(overrides.bans.keys()), byGithubId, grandfathers: overrides.grandfathers, nowMs });
  assert.equal(loaderOnly(banned), true, 'loader alone (empty git bans post-deletion) pays a banned member: the fail-open');

  // WITH the overlay: a repoRoot with no bans.yml/grandfathered.yml -> mode kv; an injected readKv returns the
  // KV-only ban, so applyOverridesSource replaces overrides.bans with the mirror's and the ban set now has the id.
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'payout-r11-'));
  try {
    await applyOverridesSource({
      overrides,
      repoRoot,
      env: {},
      readKv: async () => ({ available: true, generatedAt: new Date().toISOString(), bans: new Map([[banned, { github_id: banned }]]), grandfathers: new Map() }),
      log: () => {},
    });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
  const withOverlay = buildEligible({ bannedGithubIds: new Set(overrides.bans.keys()), byGithubId, grandfathers: overrides.grandfathers, nowMs });
  assert.equal(withOverlay(banned), false, 'with the overlay the KV-only ban is enforced and the member is EXCLUDED');
});

test('R11: git files gone and the mirror UNAVAILABLE -> the overlay THROWS (aborts the payout, fail-closed)', async () => {
  // The other half of fail-closed. In kv mode an unavailable mirror must not degrade to an empty ban set; it
  // throws, and payout-referrals has no catch around the call, so the run aborts rather than paying against an
  // unknown ban list.
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'payout-r11-deny-'));
  const overrides = { roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map() };
  try {
    await assert.rejects(
      () => applyOverridesSource({ overrides, repoRoot, env: {}, readKv: async () => ({ available: false, reason: 'stale' }), log: () => {} }),
      /overrides unavailable from KV/,
      'an unavailable mirror in kv mode must abort, never yield an empty ban set',
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
