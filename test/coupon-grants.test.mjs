// SOW-119: the KV -> grandfathered.yml fold-in (scripts/lib/coupon-grants.mjs), the coupon-expiry
// reminder plan, and the memberEntryFor coupon extraction. No network: injected fetch + github fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import {
  planCouponGrants,
  appendGrantEntries,
  listCouponRedemptions,
  syncCouponGrants,
} from '../scripts/lib/coupon-grants.mjs';
import { planReconcile, COUPON_REMINDER_DAYS } from '../scripts/lib/reconcile-plan.mjs';
import { couponGrantFor } from '../scripts/reconcile.mjs';
import { grandfathersFromParsed } from '../membership/overrides-core.mjs';

const NOW = new Date('2026-07-15T12:00:00.000Z');

const FILE = `# header comment survives
grandfathered:
  - github_id: "111"   # github.com/existing
    login: existing
    reason: complimentary access (grandfathered co-op member)
    until: null
# - github_id: "..."
#   login: founder
#   reason: founding member
#   until: null   # null = permanent; otherwise an ISO date
`;

test('planCouponGrants skips existing grants, expired and malformed redemptions, and dups', () => {
  const parsed = yaml.load(FILE);
  const additions = planCouponGrants({
    redemptions: [
      { githubId: '111', code: 'CODEABLEYEAR', until: '2027-01-01T00:00:00.000Z' }, // already granted
      { githubId: '222', code: 'CODEABLEYEAR', login: 'Newbie', until: '2027-07-15T12:00:00.000Z' },
      { githubId: '222', code: 'CODEABLEYEAR', until: '2028-01-01T00:00:00.000Z' }, // dup id
      { githubId: '333', code: 'CODEABLEYEAR', until: '2026-01-01T00:00:00.000Z' }, // already over
      { githubId: '444', code: 'CODEABLEYEAR', until: 'garbage' }, // malformed
      { githubId: '', code: 'CODEABLEYEAR', until: '2027-01-01T00:00:00.000Z' }, // no id
    ],
    grandfatheredParsed: parsed,
    now: NOW,
  });
  assert.equal(additions.length, 1);
  assert.deepEqual(additions[0], { githubId: '222', login: 'newbie', code: 'CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' });
});

test('appendGrantEntries keeps comments, parses back, and round-trips through overrides-core', () => {
  const additions = [
    { githubId: '222', login: 'newbie', code: 'CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' },
    { githubId: '555', login: null, code: 'CAPPED', until: '2026-08-15T12:00:00.000Z' },
  ];
  const next = appendGrantEntries(FILE, additions, NOW);
  assert.ok(next.includes('# header comment survives'));
  assert.ok(next.includes('#   reason: founding member')); // the trailing template comments survive
  const map = grandfathersFromParsed(yaml.load(next));
  assert.equal(map.get('222').reason, 'coupon:CODEABLEYEAR');
  assert.equal(map.get('222').until, '2027-07-15T12:00:00.000Z');
  assert.equal(map.get('555').reason, 'coupon:CAPPED');
  assert.equal(map.get('111').until, null); // the existing permanent grant is untouched
});

test('listCouponRedemptions is a reported no-op without CF creds and parses keys with them', async () => {
  const none = await listCouponRedemptions({ env: {} });
  assert.equal(none.available, false);

  const env = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };
  const fetchImpl = async (url) => {
    if (String(url).includes('/keys?')) {
      return { ok: true, json: async () => ({ result: [{ name: 'redemption:CODEABLEYEAR:222' }, { name: 'weird:key' }], result_info: {} }) };
    }
    return { ok: true, json: async () => ({ code: 'CODEABLEYEAR', login: 'newbie', redeemedAt: NOW.toISOString(), until: '2027-07-15T12:00:00.000Z' }) };
  };
  const r = await listCouponRedemptions({ env, fetchImpl });
  assert.equal(r.available, true);
  assert.equal(r.redemptions.length, 1);
  assert.equal(r.redemptions[0].githubId, '222');
  assert.equal(r.redemptions[0].code, 'CODEABLEYEAR');
});

