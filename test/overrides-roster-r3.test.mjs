// sow-213 R3: getOverridesRoster reads bans + grandfather grants from the admin-gated Worker endpoint (the two
// house/*.yml files left the public repo), NOT git, and it does so FAIL CLOSED/LOUD: if the Worker cannot return
// them, the whole op throws so the dashboard shows the failure rather than a false "nobody banned". This is the
// deliberate opposite of the best-effort Stripe merge, which still fails soft. members-index stays git-native.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOverridesRoster } from '../client/src/operations-admin.mjs';
import { OperationError } from '../client/src/operations.mjs';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

// An admin ctx with an inline reader (roles.yml + members-index.yml come from git), a token, and an injected fetch.
function ctxWith(fetch) {
  const files = {
    'house/roles.yml': 'admins:\n  - github_id: "1"\n',
    'house/members-index.yml': 'members:\n  "8": baddie\n  "5": coop\n',
  };
  return {
    identity: () => ({ username: 'alice', githubId: '1' }),
    reader: { readFile: async (p) => files[p] ?? '' },
    store: { get: (k) => ({ githubToken: 't' })[k] },
    fetch,
  };
}

test('sow-213 R3 getOverridesRoster: the Worker override maps flow into the roster; members-index stays git', async () => {
  const fetch = async (url) => {
    if (url.includes('/membership/admin/overrides')) {
      return okJson({ ok: true, bans: { bans: [{ github_id: '8', login: 'baddie' }] }, grandfathered: { grandfathered: [{ github_id: '5', login: 'coop', until: null }] } });
    }
    if (url.includes('/membership/admin/statuses')) return okJson({ ok: true, statuses: {}, tiers: {}, logins: {}, pendingGrants: {} });
    throw new Error(`unexpected url ${url}`);
  };
  const { roster } = await getOverridesRoster(ctxWith(fetch));
  const banned = roster.find((r) => String(r.githubId) === '8');
  const grant = roster.find((r) => String(r.githubId) === '5');
  assert.equal(banned?.banned, true, 'the KV-sourced ban lands in the roster');
  assert.equal(grant?.grandfathered, true, 'the KV-sourced grandfather grant lands in the roster');
});

test('sow-213 R3 getOverridesRoster: a failed Worker override read FAILS LOUD (throws), never a false empty roster', async () => {
  // The authoritative overrides read failing is the case the fail-CLOSED direction exists for: a misleading
  // "nobody banned" roster could lead an admin to un-ban or trust a member who is actually banned.
  const fetch = async (url) => {
    if (url.includes('/membership/admin/overrides')) return { ok: false, status: 503, json: async () => ({ error: 'overrides_stale', message: 'mirror is stale' }) };
    return okJson({ ok: true, statuses: {}, tiers: {}, logins: {}, pendingGrants: {} });
  };
  await assert.rejects(
    () => getOverridesRoster(ctxWith(fetch)),
    (e) => e instanceof OperationError && /overrides-unavailable/.test(e.code ?? e.message) && /not rendered rather than shown wrong/.test(e.message),
    'a Worker overrides failure must abort the roster, not degrade to empty',
  );
});

test('sow-213 R3 getOverridesRoster: the Stripe merge STILL fails soft (opposite direction), the roster renders', async () => {
  // The asymmetry, asserted: overrides fail loud, Stripe fails soft. A dead /statuses must NOT sink the roster.
  const fetch = async (url) => {
    if (url.includes('/membership/admin/overrides')) return okJson({ ok: true, bans: { bans: [{ github_id: '8', login: 'baddie' }] }, grandfathered: { grandfathered: [] } });
    if (url.includes('/membership/admin/statuses')) return { ok: false, status: 502, json: async () => ({ error: 'stripe_unavailable' }) };
    throw new Error(`unexpected url ${url}`);
  };
  const { roster } = await getOverridesRoster(ctxWith(fetch));
  assert.equal(roster.find((r) => String(r.githubId) === '8')?.banned, true, 'the ban still shows even with Stripe down');
});
