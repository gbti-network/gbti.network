// sow-427: right-to-erasure for prepared listings (scripts/lib/erase-prepared-listings.mjs). A listing is keyed by a
// listing id and an invite by its code, so the member is found only INSIDE records; these tests pin each role they
// can appear in, over a fake of the Cloudflare KV REST API (the fakeKvFetch idiom from test/erase-member.test.mjs,
// extended to honour the prefix, since this step lists two keyspaces and deletes images by prefix).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { erasePreparedListings } from '../scripts/lib/erase-prepared-listings.mjs';
import { planErasure, runErasure } from '../scripts/lib/erase-member.mjs';
import { inviteState } from '../membership/invites.mjs';

const CF = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const NOW = new Date('2026-10-05T00:00:00.000Z');
const ME = '4242';
const L1 = 'AAAAAAAAAAAAAAAA';
const L2 = 'BBBBBBBBBBBBBBBB';
const L3 = 'CCCCCCCCCCCCCCCC';
const L4 = 'DDDDDDDDDDDDDDDD';

/** A KV REST fake: key lists honour the prefix, values are JSON strings, and every write is recorded. */
function fakeKvFetch(initial, { unreadable = new Set() } = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const calls = { deleted: [], put: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/keys')) {
      const prefix = u.searchParams.get('prefix') || '';
      return { ok: true, json: async () => ({ result: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), result_info: {} }) };
    }
    const key = decodeURIComponent(u.pathname.split('/values/')[1] || '');
    if (init.method === 'DELETE') { calls.deleted.push(key); store.delete(key); return { ok: true }; }
    if (init.method === 'PUT') { calls.put.push(key); store.set(key, init.body); return { ok: true }; }
    if (unreadable.has(key)) return { ok: false, status: 500 };
    if (!store.has(key)) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => JSON.parse(store.get(key)), text: async () => store.get(key) };
  };
  const get = (k) => (store.has(k) ? JSON.parse(store.get(k)) : undefined);
  return { store, calls, fetchImpl, get };
}

const inv = (code, over) => ({
  code, campaign: 'CODEABLEYEAR', issuedAt: '2026-09-01T00:00:00.000Z', note: 'sent at the meetup', expiresAt: null,
  redeemedBy: null, redeemedByLogin: null, redeemedAt: null, revokedAt: null, revokedBy: null,
  listingId: null, boundGithubId: null, boundLogin: null, claimPendingAt: null, claimPendingBy: null, claimPr: null, claimedAt: null, claimedBy: null,
  ...over,
});
const lst = (id, over) => ({
  v: 1, id, type: 'project', slug: `p-${id.toLowerCase()}`, title: `Project ${id[0]}`, frontmatter: { title: 'x' }, body: 'b', images: ['icon.png'],
  recipientName: 'Sam', message: 'Hi Sam', campaign: 'CODEABLEYEAR', code: `CODE${id[0]}XX`, priorCodes: [],
  boundGithubId: null, boundLogin: null, preparedBy: '2002207', preparedByLogin: 'atwellpub', createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z', revokedAt: null, revokedBy: null, claimPendingAt: null, claimPendingBy: null, prNumber: null,
  claimedAt: null, claimedBy: null, claimedLogin: null, claimedFolder: null, claimedPath: null, ...over,
});

function world() {
  return fakeKvFetch({
    // L1: tied to this member, never claimed -> deleted, its invite revoked then untied.
    [`invite-listing:${L1}`]: lst(L1, { boundGithubId: ME, boundLogin: 'sam-dev' }),
    [`invite-listing-img:${L1}:icon.png`]: { dataBase64: 'AAAA' },
    [`invite-listing-img:${L1}:cover.webp`]: { dataBase64: 'AAAA' },
    'invite:CODEAXX': inv('CODEAXX', { listingId: L1, boundGithubId: ME, boundLogin: 'sam-dev' }),
    // L2: untied, but this member REDEEMED its invite and never claimed -> deleted.
    [`invite-listing:${L2}`]: lst(L2),
    [`invite-listing-img:${L2}:icon.png`]: { dataBase64: 'AAAA' },
    'invite:CODEBXX': inv('CODEBXX', { listingId: L2, redeemedBy: ME, redeemedByLogin: 'sam-dev', redeemedAt: '2026-09-02T00:00:00.000Z' }),
    // L3: claimed by this member -> minimized, the fact of the claim kept.
    [`invite-listing:${L3}`]: lst(L3, { frontmatter: null, body: null, images: [], message: null, claimedAt: '2026-09-03T00:00:00.000Z', claimedBy: ME, claimedLogin: 'sam-dev', claimedFolder: 'sam-dev', claimedPath: 'members/sam-dev/projects/p/index.md', prNumber: 12, boundGithubId: ME }),
    'invite:CODECXX': inv('CODECXX', { listingId: L3, claimedAt: '2026-09-03T00:00:00.000Z', claimedBy: ME, claimPr: 12, boundGithubId: ME }),
    // L4: someone else's listing entirely -> untouched.
    [`invite-listing:${L4}`]: lst(L4, { boundGithubId: '1111' }),
    [`invite-listing-img:${L4}:icon.png`]: { dataBase64: 'AAAA' },
    'invite:CODEDXX': inv('CODEDXX', { listingId: L4, boundGithubId: '1111' }),
    // A plain invite this member redeemed: left for minimizeRedeemedInvites.
    'invite:PLAINXX': inv('PLAINXX', { redeemedBy: ME, redeemedAt: '2026-08-01T00:00:00.000Z' }),
  });
}

