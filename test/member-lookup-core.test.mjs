// sow-331: the pure half of the superadmin member lookup (membership/member-lookup.mjs). Query classification, the
// candidate merge that keeps which paths matched, the "a failed read is never empty" rule, and each summary run
// against the store's real shape (the summaries call each store's own normalizer, so a fixture here in the wrong shape
// reads as empty, which is exactly what these tests would catch).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyQuery, mergeCandidates, section, summarizeCustomer, summarizeStanding, summarizeCoupons, invitesFor,
  summarizeActivity, summarizeFollows, summarizeFollowers, summarizePrefs, summarizeNotifications, summarizeDrafts,
  summarizeModeration, summarizeMailEntry, contentForUsername, summarizeApplication,
} from '../membership/member-lookup.mjs';

const NOW = new Date('2026-09-14T12:00:00Z');

test('classifyQuery: an address is lowercased and trimmed, a username keeps its case, a leading @ is a username', () => {
  assert.deepEqual(classifyQuery('  Member@Example.COM '), { kind: 'email', value: 'member@example.com' });
  assert.deepEqual(classifyQuery('AtwellPub'), { kind: 'login', value: 'AtwellPub' });
  assert.deepEqual(classifyQuery('@gbtilabs'), { kind: 'login', value: 'gbtilabs' });
});

test('classifyQuery: anything that could break out of a search literal, or is not a login, is invalid', () => {
  for (const bad of ['', '   ', null, "a'@b.co", 'a"b@c.co', 'a\\b@c.co', 'a b@c.co', 'a@b', '-x', 'x-', 'a--b', 'x'.repeat(40), "o'brien"]) {
    assert.equal(classifyQuery(bad).kind, 'invalid', `must refuse ${JSON.stringify(bad)}`);
  }
});

