// sow-331: GET /membership/admin/member-lookup (workers/signup/membership-member-lookup.mjs). The REAL superadmin gate
// over a fake KV (bearer token -> fetchUser -> role from the overrides mirror), a fake Stripe client that counts its
// calls, real mailHash. Each owner decision and each failure rule has a test that goes red if it is broken:
// superadmins only, a failed store is never shown as empty, a failed search path is never reported as "no member",
// the sweeps are budgeted, and the searched address is never logged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipMemberLookup, INVITE_READ_BUDGET, MAIL_SCAN_BUDGET } from '../workers/signup/membership-member-lookup.mjs';
import { OVERRIDES_KV_KEY } from '../workers/signup/membership-content.mjs';
import { mailHash, subscriberKey, suppressKey, SUPPRESS_VALUE } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';

const NOW = new Date('2026-09-14T12:00:00Z');
const EMAIL = 'member@example.com';
const MIRROR = {
  generatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  roles: { superadmins: [{ github_id: '1', login: 'boss' }], admins: [{ github_id: '2', login: 'adm' }], moderators: [{ github_id: '3', login: 'mod' }] },
  bans: { bans: [{ github_id: '66', login: 'Spammer', reason: 'posted spam links' }, { github_id: '5', login: 'fallen' }] },
  grandfathered: { grandfathered: [] },
};