test('a listing TIED to the member and never claimed is deleted with its images; its invite is revoked, then untied', async () => {
  const kv = world();
  const r = await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  assert.equal(kv.get(`invite-listing:${L1}`), undefined, 'the listing is gone');
  assert.equal(kv.get(`invite-listing-img:${L1}:icon.png`), undefined);
  assert.equal(kv.get(`invite-listing-img:${L1}:cover.webp`), undefined);
  const invite = kv.get('invite:CODEAXX');
  assert.equal(invite.boundGithubId, null);
  assert.equal(invite.boundLogin, null);
  assert.ok(invite.revokedAt, 'the invite of a deleted listing is revoked');
  assert.equal(inviteState(invite, NOW), 'revoked');
  assert.equal(invite.note, 'sent at the meetup', 'the administration note is the owner\'s call, as in minimizeRedeemedInvites');
  assert.ok(r.deleted >= 2);
  assert.ok(r.images >= 3);
});

test('an untied listing whose invitation the member REDEEMED is deleted too: it greets them by name', async () => {
  const kv = world();
  await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  assert.equal(kv.get(`invite-listing:${L2}`), undefined);
  assert.equal(kv.get(`invite-listing-img:${L2}:icon.png`), undefined);
  assert.equal(kv.get('invite:CODEBXX').redeemedBy, ME, 'redeemedBy is minimizeRedeemedInvites\' job, which runs next');
});

test('a listing the member CLAIMED keeps only the fact of the claim', async () => {
  const kv = world();
  await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  const rec = kv.get(`invite-listing:${L3}`);
  assert.ok(rec, 'the record stays, so the manager still counts a claimed listing');
  assert.equal(rec.claimedAt, '2026-09-03T00:00:00.000Z');
  for (const k of ['recipientName', 'title', 'slug', 'claimedBy', 'claimedLogin', 'claimedFolder', 'claimedPath', 'boundGithubId', 'prNumber']) {
    assert.equal(rec[k], null, `${k} is nulled`);
  }
  const invite = kv.get('invite:CODECXX');
  assert.equal(invite.claimedBy, null);
  assert.equal(invite.boundGithubId, null);
  assert.equal(inviteState(invite, NOW), 'claimed', 'still claimed: the link can never grant a year again');
});

test('another member\'s listing, its images and its invite are untouched', async () => {
  const kv = world();
  const before = { l: kv.store.get(`invite-listing:${L4}`), i: kv.store.get('invite:CODEDXX'), img: kv.store.get(`invite-listing-img:${L4}:icon.png`) };
  await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  assert.equal(kv.store.get(`invite-listing:${L4}`), before.l);
  assert.equal(kv.store.get('invite:CODEDXX'), before.i);
  assert.equal(kv.store.get(`invite-listing-img:${L4}:icon.png`), before.img);
  assert.equal(kv.calls.put.includes('invite:PLAINXX'), false, 'a plain redeemed invite is the next step\'s');
});

test('a claim PENDING for the member: the listing is deleted, the pending claim cleared and the invite revoked', async () => {
  const kv = fakeKvFetch({
    [`invite-listing:${L1}`]: lst(L1, { claimPendingAt: '2026-10-01T00:00:00.000Z', claimPendingBy: ME, prNumber: 7 }),
    'invite:CODEAXX': inv('CODEAXX', { listingId: L1, claimPendingAt: '2026-10-01T00:00:00.000Z', claimPendingBy: ME, claimPr: 7 }),
  });
  await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  assert.equal(kv.get(`invite-listing:${L1}`), undefined);
  const invite = kv.get('invite:CODEAXX');
  assert.equal(invite.claimPendingBy, null);
  assert.equal(inviteState(invite, NOW), 'revoked', 'never reopened: the listing it pointed at is gone');
});

test('an invite naming the member as pending claimant, with no listing left, stays unredeemable', async () => {
  const kv = fakeKvFetch({ 'invite:CODEAXX': inv('CODEAXX', { listingId: L1, claimPendingAt: '2026-10-01T00:00:00.000Z', claimPendingBy: ME }) });
  await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  const invite = kv.get('invite:CODEAXX');
  assert.equal(invite.claimPendingBy, null);
  assert.ok(['claim_pending', 'revoked'].includes(inviteState(invite, NOW)), 'fail closed: not issued');
});