test('syncCouponGrants opens ONE auto-merged PR with the appended file', async () => {
  const puts = [];
  const github = {
    async getRef() { return { object: { sha: 'basesha' } }; },
    async createRef() {},
    async getContent() { return { sha: 'filesha' }; },
    async putContent(p, body) { puts.push({ p, text: Buffer.from(body.content, 'base64').toString('utf8') }); },
    async createPull() { return { number: 77 }; },
    merged: null,
    async mergePull(n, opts) { this.merged = { n, opts }; },
  };
  const r = await syncCouponGrants({
    env: { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' },
    github,
    now: NOW,
    listRedemptions: async () => ({ available: true, redemptions: [{ githubId: '222', code: 'CODEABLEYEAR', login: 'newbie', until: '2027-07-15T12:00:00.000Z' }] }),
    readGrandfathered: () => ({ text: FILE, parsed: yaml.load(FILE) }),
  });
  assert.equal(r.synced, true);
  assert.equal(r.prNumber, 77);
  assert.equal(github.merged.n, 77);
  assert.ok(puts[0].text.includes('coupon:CODEABLEYEAR'));
});

test('syncCouponGrants no-ops when every redemption is already granted', async () => {
  const withGrant = FILE.replace('until: null', 'until: null') + `  - github_id: "222"\n    reason: coupon:CODEABLEYEAR\n    until: "2027-07-15T12:00:00.000Z"\n`;
  const r = await syncCouponGrants({
    env: { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' },
    github: {},
    now: NOW,
    listRedemptions: async () => ({ available: true, redemptions: [{ githubId: '222', code: 'CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' }] }),
    readGrandfathered: () => ({ text: withGrant, parsed: yaml.load(withGrant) }),
  });
  assert.equal(r.synced, false);
  assert.equal(r.reason, 'all redemptions already granted');
});

test('couponGrantFor extracts only coupon-reason grants with an until', () => {
  const overrides = {
    grandfathers: grandfathersFromParsed({
      grandfathered: [
        { github_id: '222', reason: 'coupon:CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' },
        { github_id: '111', reason: 'complimentary access', until: null },
      ],
    }),
  };
  assert.deepEqual(couponGrantFor('222', overrides), { code: 'CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' });
  assert.equal(couponGrantFor('111', overrides), null);
  assert.equal(couponGrantFor('999', overrides), null);
});

test('the planner emits a coupon-expiry reminder only inside the final window', () => {
  const base = {
    githubId: '222',
    email: 'n@example.com',
    discordUserId: null,
    username: null,
    derived: 'none',
    effective: { status: 'paid', source: 'grandfather' },
    converted: false,
  };
  const mk = (until, now) => planReconcile({
    members: [{ ...base, couponGrant: { code: 'CODEABLEYEAR', until } }],
    repoIndex: {},
    now,
  }).filter((a) => a.kind === 'reminder' && a.type === 'coupon-expiry');

  const until = '2026-07-25T12:00:00.000Z'; // 10 days out from NOW: inside the 14-day window
  assert.equal(mk(until, NOW).length, 1);
  assert.equal(mk(until, NOW)[0].until, until);
  const farOut = '2026-12-01T00:00:00.000Z'; // far outside the window
  assert.equal(mk(farOut, NOW).length, 0);
  const past = '2026-07-01T00:00:00.000Z'; // already over
  assert.equal(mk(past, NOW).length, 0);
  // converted members are not nagged
  const converted = planReconcile({
    members: [{ ...base, converted: true, couponGrant: { code: 'C', until } }],
    repoIndex: {},
    now: NOW,
  }).filter((a) => a.type === 'coupon-expiry');
  assert.equal(converted.length, 0);
  assert.ok(COUPON_REMINDER_DAYS === 14);
});
