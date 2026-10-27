// sow-480: an invitation tied to an account that is ALREADY a member makes no free-year promise. The resolver
// (workers/signup/prepared-recipient.mjs), the save path that stores its answer, the public read that then leaves the
// terms out, the manager row, and the words that led an agent to write the year into a message. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { recipientIsMember } from '../workers/signup/prepared-recipient.mjs';
import { membershipPreparedPost } from '../workers/signup/membership-prepared-admin.mjs';
import { inviteListingRead } from '../workers/signup/prepared-claim-read.mjs';
import { OVERRIDES_KV_KEY } from '../workers/signup/membership-content.mjs';
import { listingKey, listingSummary, publicListingView, memberAnswer } from '../membership/prepared-listings.mjs';
import { draftImageKey } from '../membership/draft-images.mjs';
import { preparedRowMeta } from '../client-ui/src/prepared-listings-core.mjs';
import { tierLine } from '../src/lib/claim-core.mjs';
import * as F from './prepared-claim-fixtures.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOW = F.NOW;
const COUPONS = JSON.stringify({ generatedAt: NOW.toISOString(), coupons: [{ code: F.CAMPAIGN, freeDays: 365, active: true, tier: 'member' }] });

// ---- the resolver ------------------------------------------------------------------------------------------------

const PAID = { id: 'cus_1', subscriptions: { data: [{ status: 'active', created: 1 }] } };
const LAPSED = { id: 'cus_2', subscriptions: { data: [{ status: 'canceled', created: 1 }] } };
const stripeWith = (customer) => ({ searchCustomerByGithubId: async () => customer });
const stripeDown = { searchCustomerByGithubId: async () => { throw new Error('stripe 503'); } };
function mirrorWith({ grandfathered = [], bans = [], at = NOW } = {}) {
  const m = F.mirror({ bans, at });
  m.grandfathered = { grandfathered: grandfathered.map((github_id) => ({ github_id, login: 'x', reason: 'complimentary', until: null })) };
  return m;
}
const kvWith = (mirror) => F.fakeKv(mirror ? { [OVERRIDES_KV_KEY]: JSON.stringify(mirror) } : {});
const ask = (over) => recipientIsMember({ githubId: F.CLAIMANT, now: NOW, stripe: stripeWith(null), kv: kvWith(mirrorWith()), ...over });

test('a member by Stripe, by a complimentary grant or by a staff role is a member', async () => {
  assert.equal(await ask({ stripe: stripeWith(PAID) }), true);
  assert.equal(await ask({ kv: kvWith(mirrorWith({ grandfathered: [F.CLAIMANT] })) }), true, 'permanent complimentary access, as Ali has');
  assert.equal(await ask({ kv: kvWith(mirrorWith({ grandfathered: [F.CLAIMANT] })), stripe: stripeDown }), true, 'the grant settles it even when Stripe is down');
  assert.equal(await ask({ githubId: F.PREPARER }), true, 'a superadmin in the roles mirror');
  assert.equal(await ask({ stripe: stripeWith(PAID), kv: kvWith(null) }), true, 'Stripe settles it even when the mirror is missing');
});

test('not a member only when BOTH sources were read and say so; a ban is not a member', async () => {
  assert.equal(await ask({}), false, 'no customer, no grant');
  assert.equal(await ask({ stripe: stripeWith(LAPSED) }), false, 'a lapsed subscription');
  assert.equal(await ask({ stripe: stripeWith(PAID), kv: kvWith(mirrorWith({ bans: [F.CLAIMANT] })) }), false, 'a ban outranks paying');
});

test('anything it could not read is null, and it never throws', async () => {
  assert.equal(await ask({ stripe: stripeDown }), null, 'Stripe unreadable and the mirror does not settle it');
  assert.equal(await ask({ kv: kvWith(null) }), null, 'no mirror and Stripe says not paying: a grant cannot be ruled out');
  assert.equal(await ask({ kv: kvWith(mirrorWith({ at: new Date(NOW.getTime() - 30 * 86400e3) })) }), null, 'a stale mirror is not read');
  const throwing = { ...kvWith(mirrorWith()), async get() { throw new Error('kv down'); } };
  assert.equal(await ask({ kv: throwing }), null);
  assert.equal(await ask({ githubId: 'sam' }), null, 'not an account number');
  assert.equal(await recipientIsMember({ githubId: F.CLAIMANT, now: NOW, env: {}, kv: kvWith(mirrorWith({ grandfathered: [F.CLAIMANT] })) }), true,
    'no Stripe key configured: a grant still answers');
  assert.equal(await recipientIsMember({ githubId: F.CLAIMANT, now: NOW, env: {}, kv: kvWith(mirrorWith()) }), null, 'and nothing else does');
});

// ---- the save stores the answer, and the public read leaves the terms out ---------------------------------------