test('mergeCandidates: one candidate per account, every matching path kept, most agreement first', () => {
  const out = mergeCandidates([
    { githubId: '7', via: 'shoptalk' },
    { githubId: '42', via: 'stripe-email', login: 'Member', stripeStatus: 'paid' },
    { githubId: '42', via: 'digest-record' },
    { githubId: '42', via: 'stripe-email', login: 'member' },
    { githubId: 'not-an-id', via: 'stripe-email' },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { githubId: '42', via: ['stripe-email', 'digest-record'], logins: ['Member'], stripeStatus: 'paid' });
  assert.deepEqual(out[1].via, ['shoptalk']);
});

test('section: a throwing read is { ok: false }, never an empty value', async () => {
  assert.deepEqual(await section(async () => { throw new Error('kv down'); }), { ok: false, reason: 'could not read' });
  assert.deepEqual(await section(async () => ({ favorites: 0 })), { ok: true, data: { favorites: 0 } });
  assert.deepEqual(await section(async () => null), { ok: true, data: null });
});

test('summarizeCustomer: metadata, the derived status and each subscription', () => {
  const s = summarizeCustomer({
    id: 'cus_1', email: 'm@example.com', created: 1780000000,
    metadata: { github_id: '42', github_login: 'member', discord_user_id: '99', referred_by: '7' },
    subscriptions: { data: [{ id: 'sub_1', status: 'active', items: { data: [{ price: { id: 'price_1' } }] }, current_period_end: 1790000000, cancel_at_period_end: true }] },
  }, { status: 'paid', tier: 'member' });
  assert.equal(s.login, 'member');
  assert.equal(s.stripeStatus, 'paid');
  assert.equal(s.referredBy, '7');
  assert.deepEqual(s.subscriptions[0], { id: 'sub_1', status: 'active', priceId: 'price_1', currentPeriodEnd: new Date(1790000000 * 1000).toISOString(), cancelAtPeriodEnd: true });
  assert.equal(summarizeCustomer(null), null);
});

const MIRROR = {
  generatedAt: NOW.toISOString(),
  roles: { superadmins: [{ github_id: '1', login: 'boss' }], admins: [], moderators: [{ github_id: '42', login: 'member' }], newsEditors: [{ github_id: '42' }] },
  bans: { bans: [{ github_id: '66', login: 'spammer', reason: 'posted spam links', at: '2026-09-01T00:00:00Z' }] },
  grandfathered: { grandfathered: [{ github_id: '42', reason: 'founding member', until: '2027-01-01' }] },
};

test('summarizeStanding: the ban reason is shown (superadmin view) and a ban outranks everything', () => {
  const s = summarizeStanding(MIRROR, '66', { status: 'paid' }, NOW);
  assert.equal(s.effectiveStatus, 'banned');
  assert.equal(s.effectiveSource, 'ban');
  assert.equal(s.ban.reason, 'posted spam links');
});

test('summarizeStanding: staff role, news editor and an active grandfather grant', () => {
  const s = summarizeStanding(MIRROR, '42', { status: 'none' }, NOW);
  assert.equal(s.role, 'moderator');
  assert.equal(s.newsEditor, true);
  assert.equal(s.effectiveSource, 'staff');
  assert.equal(s.grandfather.active, true);
  assert.equal(s.ban, null);
});

test('summarizeStanding: with Stripe unreadable, a Stripe-decided status is unknown rather than a guess', () => {
  const s = summarizeStanding(MIRROR, '500', null, NOW);
  assert.equal(s.effectiveStatus, 'unknown');
  assert.equal(s.effectiveSource, 'stripe-unreadable');
  assert.equal(summarizeStanding(MIRROR, '66', null, NOW).effectiveStatus, 'banned', 'an override still decides without Stripe');
});

test('summarizeCoupons: the grant with whether it is still active, and codes from the redemption keys for this id only', () => {
  const s = summarizeCoupons({ code: 'CODEABLEYEAR', until: '2027-09-01T00:00:00Z' }, ['redemption:CODEABLEYEAR:42', 'redemption:HUDSINVITE:420', 'redemption:LINKEDINCONNECT:42', 'redemptions:CODEABLEYEAR'], '42', NOW);
  assert.deepEqual(s, { grant: { code: 'CODEABLEYEAR', until: '2027-09-01T00:00:00Z', active: true }, redeemed: ['CODEABLEYEAR', 'LINKEDINCONNECT'] });
  assert.equal(summarizeCoupons({ code: 'X', until: '2020-01-01' }, [], '42', NOW).grant.active, false);
});

test('invitesFor: issued and redeemed are split by the id inside the record', () => {
  const rec = (code, issuedBy, redeemedBy) => ({ code, campaign: 'HUDSINVITE', issuedAt: '2026-09-01T00:00:00Z', issuedBy, redeemedBy, redeemedAt: redeemedBy ? '2026-09-02T00:00:00Z' : null });
  const out = invitesFor([rec('HUDSABCDEFGHJK', '42', null), rec('HUDSMNPQRSTVWX', '1', '42'), rec('HUDSZZZZZZZZZZ', '1', '7'), null], '42', NOW);
  assert.deepEqual(out.issued.map((i) => i.code), ['HUDSABCDEFGHJK']);
  assert.deepEqual(out.redeemed.map((i) => [i.code, i.state]), [['HUDSMNPQRSTVWX', 'redeemed']]);
});

test('summaries read each store in its real shape', () => {
  const activity = { favorites: [{ type: 'post', slug: 'a', addedAt: 1 }, { type: 'product', slug: 'b', addedAt: 2 }], collections: [{ id: 'c1', name: 'Reading', createdAt: 1, items: [{ type: 'prompt', slug: 'p', addedAt: 1 }] }], updatedAt: 1780000000000 };
  assert.deepEqual(summarizeActivity(activity), { favorites: 2, collections: [{ name: 'Reading', items: 1 }], updatedAt: new Date(1780000000000).toISOString() });
  assert.deepEqual(summarizeFollows({ following: [{ username: 'atwellpub', addedAt: 1 }], updatedAt: 1 }), { count: 1, usernames: ['atwellpub'] });
  assert.deepEqual(summarizeFollowers({ followers: [{ githubId: '7', addedAt: 1 }, { githubId: '8', addedAt: 1 }] }), { count: 2 });
  assert.deepEqual(summarizePrefs({ categories: ['ai'], followedChannels: ['hn'], followedTags: ['rust'], publicFavorites: true }), { topics: 1, newsChannels: 1, tags: 1, publicFavorites: true, notificationDefaultsSet: false });
  assert.equal(summarizePrefs(null), null, 'no prefs record is null, not a zeroed record');
  const n = { items: [{ id: 'n1', type: 'mention', target: { type: 'post', slug: 'a' }, createdAt: 2, seen: false }, { id: 'n2', type: 'mention', target: { type: 'post', slug: 'b' }, createdAt: 1, seen: true }] };
  assert.deepEqual(summarizeNotifications(n), { total: 2, unseen: 1 });
  assert.deepEqual(summarizeDrafts({ items: { 'post:a': { updatedAt: '2026-09-01T00:00:00Z', body: 'secret draft text' } } }), [{ key: 'post:a', updatedAt: '2026-09-01T00:00:00.000Z' }]);
});

test('summarizeDrafts never carries the draft text', () => {
  const out = JSON.stringify(summarizeDrafts({ items: { 'post:a': { updatedAt: 1, title: 'Unpublished title', body: 'unpublished body' } } }));
  assert.ok(!out.includes('Unpublished') && !out.includes('unpublished body'));
});

test('summarizeApplication: the state from the applications core, null when there is none', () => {
  assert.equal(summarizeApplication(null), null);
  assert.equal(summarizeApplication({ githubId: '42', submittedAt: '2026-09-01', decision: null }).state, 'pending');
  assert.equal(summarizeApplication({ githubId: '42', decision: 'declined', decisionNote: 'not yet' }).decisionNote, 'not yet');
});

test('summarizeModeration: newest first, with the actor and the reason', () => {
  const out = summarizeModeration([
    { at: '2026-09-01T00:00:00Z', action: 'ban', actor: { github_id: '1', login: 'boss' }, detail: { reason: 'spam' } },
    { at: '2026-09-05T00:00:00Z', action: 'unban', actor: { github_id: '1', login: 'boss' }, detail: null },
  ]);
  assert.deepEqual(out.map((e) => e.action), ['unban', 'ban']);
  assert.equal(out[1].reason, 'spam');
});

test('summarizeMailEntry: a member record that switched the digest off, blocked, with bounces', () => {
  const e = summarizeMailEntry({ record: { hash: 'h', source: 'member', githubId: '42', status: 'active', digestOff: true, createdAt: 1780000000000 }, suppressed: true, softBounce: { n: 2 }, where: 'account email' });
  assert.equal(e.subscribed, true);
  assert.equal(e.receivesDigest, false);
  assert.equal(e.digestOff, true);
  assert.equal(e.unsubscribeBlock, true);
  assert.equal(e.softBounces, 2);
  assert.equal(summarizeMailEntry({ record: null, where: 'searched address' }).subscribed, false);
});

test('contentForUsername: this author only, deduped across indexes, newest first, dates as numbers', () => {
  const activity = { entries: [
    { type: 'post', slug: 'old', title: 'Old', author: 'Member', url: '/articles/old/', publishedAt: 100 },
    { type: 'post', slug: 'new', title: 'New', author: 'member', url: '/articles/new/', publishedAt: 900 },
    { type: 'project', slug: 'p', title: 'P', author: 'someone', url: '/projects/p/', publishedAt: 500 },
  ] };
  const shares = { entries: [{ type: 'share', slug: 'member/1', title: 'S', author: 'member', url: '/shares/member/1/', publishedAt: 50 }] };
  const comments = { items: [{ id: 'c1', author: 'member', targetType: 'post', targetSlug: 'x', createdAt: '2026-09-01T00:00:00Z', visibility: 'public' }] };
  const out = contentForUsername('member', { activity, shares: { entries: [...shares.entries, ...shares.entries] }, comments });
  assert.deepEqual(out.articles.map((a) => a.title), ['New', 'Old']);
  assert.equal(out.projects.length, 0);
  assert.equal(out.shares.length, 1);
  assert.equal(out.comments[0].target, 'post/x');
  assert.deepEqual(contentForUsername('', { activity }).articles, []);
});
