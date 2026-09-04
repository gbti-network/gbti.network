// sow-312: the MEMBERS edition of the weekly digest.
//
// Two issues, routed by subscriber. Members and trial members get an edition carrying member-only shares;
// everybody else gets today's public issue unchanged. Each person receives exactly one.
//
// THE FAILURE THIS SUITE EXISTS FOR IS SILENT UNTIL SOMEBODY IS HARMED: a members-only share reaching a
// public inbox. So the leak test runs BOTH directions over the same pool, because a leak test that only ever
// asserts absence passes just as happily on an empty pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileWeeklyIssue, gatherContentEntries } from '../workers/signup/mail-compile.mjs';
import { getIssue, readPendingIndex } from '../workers/signup/mail-store.mjs';
import { subscriberKey } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';
import { buildDigestEntitlement, entitledIdsFrom, subscriberIsEntitled, DIGEST_ENTITLED_KV_KEY } from '../membership/digest-entitlement.mjs';
import { membersIssueId, isMembersIssueId, memberShareEntry } from '../membership/mail-compile-core.mjs';
import { composeIssue } from '../membership/mail-digest.mjs';

const at = (t) => () => t;
const NOW = Date.UTC(2026, 7, 25, 13, 0, 0);

function makeKV() {
  const m = new Map();
  return {
    m,
    async get(key, type) {
      const e = m.get(key);
      if (e == null) return null;
      if (type === 'json') { try { return JSON.parse(e.value); } catch { return null; } }
      return e.value;
    },
    async put(key, value) { m.set(key, { value: String(value) }); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const ACTIVITY = { entries: [
  { type: 'post', slug: 'p', title: 'Public post', url: '/articles/p/', author: 'ann', publishedAt: Date.UTC(2026, 7, 22), visibility: 'public' },
] };
const PUBLIC_SHARES = { entries: [
  { type: 'share', slug: 'ann/s1', title: 'A public share', author: 'ann', url: '/shares/ann/s1/', publishedAt: Date.UTC(2026, 7, 21), visibility: 'public' },
] };
// What the gated reader returns: public AND members shares, in shareSummary shape.
const SHARE_SUMMARIES = [
  { id: 's1', author: 'ann', title: 'A public share', shortDescription: 'public blurb', visibility: 'public', createdAt: '2026-08-21T00:00:00Z', body: 'x' },
  { id: 's2', author: 'ann', title: 'SECRET MEMBER SHARE', shortDescription: 'a members-only blurb', visibility: 'members', createdAt: '2026-08-23T00:00:00Z', body: '' },
];

const fakeFetch = (map) => async (url) => {
  for (const [suffix, body] of Object.entries(map)) if (String(url).endsWith(suffix)) return { ok: true, json: async () => body };
  return { ok: false, status: 404, json: async () => ({}) };
};

/** Seed one subscriber. An anon record carries NO githubId; a member record must carry one. */
function seed(kv, hash, { githubId = null, welcomedAt = 1 } = {}) {
  const base = githubId
    ? buildSubscriber({ hash, source: 'member', githubId }, { now: at(0) })
    : buildSubscriber({ hash, source: 'anon', emailEnc: `enc:${hash}` }, { now: at(0) });
  kv.m.set(subscriberKey(hash), { value: JSON.stringify({ ...base, welcomedAt }) });
}

function deps(kv, extra = {}) {
  return {
    kv,
    now: at(NOW),
    fetchImpl: fakeFetch({ '/activity-index.json': ACTIVITY, '/shares-index.json': PUBLIC_SHARES }),
    queryItems: async () => ({ items: [] }),
    siteUrl: 'https://gbti.network',
    readMemberShares: async () => SHARE_SUMMARIES,
    readEntitlement: async () => kv.get(DIGEST_ENTITLED_KV_KEY, 'json'),
    ...extra,
  };
}

const urlsIn = (issue) => {
  const out = [];
  for (const section of Object.values(issue?.sections ?? {})) for (const it of section || []) if (it?.url) out.push(it.url);
  return out;
};
const textOf = (issue) => JSON.stringify(issue);

// ---------------------------------------------------------------------------------------------------
// THE LEAK TEST, both directions over ONE pool.
// ---------------------------------------------------------------------------------------------------

test('the PUBLIC issue carries no member share, and the MEMBERS issue does: same pool, both directions', () => {
  // One pool containing a public share and a members share. If the members half of this ever stopped
  // asserting, the public half would keep passing forever on a pool that no longer had anything to leak.
  const items = SHARE_SUMMARIES.map(memberShareEntry).map((e) => ({
    kind: 'share', title: e.title, url: e.url, author: e.author, date: e.publishedAt, blurb: e.description, visibility: e.visibility,
  }));

  const pub = composeIssue({ issueId: 'weekly-2026-08-25', items, news: [], now: at(NOW) }, { audience: 'public' });
  assert.ok(!textOf(pub).includes('SECRET MEMBER SHARE'), 'a members share title reached the PUBLIC issue');
  assert.ok(!textOf(pub).includes('a members-only blurb'), 'a members share description reached the PUBLIC issue');
  assert.ok(urlsIn(pub).includes('/shares/ann/s1/'), 'the public share is missing, so this test proves nothing');

  const mem = composeIssue({ issueId: 'members-2026-08-25', items, news: [], now: at(NOW) }, { audience: 'members' });
  assert.ok(textOf(mem).includes('SECRET MEMBER SHARE'), 'the members issue is missing its member share');
  assert.ok(textOf(mem).includes('a members-only blurb'), 'the members issue dropped the member share description');
  assert.ok(urlsIn(mem).includes('/shares/ann/s1/'), 'the members issue must carry public shares too');
});

test('the member-share projection copies visibility VERBATIM, never a constant', () => {
  // This is the field the leak guard reads. Hardcoding it either way breaks something: 'public' leaks, and
  // 'members' would wrongly withhold a public share read through this same path.
  assert.equal(memberShareEntry(SHARE_SUMMARIES[0]).visibility, 'public');
  assert.equal(memberShareEntry(SHARE_SUMMARIES[1]).visibility, 'members');
  // A summary with an unexpected visibility passes it through unchanged, so composeIssue's fail-closed guard
  // is the thing that decides, rather than a second opinion here.
  assert.equal(memberShareEntry({ id: 'x', author: 'a', visibility: 'nonsense' }).visibility, 'nonsense');
  // No id or author means no url can be formed, so there is no entry at all.
  assert.equal(memberShareEntry({ id: 'x' }), null);
  assert.equal(memberShareEntry({ author: 'a' }), null);
});

// ---------------------------------------------------------------------------------------------------
// THE SPLIT.
// ---------------------------------------------------------------------------------------------------

test('the recipient base splits: entitled to the members issue, everybody else to the public one', async () => {
  const kv = makeKV();
  seed(kv, 'anonhash');                         // anonymous: no account at all
  seed(kv, 'freehash', { githubId: '30' });     // a signed-in member who is not paying
  seed(kv, 'paidhash', { githubId: '10' });
  seed(kv, 'trialhash', { githubId: '20' });
  await kv.put(DIGEST_ENTITLED_KV_KEY, JSON.stringify(buildDigestEntitlement([
    { githubId: '10', effective: { status: 'paid' } },
    { githubId: '20', effective: { status: 'trialing' } },
    { githubId: '30', effective: { status: 'expired' } },
  ])));

  const r = await compileWeeklyIssue({}, deps(kv));
  assert.equal(r.ok, true);
  assert.ok(r.membersEdition, `no members edition was produced: ${r.membersSkipped}`);
  assert.ok(isMembersIssueId(r.membersEdition.issueId));
  assert.equal(r.membersEdition.issueId, membersIssueId(NOW));

  const memberPending = await readPendingIndex(kv, r.membersEdition.issueId);
  const publicPending = await readPendingIndex(kv, r.issueId);
  assert.deepEqual([...memberPending].sort(), ['paidhash', 'trialhash'], 'the wrong people got the members edition');
  assert.deepEqual([...publicPending].sort(), ['anonhash', 'freehash'], 'the wrong people got the public issue');

  // NOBODY IS IN BOTH. That is what keeps this one email per person rather than two.
  const both = [...memberPending].filter((h) => publicPending.includes(h));
  assert.deepEqual(both, [], 'a subscriber landed in BOTH issues, which would send them two emails');
});

test('an ANONYMOUS subscriber cannot reach the members edition even if their hash is in the list', () => {
  // The construction argument is that an anon record carries no githubId, so there is nothing to match. That
  // is a claim about code which can change, so it is asserted rather than trusted.
  const entitled = entitledIdsFrom({ ids: ['10', 'anonhash', ''] });
  const anon = buildSubscriber({ hash: 'anonhash', source: 'anon', emailEnc: 'enc:x' }, { now: at(0) });
  assert.equal(anon.githubId, null, 'an anon record must not carry a githubId');
  assert.equal(subscriberIsEntitled(anon, entitled), false);
  assert.equal(subscriberIsEntitled({ githubId: '10' }, entitled), true, 'and a real member still matches');
});

// ---------------------------------------------------------------------------------------------------
// FAILING CLOSED. Every one of these sends everybody the public issue.
// ---------------------------------------------------------------------------------------------------

test('no entitlement list, an unreadable one, or a malformed one all send everybody the public issue', async () => {
  for (const [label, readEntitlement] of [
    ['absent', async () => null],
    ['unreadable', async () => { throw new Error('kv down'); }],
    ['malformed', async () => ({ ids: 'not an array' })],
    ['empty', async () => ({ ids: [] })],
  ]) {
    const kv = makeKV();
    seed(kv, 'paidhash', { githubId: '10' });
    const r = await compileWeeklyIssue({}, deps(kv, { readEntitlement }));
    assert.equal(r.membersEdition, null, `${label}: a members edition was produced anyway`);
    assert.ok(r.membersSkipped, `${label}: no reason was recorded`);
    assert.deepEqual(await readPendingIndex(kv, r.issueId), ['paidhash'], `${label}: the member did not get the public issue`);
    assert.equal(await getIssue(kv, membersIssueId(NOW)), null, `${label}: a members issue was frozen anyway`);
  }
});

test('a week with NO member-only share falls back to the public issue for everybody', async () => {
  // Owner ruling: there is nothing for the edition to add, so a near-identical second mail would only puzzle
  // the reader. The count is taken against the public issue's urls rather than by re-reading visibility,
  // because by that point every item has been through the public-safe projection.
  const kv = makeKV();
  seed(kv, 'paidhash', { githubId: '10' });
  await kv.put(DIGEST_ENTITLED_KV_KEY, JSON.stringify(buildDigestEntitlement([{ githubId: '10', effective: { status: 'paid' } }])));
  const r = await compileWeeklyIssue({}, deps(kv, { readMemberShares: async () => [SHARE_SUMMARIES[0]] })); // public share only
  assert.equal(r.membersEdition, null);
  assert.match(String(r.membersSkipped), /no member-only items/);
  assert.deepEqual(await readPendingIndex(kv, r.issueId), ['paidhash']);
});

test('a FAILED member-share read degrades the edition instead of leaking or crashing', async () => {
  // The fallback is the public artifact, which is the NARROW direction: the members edition can lose its
  // member shares to a GitHub blip, and can never gain something it should not have.
  const entries = await gatherContentEntries({}, {
    fetchImpl: fakeFetch({ '/activity-index.json': ACTIVITY, '/shares-index.json': PUBLIC_SHARES }),
    siteUrl: 'https://x',
    audience: 'members',
    readMemberShares: async () => { throw new Error('github down'); },
  });
  const shares = entries.filter((e) => e.type === 'share');
  assert.equal(shares.length, 1, 'the fallback did not supply the public shares');
  assert.equal(shares[0].visibility, 'public');
  assert.ok(!JSON.stringify(entries).includes('SECRET MEMBER SHARE'));
});

test('the members audience takes shares from ONE source, so a public share is never doubled', async () => {
  // enumerateShares returns public shares as well, so reading both it and the artifact would list every
  // public share twice. Taking one source instead of deduping is what makes that impossible rather than fixed.
  const entries = await gatherContentEntries({}, {
    fetchImpl: fakeFetch({ '/activity-index.json': ACTIVITY, '/shares-index.json': PUBLIC_SHARES }),
    siteUrl: 'https://x', audience: 'members', readMemberShares: async () => SHARE_SUMMARIES,
  });
  const slugs = entries.filter((e) => e.type === 'share').map((e) => e.slug);
  assert.deepEqual(slugs.slice().sort(), ['ann/s1', 'ann/s2']);
  assert.equal(new Set(slugs).size, slugs.length, 'a share appeared twice');
});

test('the two editions keep SEPARATE histories, so neither counts the other as already mailed', async () => {
  // The trap this design exists to avoid. Both ids carry the same date, so if the family filter were dropped
  // the members issue would sort into the public family's window and each would treat the other's contents as
  // already sent.
  const kv = makeKV();
  seed(kv, 'paidhash', { githubId: '10' });
  await kv.put(DIGEST_ENTITLED_KV_KEY, JSON.stringify(buildDigestEntitlement([{ githubId: '10', effective: { status: 'paid' } }])));
  const r = await compileWeeklyIssue({}, deps(kv));
  assert.ok(r.membersEdition);

  const { resolveWindow } = await import('../workers/signup/mail-compile.mjs');
  const nextWeek = NOW + 7 * 86400000;

  // BOTH DIRECTIONS, and the first version of this test only had one. It asserted the PUBLIC window ignores
  // the members issue, which a hardcoded 'weekly-' filter satisfies by accident, so the mutation that removes
  // the family parameter entirely SURVIVED it. The direction that actually catches that is the other one.
  const pub = await resolveWindow(kv, { nowMs: nextWeek, currentIssueId: 'weekly-2026-09-01' });
  assert.equal(pub.firstIssue, false, 'the public window should see its own prior weekly');
  assert.ok(![...(pub.exclude ?? [])].some((u) => String(u).includes('/shares/ann/s2/')),
    'the members edition leaked into the PUBLIC family history, which would drop items from both');

  const mem = await resolveWindow(kv, { nowMs: nextWeek, currentIssueId: 'members-2026-09-01', family: 'members-' });
  assert.equal(mem.firstIssue, false, 'the members window should see its own prior members edition');
  // The public issue carried the public post. If the members family were reading the weekly family's history,
  // that url would be in its exclude set from an issue it never sent.
  const publicOnlyUrl = '/articles/p/';
  const memExcluded = [...(mem.exclude ?? [])].map(String);
  const pubExcluded = [...(pub.exclude ?? [])].map(String);
  assert.ok(pubExcluded.some((u) => u.includes(publicOnlyUrl)), 'the fixture is wrong: the public issue never carried the post');
  assert.ok(memExcluded.some((u) => u.includes(publicOnlyUrl)),
    'the members edition carries the public post too, so its own history should exclude it');
  // The decisive one: the two windows must be reading DIFFERENT issues, not the same list.
  assert.notDeepEqual(
    { since: mem.since, n: memExcluded.length },
    { since: pub.since, n: pubExcluded.length },
    'the two families resolved identical windows, so they are reading one shared history',
  );
});

test('a re-run reuses the frozen members edition instead of recomposing it', async () => {
  // Same idempotency the public path has. Composing twice would be harmless in content and wasteful in
  // network calls, but re-enqueuing must not double-send, which is what this really pins.
  const kv = makeKV();
  seed(kv, 'paidhash', { githubId: '10' });
  await kv.put(DIGEST_ENTITLED_KV_KEY, JSON.stringify(buildDigestEntitlement([{ githubId: '10', effective: { status: 'paid' } }])));
  const first = await compileWeeklyIssue({}, deps(kv));
  let reads = 0;
  const second = await compileWeeklyIssue({}, deps(kv, { readMemberShares: async () => { reads++; return SHARE_SUMMARIES; } }));
  assert.equal(reads, 0, 'the second run re-read the shares instead of reusing the frozen edition');
  assert.equal(second.membersEdition.issueId, first.membersEdition.issueId);
  assert.equal(second.membersEdition.enqueued, 0, 'a re-run must not enqueue the same recipient twice');
});