const ME = F.PREPARER;
const staged = (name) => [draftImageKey(ME, 'project:surfacedby', name), JSON.stringify({ dataBase64: F.IMG[name], contentType: 'image/png', bytes: 40 })];
const superadmin = async () => ({ ok: true, githubId: ME, role: 'superadmin', mirror: { roles: { superadmins: [{ github_id: ME, login: 'atwellpub' }] } } });
const lookupUser = async (_env, login) => {
  const l = String(login).toLowerCase();
  if (l === 'sam-dev') return { ok: true, githubId: F.CLAIMANT, login: 'Sam-Dev' };
  if (l === 'other') return { ok: true, githubId: F.STRANGER, login: 'other' };
  return { ok: false, status: 404, message: 'No personal GitHub account has that name.' };
};
function post(kv, body, answer, calls = []) {
  return membershipPreparedPost(new Request('https://x/membership/admin/prepared', { method: 'POST', body: JSON.stringify(body) }), { SIGNUP_KV: kv }, {
    authorize: superadmin, now: NOW, randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 240), lookupUser,
    readTree: async () => ({ content: [], shares: [] }),
    loadHouse: async (_f, _t, _u, path) => ({ ok: true, parsed: path.endsWith('taxonomy.yml') ? F.TAXONOMY : F.LICENSES, raw: '' }),
    getToken: async () => 'tok', siteBase: 'https://gbti.network',
    recipientMember: async ({ githubId }) => { calls.push(githubId); if (answer instanceof Error) throw answer; return answer; },
  });
}
const CREATE = (over = {}) => ({
  op: 'save', campaign: F.CAMPAIGN, recipientName: 'Sam', message: 'We wrote this up for you.', draft: F.DRAFT(), stagedItem: 'project:surfacedby', ...over,
});
async function publicRead(kv, code) {
  const r = await inviteListingRead(new Request(`https://x/invite/listing?code=${code}`, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), { SIGNUP_KV: kv }, {
    kv, now: NOW, limiter: async () => ({ allowed: true }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.listing;
}
const TIERS = { member: { label: 'Network Supporter', priceAnnual: 50 } };

test('a listing tied to an existing member stores true, and its claim page has no free-year line', async () => {
  const kv = F.fakeKv({ 'coupons:config': COUPONS, ...Object.fromEntries([staged('icon.png'), staged('cover.webp'), staged('shot-1.png')]) });
  const calls = [];
  const r = await post(kv, CREATE({ githubLogin: 'Sam-Dev' }), true, calls);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(calls, [F.CLAIMANT], 'asked once, about the tied account number');
  assert.equal(kv.json(listingKey(r.body.listing.id)).recipientMember, true);
  assert.equal(r.body.listing.recipientMember, true, 'the manager row carries it');
  const view = await publicRead(kv, r.body.code);
  assert.equal(view.tier, null);
  assert.equal(view.freeDays, null);
  assert.equal(tierLine({ tier: view.tier, freeDays: view.freeDays }, TIERS), null, 'the claim page renders no free-year sentence');
  assert.ok(!JSON.stringify(view).includes(F.CLAIMANT), 'the public view never carries the account number');
});

test('a tied newcomer and an untied invitation keep the offer, and an untied one is never looked up', async () => {
  const seedKv = () => F.fakeKv({ 'coupons:config': COUPONS, ...Object.fromEntries([staged('icon.png'), staged('cover.webp'), staged('shot-1.png')]) });
  const a = seedKv();
  const r = await post(a, CREATE({ githubLogin: 'Sam-Dev' }), false);
  assert.equal(a.json(listingKey(r.body.listing.id)).recipientMember, false);
  const view = await publicRead(a, r.body.code);
  assert.match(tierLine({ tier: view.tier, freeDays: view.freeDays }, TIERS), /comes with a free year at the Network Supporter tier/);

  const b = seedKv();
  const calls = [];
  const u = await post(b, CREATE(), true, calls);
  assert.deepEqual(calls, [], 'no tie, nothing to ask about');
  assert.equal(b.json(listingKey(u.body.listing.id)).recipientMember, null);
  assert.equal((await publicRead(b, u.body.code)).freeDays, 365);

  const c = seedKv();
  const t = await post(c, CREATE({ githubLogin: 'Sam-Dev' }), new Error('stripe down'));
  assert.equal(t.status, 200, 'a failed check never fails the save');
  assert.equal(c.json(listingKey(t.body.listing.id)).recipientMember, null, 'and leaves the offer showing, as before');
});

test('an edit re-checks a tied listing, writes even when that is the only change, and keeps the answer on a failed check', async () => {
  const { kv } = F.seed({ bound: F.CLAIMANT, extra: { 'coupons:config': COUPONS } });
  const before = kv.json(listingKey(F.LISTING_ID));
  assert.equal(before.recipientMember, null, 'saved before the check existed');
  const calls = [];
  let r = await post(kv, { op: 'save', id: F.LISTING_ID }, true, calls);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(calls, [F.CLAIMANT], 'the stored tie is asked about without a GitHub lookup');
  assert.equal(r.body.changed, true);
  const after = kv.json(listingKey(F.LISTING_ID));
  assert.equal(after.recipientMember, true, 'a re-save is how an older invitation picks the check up');
  assert.equal(after.updatedAt, before.updatedAt, 'and it does not refuse an open edit by moving the edit token');
  assert.equal((await publicRead(kv, F.CODE)).freeDays, null);

  r = await post(kv, { op: 'save', id: F.LISTING_ID, message: 'A new message.' }, null);
  assert.equal(r.status, 200);
  assert.equal(kv.json(listingKey(F.LISTING_ID)).recipientMember, true, 'a check that could not be made keeps what was known');
  r = await post(kv, { op: 'save', id: F.LISTING_ID }, new Error('kv down'));
  assert.equal(kv.json(listingKey(F.LISTING_ID)).recipientMember, true, 'a throwing check too');
});

test('untying clears the answer, and a new tie starts again rather than inheriting the old one', async () => {
  const { kv } = F.seed({ bound: F.CLAIMANT, extra: { 'coupons:config': COUPONS }, listingOver: { recipientMember: true } });
  const calls = [];
  let r = await post(kv, { op: 'save', id: F.LISTING_ID, githubLogin: '' }, true, calls);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(calls, [], 'an untied listing is not asked about');
  assert.equal(kv.json(listingKey(F.LISTING_ID)).recipientMember, null);
  assert.equal((await publicRead(kv, F.CODE)).freeDays, 365, 'the offer is back');

  const s = F.seed({ bound: F.CLAIMANT, extra: { 'coupons:config': COUPONS }, listingOver: { recipientMember: true } });
  r = await post(s.kv, { op: 'save', id: F.LISTING_ID, githubLogin: 'other' }, null);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(s.kv.json(listingKey(F.LISTING_ID)).recipientMember, null, 'the old account\'s answer is not carried to a new one');
});

// ---- the pure pieces -------------------------------------------------------------------------------------------

test('the public view drops the terms only for a TIED member; the row and the summary say so', () => {
  const { listing, invite } = F.seed({ bound: F.CLAIMANT });
  const terms = { tier: 'member', freeDays: 365 };
  assert.deepEqual([publicListingView({ ...listing, recipientMember: true }, terms).freeDays, publicListingView({ ...listing, recipientMember: false }, terms).freeDays], [null, 365]);
  const untied = { ...listing, boundGithubId: null, boundLogin: null, recipientMember: true };
  assert.equal(publicListingView(untied, terms).freeDays, 365, 'a stray flag on an untied listing changes nothing');
  assert.equal(listingSummary({ ...listing, recipientMember: true }, invite, NOW).recipientMember, true);
  assert.equal(listingSummary(listing, invite, NOW).recipientMember, null);
  assert.deepEqual([memberAnswer(true), memberAnswer(false), memberAnswer('yes'), memberAnswer(undefined)], [true, false, null, null]);

  const row = { id: 'ABCDEFGHJKMNPQRS', state: 'prepared', bound: true, boundLogin: 'bomsn', code: 'X1', recipientMember: true };
  assert.ok(preparedRowMeta(row).includes('Already a member, so no free year is offered'));
  assert.ok(!preparedRowMeta({ ...row, recipientMember: null }).some((m) => m.startsWith('Already a member')));
  assert.ok(!preparedRowMeta({ ...row, state: 'claimed' }).some((m) => m.startsWith('Already a member')), 'a landed row is past the offer');
});

test('the tool and the editor no longer tell the preparer every invitation carries a year', () => {
  const tools = read('client/src/mcp-tools.mjs');
  const desc = tools.slice(tools.indexOf("name: 'prepare_listing'"), tools.indexOf("name: 'prepare_listing'") + 6000);
  assert.match(desc, /already a member, it grants no year and the page offers none, so never mention a free year in `message`/);
  assert.match(desc, /When that account is already a member, the invitation offers no free year\./);
  assert.match(desc, /grants to someone who is not a member yet/);
  assert.match(read('client-ui/src/prepared-editor.mjs'), /An account that is already a member is offered none\./);
});

test('the sign-in skip and this check read the overrides mirror through one function', () => {
  const signup = read('workers/signup/signup.mjs');
  assert.match(signup, /import \{ readFreshOverrides \} from '\.\/prepared-recipient\.mjs';/);
  assert.doesNotMatch(signup, /async function readFreshOverrides/, 'no second copy to drift');
  const admin = read('workers/signup/membership-prepared-admin.mjs');
  assert.match(admin, /recipientMember: deps\.recipientMember \?\? recipientIsMember/);
});