// TRAP: "Send again" retires a code into priorCodes and issues a new one for the same listing. The account that
// redeemed the RETIRED code has no hold on the listing any more (publicReadable refuses a code that is not the
// listing's current one), so erasing that account must not delete the listing, its images or the live link.
test('a member who redeemed a RETIRED code of a listing that was sent again does not take the listing with them', async () => {
  const kv = fakeKvFetch({
    [`invite-listing:${L1}`]: lst(L1, { code: 'CODENEW', priorCodes: ['CODEOLD'] }),
    [`invite-listing-img:${L1}:icon.png`]: { dataBase64: 'AAAA' },
    'invite:CODEOLD': inv('CODEOLD', { listingId: L1, redeemedBy: ME, redeemedByLogin: 'stranger', redeemedAt: '2026-09-02T00:00:00.000Z', revokedAt: null }),
    'invite:CODENEW': inv('CODENEW', { listingId: L1 }),
  });
  const r = await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  assert.ok(kv.get(`invite-listing:${L1}`), 'the listing now belongs to the person it was sent again to');
  assert.ok(kv.get(`invite-listing-img:${L1}:icon.png`), 'its images are not backed up, so deleting them is permanent');
  assert.equal(inviteState(kv.get('invite:CODENEW'), NOW), 'issued', 'the live link keeps working');
  assert.equal(r.deleted, 0);
  assert.equal(r.images, 0);
  assert.equal(kv.get('invite:CODEOLD').redeemedBy, ME, 'the retired invite is minimizeRedeemedInvites\' job, which runs next');
});

test('the CURRENT code of an untied listing redeemed by the member still deletes it', async () => {
  const kv = fakeKvFetch({
    [`invite-listing:${L1}`]: lst(L1, { code: 'CODENEW', priorCodes: ['CODEOLD'] }),
    'invite:CODEOLD': inv('CODEOLD', { listingId: L1, revokedAt: '2026-09-02T00:00:00.000Z' }),
    'invite:CODENEW': inv('CODENEW', { listingId: L1, redeemedBy: ME, redeemedAt: '2026-09-03T00:00:00.000Z' }),
  });
  const r = await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  assert.equal(kv.get(`invite-listing:${L1}`), undefined, 'the listing greets the account that redeemed its live link');
  assert.equal(r.deleted, 1);
});

test('a TIED, still-issued invite whose listing cannot be read is revoked before it is untied', async () => {
  // The listing is not deleted in this run (its value is unreadable), so nothing else revokes the invite: only the
  // untie guard stands between this run and a first-come link that greets the erased person by name.
  const kv = fakeKvFetch({
    [`invite-listing:${L1}`]: lst(L1, { boundGithubId: ME, boundLogin: 'sam-dev' }),
    'invite:CODEAXX': inv('CODEAXX', { listingId: L1, boundGithubId: ME, boundLogin: 'sam-dev' }),
  }, { unreadable: new Set([`invite-listing:${L1}`]) });
  const r = await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  assert.equal(r.incomplete, true);
  const invite = kv.get('invite:CODEAXX');
  assert.equal(invite.boundGithubId, null);
  assert.equal(invite.boundLogin, null);
  assert.equal(inviteState(invite, NOW), 'revoked', 'an untied, still-issued link would be first-come');
});

test('an unreadable record is reported as incomplete, never as a clean run', async () => {
  const kv = fakeKvFetch({ [`invite-listing:${L1}`]: lst(L1), 'invite:CODEAXX': inv('CODEAXX', {}) }, { unreadable: new Set([`invite-listing:${L1}`]) });
  const r = await erasePreparedListings({ githubId: ME, env: CF, fetchImpl: kv.fetchImpl, now: NOW });
  assert.equal(r.incomplete, true);
  assert.equal(r.unreadable, 1);
  assert.match(r.reason, /could not be read and were NOT scrubbed/);
});

test('without Cloudflare credentials it is a reported skip, and it needs a github_id', async () => {
  const r = await erasePreparedListings({ githubId: ME, env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(r.skipped, true);
  await assert.rejects(() => erasePreparedListings({ githubId: '' }), /github_id is required/);
});

test('the plan declares the step, and the run executes it BEFORE redeemed-invites, which erases what it reads', async () => {
  const plan = planErasure({ githubId: ME, username: 'sam-dev' }).map((s) => s.step);
  assert.ok(plan.includes('prepared-listings'));
  assert.ok(plan.indexOf('prepared-listings') < plan.indexOf('redeemed-invites'));
  const kv = world();
  const res = await runErasure({ githubId: ME, username: 'sam-dev', apply: true, env: CF, fetchImpl: kv.fetchImpl, clients: {}, files: [], now: NOW });
  const names = res.steps.map((s) => s.step);
  assert.ok(names.indexOf('prepared-listings') >= 0 && names.indexOf('prepared-listings') < names.indexOf('redeemed-invites'), names.join(' -> '));
  assert.equal(res.steps.find((s) => s.step === 'prepared-listings').outcome, 'deleted');
  assert.equal(kv.get(`invite-listing:${L2}`), undefined, 'the redeemed-invite listing was found before redeemedBy was nulled');
  assert.equal(kv.get('invite:CODEBXX').redeemedBy, null, 'and the next step then minimized the invite');
});