function fakeKv(seed = {}) {
  const map = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const kv = {
    map,
    gets: [],
    failGet: null,
    async get(k, type) {
      kv.gets.push(k);
      if (kv.failGet && kv.failGet(k)) throw new Error('kv read failed');
      if (!map.has(k)) return null;
      const v = map.get(k);
      const want = typeof type === 'object' ? type?.type : type;
      return want === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { map.set(k, String(v)); },
    async delete(k) { map.delete(k); },
    async list({ prefix = '', limit = 1000 } = {}) {
      const names = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { keys: names.slice(0, limit).map((name) => ({ name })), list_complete: names.length <= limit, cursor: names.length > limit ? 'more' : undefined };
    },
  };
  return kv;
}

const customer = (id, githubId, { login = 'member', email = EMAIL, status = 'active' } = {}) => ({
  id, email, created: 1780000000,
  metadata: { github_id: githubId, github_login: login },
  subscriptions: { data: status ? [{ id: `sub_${id}`, status, items: { data: [{ price: { id: 'price_x' } }] }, current_period_end: 1800000000 }] : [] },
});

function fakeStripe({ byEmail = [], byLogin = [], byId = {}, fail = false } = {}) {
  const s = {
    calls: [],
    async searchCustomersByEmail(e) { s.calls.push(['email', e]); if (fail) throw new Error('stripe down'); return byEmail; },
    async searchCustomersByLogin(l) { s.calls.push(['login', l]); if (fail) throw new Error('stripe down'); return byLogin; },
    async searchCustomerByGithubId(id) { s.calls.push(['id', id]); if (fail) throw new Error('stripe down'); return byId[id] ?? null; },
    async getCustomer(cid) { s.calls.push(['get', cid]); if (fail) throw new Error('stripe down'); return Object.values(byId).find((c) => c.id === cid) ?? null; },
  };
  return s;
}

const fetchUser = async (token) => {
  const map = { sa: '1', admin: '2', mod: '3', member: '9', fallen: '5' };
  if (!map[token]) throw new Error('bad token');
  return { githubId: map[token], login: token };
};

const INDEXES = {
  '/activity-index.json': { entries: [
    { type: 'post', slug: 'hello', title: 'Hello', author: 'member', url: '/articles/hello/', publishedAt: 200 },
    { type: 'post', slug: 'other', title: 'Other', author: 'someone', url: '/articles/other/', publishedAt: 300 },
  ] },
  '/shares-index.json': { entries: [] },
  '/comments-index.json': { items: [] },
};

function setup({ token = 'sa', seed = {}, stripe = fakeStripe(), limiterAllowed = true, index = new Map([['42', 'member']]), indexes = INDEXES, env: extraEnv = {} } = {}) {
  const kv = fakeKv({ [OVERRIDES_KV_KEY]: MIRROR, ...seed });
  const env = { SIGNUP_KV: kv, MAIL_SUPPRESS_KEY: 'test-suppress-key', ...extraEnv };
  const calls = { limiter: 0, index: 0, site: [] };
  const deps = {
    fetchUser, now: NOW, stripe,
    limiter: async () => { calls.limiter += 1; return { allowed: limiterAllowed }; },
    readMembersIndex: async () => { calls.index += 1; if (index instanceof Error) throw index; return index; },
    readIndex: async (path) => { calls.site.push(path); if (indexes instanceof Error) throw indexes; return indexes[path]; },
  };
  const run = (qs) => membershipMemberLookup(new Request(`https://signup.gbti.network/membership/admin/member-lookup?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }), env, deps);
  return { kv, env, stripe, calls, run };
}

const q = (v) => `q=${encodeURIComponent(v)}`;

test('superadmins only: an admin and a moderator get 403, no token 401, a banned superadmin is refused, and nothing is read', async () => {
  for (const [token, status] of [['admin', 403], ['mod', 403], ['member', 403], [null, 401]]) {
    const t = setup({ token });
    const r = await t.run(q(EMAIL));
    assert.equal(r.status, status, `${token} must get ${status}`);
    assert.equal(t.stripe.calls.length, 0, 'no Stripe call before the gate passes');
    assert.equal(t.calls.limiter, 0);
  }
  const banned = setup({ token: 'sa' });
  banned.kv.map.set(OVERRIDES_KV_KEY, JSON.stringify({ ...MIRROR, bans: { bans: [{ github_id: '1' }] } }));
  assert.equal((await banned.run(q(EMAIL))).status, 403, 'a banned superadmin is denied (ban > staff)');
});

test('a stale overrides mirror fails closed at the gate', async () => {
  const t = setup();
  t.kv.map.set(OVERRIDES_KV_KEY, JSON.stringify({ ...MIRROR, generatedAt: '2026-01-01T00:00:00Z' }));
  assert.equal((await t.run(q(EMAIL))).status, 403);
  assert.equal(t.stripe.calls.length, 0);
});

test('an address with one member opens the record, with the path that found it', async () => {
  const c = customer('cus_1', '42');
  const t = setup({ stripe: fakeStripe({ byEmail: [c], byId: { 42: c } }) });
  const r = await t.run(q('  Member@Example.com '));
  assert.equal(r.status, 200);
  assert.equal(r.body.kind, 'member');
  assert.deepEqual(r.body.via, ['stripe-email']);
  assert.equal(r.body.everySearched, true);
  const s = r.body.record.sections;
  assert.equal(s.account.ok, true);
  assert.equal(s.account.data.email, EMAIL);
  assert.equal(s.standing.ok, true);
  assert.equal(s.username.data, 'member');
  assert.deepEqual(s.content.data.items.articles.map((a) => a.title), ['Hello']);
  assert.equal(t.stripe.calls[0][1], EMAIL, 'the search runs on the trimmed, lowercased address');
  assert.ok(t.stripe.calls.length <= 3, `at most three Stripe calls, saw ${t.stripe.calls.length}`);
});

test('an address shared by two accounts lists both for the superadmin to pick, without assembling a record', async () => {
  const t = setup({ stripe: fakeStripe({ byEmail: [customer('cus_1', '42', { login: 'member' }), customer('cus_2', '43', { login: 'member-alt', status: null })] }) });
  const r = await t.run(q(EMAIL));
  assert.equal(r.body.kind, 'candidates');
  assert.deepEqual(r.body.candidates.map((c) => [c.githubId, c.logins[0]]), [['42', 'member'], ['43', 'member-alt']]);
  assert.equal(r.body.record, undefined);
  assert.ok(!t.kv.gets.some((k) => k.startsWith('activity:')), 'no per-member store is read for a list');
});

test('?githubId= opens one account; a malformed id is refused', async () => {
  const c = customer('cus_1', '43', { login: 'member-alt' });
  const t = setup({ stripe: fakeStripe({ byId: { 43: c } }) });
  const r = await t.run('githubId=43');
  assert.equal(r.body.kind, 'member');
  assert.equal(r.body.record.githubId, '43');
  assert.equal(r.body.record.sections.account.data.login, 'member-alt');
  for (const bad of ['abc', ' 43', '43 ', '', '1e3']) assert.equal((await t.run(`githubId=${encodeURIComponent(bad)}`)).status, 400, `must refuse ${JSON.stringify(bad)}`);
});

test('an address with no member reports what the digest store holds for it', async () => {
  const hash = await mailHash('test-suppress-key', 'reader@example.com');
  const anon = buildSubscriber({ hash, source: 'anon', emailEnc: 'ciphertext' }, { now: () => 1780000000000 });
  const t = setup({ seed: { [subscriberKey(hash)]: anon, [suppressKey(hash)]: SUPPRESS_VALUE } });
  const r = await t.run(q('reader@example.com'));
  assert.equal(r.body.kind, 'none');
  assert.equal(r.body.everySearched, true);
  assert.equal(r.body.nonMember.subscribed, true);
  assert.equal(r.body.nonMember.source, 'anon');
  assert.equal(r.body.nonMember.unsubscribeBlock, true);
});

test('a search path that failed is never reported as "no member": everySearched is false and names the path', async () => {
  const t = setup({ stripe: fakeStripe({ fail: true }) });
  const r = await t.run(q(EMAIL));
  assert.equal(r.body.kind, 'none');
  assert.equal(r.body.everySearched, false);
  assert.equal(r.body.searched.stripe.ok, false);
  assert.equal(r.body.searched.digest.ok, true);
});

test('the digest record and the Shop Talk list each resolve an address to its member', async () => {
  const hash = await mailHash('test-suppress-key', EMAIL);
  const rec = buildSubscriber({ hash, source: 'member', githubId: '42' }, { now: () => 1 });
  const t = setup({ seed: { [subscriberKey(hash)]: rec, 'shoptalk:seen': { [EMAIL]: '42' } } });
  const r = await t.run(q(EMAIL));
  assert.equal(r.body.kind, 'member');
  assert.deepEqual(r.body.via, ['digest-record', 'shoptalk']);
  assert.deepEqual(r.body.record.sections.shoptalk.data, { optedOut: false, invitedAddresses: [EMAIL] });
});

test('a username resolves through the members index, Stripe and the overrides lists, merged to one account', async () => {
  const t = setup({ index: new Map([['66', 'spammer']]), stripe: fakeStripe({ byLogin: [customer('cus_9', '66', { login: 'Spammer' })] }) });
  const r = await t.run(q('Spammer'));
  assert.equal(r.body.kind, 'member');
  assert.deepEqual(r.body.via, ['members-index', 'stripe-login', 'overrides']);
  assert.equal(r.body.record.sections.standing.data.effectiveStatus, 'banned');
  assert.equal(r.body.record.sections.standing.data.ban.reason, 'posted spam links', 'the superadmin sees the ban reason');
});

// Every per-member store, and the section that reports it. Breaking any one read must turn exactly that section
// unreadable while every other section still reads.
const STORE_SECTIONS = [
  ['activity:42', 'activity'], ['follows:42', 'follows'], ['followers:42', 'followers'], ['prefs:42', 'prefs'],
  ['notifications:42', 'notifications'], ['drafts:42', 'drafts'], ['earnings:42', 'earnings'], ['conv:42', 'conversion'],
  ['application:42', 'application'], ['coupon-grant:42', 'coupons'], ['shoptalk:optout:42', 'shoptalk'], ['gh:42', 'account'],
];

for (const [key, name] of STORE_SECTIONS) {
  test(`a failed read of ${key} shows the ${name} section as could not read, never as empty`, async () => {
    const t = setup({ stripe: fakeStripe({ byId: { 42: customer('cus_1', '42') } }) });
    t.kv.failGet = (k) => k === key;
    const r = await t.run('githubId=42');
    const s = r.body.record.sections;
    assert.equal(s[name].ok, false, `${name} must be unreadable`);
    assert.equal(s[name].data, undefined, 'an unreadable section carries no data at all');
    const others = Object.entries(s).filter(([n]) => n !== name && !(name === 'account' && (n === 'mail')));
    for (const [n, v] of others) assert.equal(v.ok, true, `${n} must still read when only ${key} failed`);
  });
}

test('the same rule holds for the empty stores: a member with nothing stored reads as ok with empty values', async () => {
  const t = setup({ stripe: fakeStripe({ byId: { 42: customer('cus_1', '42') } }) });
  const s = (await t.run('githubId=42')).body.record.sections;
  assert.deepEqual(s.activity, { ok: true, data: { favorites: 0, collections: [], updatedAt: null } });
  assert.deepEqual(s.follows, { ok: true, data: { count: 0, usernames: [] } });
  assert.deepEqual(s.prefs, { ok: true, data: null });
});

test('the moderation history, the application and the coupon lock are read for the member', async () => {
  const t = setup({
    seed: {
      'modlog:42:2026-09-01T00:00:00Z:1': { at: '2026-09-01T00:00:00Z', action: 'ban', actor: { github_id: '1', login: 'boss' }, detail: { reason: 'spam' } },
      'modlog:420:2026-09-02T00:00:00Z:1': { at: '2026-09-02T00:00:00Z', action: 'ban', actor: { github_id: '1' }, detail: null },
      'application:42': { githubId: '42', submittedAt: '2026-09-01T00:00:00Z', decision: null },
      'coupon-grant:42': { code: 'CODEABLEYEAR', until: '2027-09-01T00:00:00Z' },
      'redemption:CODEABLEYEAR:42': { until: '2027-09-01T00:00:00Z' },
    },
    stripe: fakeStripe({ byId: { 42: customer('cus_1', '42') } }),
  });
  const s = (await t.run('githubId=42')).body.record.sections;
  assert.equal(s.moderation.data.entries.length, 1, 'the prefix ends in a colon, so modlog:420 is not this member');
  assert.equal(s.moderation.data.entries[0].reason, 'spam');
  assert.equal(s.application.data.state, 'pending');
  assert.deepEqual(s.coupons.data, { grant: { code: 'CODEABLEYEAR', until: '2027-09-01T00:00:00Z', active: true }, redeemed: ['CODEABLEYEAR'] });
});

test('the invite sweep is budgeted and says when it stopped short', async () => {
  const seed = {};
  for (let i = 0; i < INVITE_READ_BUDGET + 20; i += 1) seed[`invite:HUDS${String(i).padStart(10, '0')}`] = { code: `HUDS${String(i).padStart(10, '0')}`, campaign: 'HUDSINVITE', issuedBy: '1' };
  assert.equal(Object.keys(seed).length, INVITE_READ_BUDGET + 20, 'the fixture really holds more invites than the budget');
  const t = setup({ seed, stripe: fakeStripe({ byId: { 42: customer('cus_1', '42') } }) });
  const inv = (await t.run('githubId=42')).body.record.sections.invites.data;
  assert.equal(inv.complete, false);
  assert.equal(inv.read, INVITE_READ_BUDGET);
  assert.equal(t.kv.gets.filter((k) => k.startsWith('invite:')).length, INVITE_READ_BUDGET, 'no more invite reads than the budget');
});

test('mail: the record at the account email, and the member record under an older address found by the scan', async () => {
  const current = await mailHash('test-suppress-key', EMAIL);
  const older = await mailHash('test-suppress-key', 'old@example.com');
  const t = setup({
    seed: {
      [subscriberKey(older)]: buildSubscriber({ hash: older, source: 'member', githubId: '42', digestOff: true }, { now: () => 1 }),
      [`mail:softbounce:${older}`]: { n: 2 },
    },
    stripe: fakeStripe({ byId: { 42: customer('cus_1', '42') } }),
  });
  const mail = (await t.run('githubId=42')).body.record.sections.mail.data;
  assert.equal(mail.accountEmailChecked, true);
  assert.equal(mail.searchComplete, true);
  assert.deepEqual(mail.entries.map((e) => [e.where, e.subscribed]), [['account email', false], ['member record', true]]);
  assert.equal(mail.entries[1].digestOff, true);
  assert.equal(mail.entries[1].softBounces, 2);
  assert.ok(t.kv.gets.includes(subscriberKey(current)));
});

test('mail: a scan that ran out of budget says the search is incomplete rather than "not subscribed"', async () => {
  const seed = {};
  for (let i = 0; i < MAIL_SCAN_BUDGET + 5; i += 1) {
    const h = `h${String(i).padStart(4, '0')}`;
    seed[subscriberKey(h)] = buildSubscriber({ hash: h, source: 'member', githubId: '7' }, { now: () => 1 });
  }
  const t = setup({ seed, stripe: fakeStripe({ byId: { 42: customer('cus_1', '42') } }) });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const mail = (await t.run('githubId=42')).body.record.sections.mail.data;
    assert.equal(mail.searchComplete, false);
  } finally { console.warn = warn; }
});

test('content: an unreadable site index is could not read, and no folder is reported as no folder', async () => {
  const failing = setup({ indexes: new Error('site down'), stripe: fakeStripe({ byId: { 42: customer('cus_1', '42') } }) });
  assert.equal((await failing.run('githubId=42')).body.record.sections.content.ok, false);
  const noFolder = setup({ index: new Map(), stripe: fakeStripe({ byId: { 42: customer('cus_1', '42') } }) });
  assert.deepEqual((await noFolder.run('githubId=42')).body.record.sections.content, { ok: true, data: { username: null, items: null } });
  const noIndex = setup({ index: new Error('github down'), stripe: fakeStripe({ byId: { 42: customer('cus_1', '42') } }) });
  const s = (await noIndex.run('githubId=42')).body.record.sections;
  assert.equal(s.username.ok, false);
  assert.equal(s.content.ok, false, 'an unknown folder is not "no content"');
});

test('rate limited per caller: 429 before any Stripe call; an unusable query is 400 before any Stripe call', async () => {
  const limited = setup({ limiterAllowed: false });
  assert.equal((await limited.run(q(EMAIL))).status, 429);
  assert.equal(limited.stripe.calls.length, 0);
  const t = setup();
  for (const bad of ['', "o'brien@example.com", 'a b', '-x']) {
    assert.equal((await t.run(q(bad))).status, 400, `must refuse ${JSON.stringify(bad)}`);
  }
  assert.equal(t.stripe.calls.length, 0);
});

test('the searched address never reaches a log line', async () => {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try {
    const t = setup({ stripe: fakeStripe({ fail: true }) });
    t.kv.failGet = (k) => k.startsWith('mail:');
    await t.run(q('private.person@example.com'));
    await t.run(q('private.person@example.com') + '&githubId=42');
  } finally { Object.assign(console, saved); }
  assert.ok(!lines.some((l) => l.includes('private.person')), `an address was logged: ${lines.join(' | ')}`);
});
