// SOW-166: the weekly compile orchestrator. Fake fetch/news/KV; proves the pipe end to end: gather -> compose
// ONCE (members item excluded, news ranked by opens) -> freeze -> enqueue per subscriber, idempotent by the
// weekly issue id, and ALWAYS-SEND (a fully-empty week still composes and enqueues). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWeeklyIssue, compileWelcomeIssue, gatherContentEntries, gatherNewsEntries, listRecipientHashes, resolveWindow } from '../workers/signup/mail-compile.mjs';
import { getIssue, putIssue, readPendingIndex, getSend } from '../workers/signup/mail-store.mjs';
import { subscriberKey, MAIL_SUBSCRIBER_PREFIX } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';
import { applyOpen, normalizeNewsOpens } from '../membership/news-opens.mjs';
import { NEWS_OPENS_KEY } from '../workers/signup/membership-news-opened.mjs';

const at = (t) => () => t;

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
    async put(key, value, opts) { m.set(key, { value: String(value), opts: opts || null }); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '', cursor } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

// A fetch that maps a URL suffix to a JSON body; anything else is a 404.
function fakeFetch(map) {
  return async (url) => {
    for (const [suffix, body] of Object.entries(map)) {
      if (String(url).endsWith(suffix)) return { ok: true, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// Dates sit INSIDE the first-issue bootstrap window (now = 2026-08-25 13:00, so since = now - 90 days =
// 2026-05-27 13:00; owner ruling 2026-08-22, BOOTSTRAP_MS); if they did not, the content window would drop them
// and these tests would be measuring the window, not the compile. The members stub is in-window too, so it is
// dropped by VISIBILITY (the property under test), not by its date.
const ACTIVITY = { entries: [
  { type: 'post', slug: 'p', title: 'Public post', url: '/articles/p/', author: 'ann', publishedAt: Date.UTC(2026, 7, 22), visibility: 'public' },
  { type: 'post', slug: 'm', title: 'Members stub', url: '/articles/m/', author: 'ann', publishedAt: Date.UTC(2026, 7, 23), visibility: 'members' },
] };
const SHARES = { entries: [
  { type: 'share', slug: 'ann/s1', title: 'A public share', author: 'ann', url: '/shares/ann/s1/', publishedAt: Date.UTC(2026, 7, 21), visibility: 'public' },
] };
const NEWS_ITEMS = [
  { guid: 'g1', title: 'Hot news', link: 'https://n/1', source: 'Src', publishedAt: 1000 },
  { guid: 'g2', title: 'Cool news', link: 'https://n/2', source: 'Src2', publishedAt: 900 },
];

function opensRecord(openerIds) {
  let r = normalizeNewsOpens(null);
  for (const id of openerIds) r = applyOpen(r, { openerId: id }, { now: at(0) });
  return r;
}

// sow-166: `welcomedAt` defaults to a long-ago timestamp because every test using this helper is about WEEKLY
// mechanics (truncation, idempotency, ranking, always-send) and predates the welcome issue. Only a subscriber
// welcomed in an earlier cycle receives a weekly, so seeding them unwelcomed would silently empty the
// recipient base and those tests would pass on zero recipients while appearing to test delivery.
// Pass `{ welcomedAt: null }` to seed somebody who has NOT been welcomed.
function seedSubscribers(kv, hashes, { welcomedAt = 1 } = {}) {
  for (const h of hashes) {
    const rec = { ...buildSubscriber({ hash: h, source: 'anon', emailEnc: `enc:${h}` }, { now: at(0) }), welcomedAt };
    kv.m.set(subscriberKey(h), { value: JSON.stringify(rec), opts: null });
  }
}

function deps(kv) {
  return {
    kv,
    now: at(Date.UTC(2026, 7, 25, 13, 0, 0)), // 2026-08-25
    fetchImpl: fakeFetch({ '/activity-index.json': ACTIVITY, '/shares-index.json': SHARES }),
    queryItems: async () => ({ items: NEWS_ITEMS }),
    siteUrl: 'https://gbti.network',
  };
}

test('gatherContentEntries combines both artifacts; a failed fetch is fail-soft ([] for that artifact)', async () => {
  const both = await gatherContentEntries({}, { fetchImpl: fakeFetch({ '/activity-index.json': ACTIVITY, '/shares-index.json': SHARES }), siteUrl: 'https://x' });
  assert.equal(both.length, 3);
  const onlyShares = await gatherContentEntries({}, { fetchImpl: fakeFetch({ '/shares-index.json': SHARES }), siteUrl: 'https://x' });
  assert.equal(onlyShares.length, 1, 'a 404 on activity-index yields [] for it, not a crash');
  const none = await gatherContentEntries({}, { fetchImpl: async () => { throw new Error('network'); }, siteUrl: 'https://x' });
  assert.deepEqual(none, [], 'a thrown fetch is fail-soft');
});

test('gatherNewsEntries maps link->url + publishedAt->date and attaches the distinct-opener count', async () => {
  const kv = makeKV();
  kv.m.set(NEWS_OPENS_KEY('g1'), { value: JSON.stringify(opensRecord(['u1', 'u2', 'u3', 'u4', 'u5'])), opts: null });
  kv.m.set(NEWS_OPENS_KEY('g2'), { value: JSON.stringify(opensRecord(['u1', 'u2'])), opts: null });
  const out = await gatherNewsEntries({ SIGNUP_KV: kv, NEWS_KV: {} }, { kv, queryItems: async () => ({ items: NEWS_ITEMS }) });
  // + sourceName/digest/summary/image (sow-166, 2026-08-23). The fixture ids are not real sources, so
  // sourceName resolves to null and the renderer falls back to the id: unchanged behaviour, stated explicitly.
  assert.deepEqual(out[0], { title: 'Hot news', url: 'https://n/1', source: 'Src', sourceName: null, digest: undefined, summary: undefined, image: undefined, date: 1000, opens: 5 });
  assert.deepEqual(out[1], { title: 'Cool news', url: 'https://n/2', source: 'Src2', sourceName: null, digest: undefined, summary: undefined, image: undefined, date: 900, opens: 2 });
  // no NEWS_KV binding -> no news (the store is not ready), never a crash
  assert.deepEqual(await gatherNewsEntries({ SIGNUP_KV: kv }, { kv, queryItems: async () => ({ items: NEWS_ITEMS }) }), []);
});

test('listRecipientHashes returns receivable subscribers and drops an unreceivable record', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1', 'r2', 'r3']);
  kv.m.set(subscriberKey('bad'), { value: JSON.stringify({ hash: 'bad', source: 'anon' }), opts: null }); // no emailEnc -> not receivable
  const { hashes, truncated } = await listRecipientHashes(kv);
  assert.deepEqual([...hashes].sort(), ['r1', 'r2', 'r3']);
  assert.equal(truncated, false);
  assert.ok(!hashes.includes('bad'), 'a record with no usable address is excluded');
});

test('listRecipientHashes COUNTS an unreadable subscriber record and still returns the readable ones', async () => {
  // getSubscriber now THROWS on an unreadable record (was a swallow-to-null that dropped the recipient silently).
  const kv = makeKV();
  seedSubscribers(kv, ['r1', 'r2', 'r3']);
  const kvErr = { ...kv, async get(key, type) {
    if (key === subscriberKey('r2')) throw new Error('kv get failed');
    return kv.get(key, type);
  } };
  const { hashes, truncated, readErrors } = await listRecipientHashes(kvErr);
  assert.deepEqual([...hashes].sort(), ['r1', 'r3'], 'the readable subscribers are still returned; one blip does not abort the walk');
  assert.equal(readErrors, 1, 'the unreadable record is COUNTED, not swallowed (a swallow would silently short the base)');
  assert.equal(truncated, false, 'the page walk itself completed; readErrors is the separate incompleteness signal');
});

test('compileWeeklyIssue surfaces recipientsTruncated + recipientReadErrors when a subscriber record is unreadable', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1', 'r2', 'r3']);
  const kvErr = { ...kv, async get(key, type) {
    if (key === subscriberKey('r2')) throw new Error('kv get failed');
    return kv.get(key, type);
  } };
  const r = await compileWeeklyIssue({ SIGNUP_KV: kvErr, NEWS_KV: {} }, deps(kvErr));
  assert.equal(r.ok, true);
  assert.equal(r.recipients, 2, 'only the readable subscribers are enqueued (the unreadable one is skipped this compile)');
  assert.equal(r.recipientReadErrors, 1, 'the read error is surfaced for the cron log');
  assert.equal(r.recipientsTruncated, true, 'a silently-short base is folded into the truncated signal the cron MUST surface');
});

test('compileWeeklyIssue: composes ONCE, excludes the members item, ranks news by opens, enqueues everyone', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1', 'r2', 'r3']);
  kv.m.set(NEWS_OPENS_KEY('g1'), { value: JSON.stringify(opensRecord(['u1', 'u2', 'u3', 'u4', 'u5'])), opts: null });
  kv.m.set(NEWS_OPENS_KEY('g2'), { value: JSON.stringify(opensRecord(['u1', 'u2'])), opts: null });

  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(r.ok, true);
  assert.equal(r.issueId, 'weekly-2026-08-25');
  assert.equal(r.composed, true);
  assert.equal(r.recipients, 3);
  assert.equal(r.enqueued, 3);
  assert.equal(r.recipientsTruncated, false);

  const issue = await getIssue(kv, 'weekly-2026-08-25');
  assert.ok(issue, 'the issue is frozen in KV');
  // No prior issue seeded -> the FIRST-issue regime: a bootstrap window, no exclude set, launch wording.
  assert.equal(issue.window.since, Date.UTC(2026, 7, 25, 13, 0, 0) - 90 * 24 * 3600 * 1000, 'first issue bootstraps the window to now - 90 days (owner ruling 2026-08-22; never null)');
  assert.equal(issue.window.excluded, null, 'first issue carries no exclude set');
  assert.equal(r.firstIssue, true, 'the compile surfaces the launch regime');
  assert.deepEqual(issue.sections.article.map((a) => a.title), ['Public post'], 'the members stub was excluded by composeIssue');
  assert.deepEqual(issue.sections.share.map((s) => s.title), ['A public share']);
  assert.equal(issue.topNews[0].title, 'Hot news', 'news ranked by opens (5 > 2)');
  // every subscriber got a pending send record
  assert.deepEqual([...(await readPendingIndex(kv, 'weekly-2026-08-25'))].sort(), ['r1', 'r2', 'r3']);
  for (const h of ['r1', 'r2', 'r3']) assert.equal((await getSend(kv, 'weekly-2026-08-25', h)).status, 'pending');
});

// THE COMPILE-LEVEL TEST FOR THE 2026-08-24 DOUBLE SEND. The predicate has its own tests in
// mail-welcome.test.mjs, and they were NOT enough: the actual defect was in this caller, which took
// `previousGeneratedAt` off the window regime and dropped `since`. Reverting that one argument left every
// predicate test green, which is the definition of asserting the layer below the defect. This test is the
// one that goes red for it, so it earns its place by construction rather than by coverage.
test('compileWeeklyIssue: a FIRST issue does not re-mail somebody welcomed inside its own window', async () => {
  const NOW = Date.UTC(2026, 7, 25, 13, 0, 0);
  const kv = makeKV();
  // No prior weekly is seeded, so this is the first-issue regime with a 90-day bootstrap window.
  seedSubscribers(kv, ['earlier'], { welcomedAt: 1 });                    // welcomed long before the window
  seedSubscribers(kv, ['justNow'], { welcomedAt: NOW - 15 * 60 * 1000 }); // welcomed 15 minutes ago, as gbtilabs was

  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(r.firstIssue, true, 'guard: this must be the first-issue regime or the test proves nothing');
  assert.equal(r.recipients, 1, 'only the earlier-welcomed subscriber is a recipient');

  const pending = [...(await readPendingIndex(kv, 'weekly-2026-08-25'))].sort();
  assert.deepEqual(pending, ['earlier'], 'the just-welcomed subscriber has no send record for the weekly');
  assert.equal(await getSend(kv, 'weekly-2026-08-25', 'justNow'), null, 'and nothing was written for them at all');
});

test('compileWeeklyIssue is IDEMPOTENT: a re-run does not recompose or re-enqueue', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1', 'r2']);
  const first = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(first.composed, true);
  assert.equal(first.enqueued, 2);
  const second = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(second.composed, false, 'the frozen issue is reused, not recomposed');
  assert.equal(second.enqueued, 0, 'nobody is re-enqueued');
  assert.equal(second.recipients, 2);
});

test('ALWAYS-SEND: a fully-empty week (no content, no news) still composes and enqueues', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const emptyDeps = {
    ...deps(kv),
    fetchImpl: fakeFetch({}), // both artifacts 404 -> no member items
    queryItems: async () => ({ items: [] }), // no news
  };
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, emptyDeps);
  assert.equal(r.composed, true, 'the owner ruling is literal always-send, even fully empty');
  assert.equal(r.enqueued, 1);
  const issue = await getIssue(kv, 'weekly-2026-08-25');
  assert.ok(issue, 'an empty issue is still frozen and sent');
  assert.equal(issue.isEmpty, true, 'and it is honestly marked empty');
});

test('compileWeeklyIssue with no kv is a safe no-op', async () => {
  assert.deepEqual(await compileWeeklyIssue({}, { kv: null }), { ok: false, reason: 'no kv' });
});

// ---------- the issueId override (sow-166 follow-up: the admin rehearsal trigger) ----------
// The override exists so a manual send rehearsal can be fired on any day WITHOUT stealing the real inaugural
// issue's content. That property is cross-layer (the id shape decides what listPriorIssueIds counts), so it is
// proven here against the real compile, not asserted from the route module where the id is merely minted.

test('an explicit issueId overrides the date-derived one; omitting it keeps the weekly id', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const named = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, { ...deps(kv), issueId: 'test-2026-08-23' });
  assert.equal(named.issueId, 'test-2026-08-23');
  assert.ok(await getIssue(kv, 'test-2026-08-23'), 'the issue is frozen under the given id');
  assert.equal(await getIssue(kv, 'weekly-2026-08-25'), null, 'and NOT under the date-derived id');

  const dated = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(dated.issueId, 'weekly-2026-08-25', 'the cron path is unchanged by the new option');
});

test('a blank or whitespace issueId falls back to the date-derived id rather than minting a blank one', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, { ...deps(kv), issueId: '   ' });
  assert.equal(r.issueId, 'weekly-2026-08-25');
});

// THE POINT OF THE WHOLE OVERRIDE. A rehearsal must not become the real issue's prior, because the exclude
// window would then strip the back catalogue the inaugural issue is supposed to carry. Both halves are
// asserted: the rehearsal itself composes the launch regime, and the LATER weekly compile still does too.
test('a test- rehearsal does NOT become a prior of the next weekly issue (the inaugural window survives)', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const rehearsal = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, { ...deps(kv), issueId: 'test-2026-08-23' });
  assert.equal(rehearsal.firstIssue, true, 'a rehearsal composes exactly what the inaugural issue will compose');
  const rehearsedTitles = (await getIssue(kv, 'test-2026-08-23')).sections.article.map((a) => a.title);
  assert.ok(rehearsedTitles.length > 0, 'the rehearsal is non-empty, or this test proves nothing');

  const real = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(real.firstIssue, true, 'the real issue is STILL the launch regime after a rehearsal');
  assert.equal(real.excluded, null, 'and it excludes nothing, so the back catalogue is intact');
  assert.deepEqual((await getIssue(kv, 'weekly-2026-08-25')).sections.article.map((a) => a.title), rehearsedTitles);
});

// The control for the test above: a CANONICAL off-day compile is exactly the trap, and it must be visible as
// one. If this ever stops excluding, the rehearsal test above is passing for the wrong reason.
test('control: a canonical off-day compile DOES become a prior and strips the next issue', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const early = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, { ...deps(kv), issueId: 'weekly-2026-08-23' });
  assert.equal(early.firstIssue, true);
  const later = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(later.firstIssue, false, 'the off-day issue was counted as a prior');
  assert.ok(Number(later.excluded) > 0, 'and its urls are now excluded from the real issue');
});

// ---------- resolveWindow: the two composeIssue regimes (SowMaster ruling; `since` OR `exclude`, never both) ----------

const BOOTSTRAP = 90 * 24 * 3600 * 1000; // the first-issue window (owner ruling 2026-08-22, BOOTSTRAP_MS), was 7d
const gen = (mo, day) => Date.UTC(2026, mo, day, 13, 0, 0);

test('resolveWindow (FIRST issue): no prior -> since = now - 90d, exclude null, firstIssue true', async () => {
  const kv = makeKV();
  const nowMs = gen(7, 25);
  assert.deepEqual(
    await resolveWindow(kv, { nowMs, currentIssueId: 'weekly-2026-08-25' }),
    { firstIssue: true, since: nowMs - BOOTSTRAP, exclude: null, seen: null, previousGeneratedAt: null },
  );
});

const EPOCH = Date.UTC(2026, 6, 28); // a newsletter that launched ~2026-07-28, recorded as issue one's window.since

test('resolveWindow (THEREAFTER): a prior exists -> since = the newsletter EPOCH (a floor), exclude = the mailed member urls', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'weekly-2026-08-04', generatedAt: gen(7, 4), window: { since: EPOCH, excluded: null, appliesTo: 'members' }, sections: {
    article: [{ url: '/articles/a1/' }], project: [{ url: '/projects/p1/' }], prompt: [], share: [{ url: '/shares/ann/s1/' }],
  // sow-297: the prior issue records what was VISIBLE at its compile, which is a SUPERSET of what it mailed
  // (the cap and the window both narrow the pool down to the sections). `/articles/unmailed/` is in it and in
  // no section, which is the case the two sets exist to tell apart.
  }, topNews: [{ url: 'https://n/news-should-not-be-excluded' }], pool: ['/articles/a1/', '/articles/unmailed/', '/projects/p1/', '/shares/ann/s1/'] });
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(w.firstIssue, false);
  assert.equal(w.since, EPOCH, 'the floor is the newsletter epoch, not null; null would drain the pre-newsletter back catalogue');
  assert.deepEqual([...w.exclude].sort(), ['/articles/a1/', '/projects/p1/', '/shares/ann/s1/'], 'all member sections, unioned');
  assert.ok(!w.exclude.has('https://n/news-should-not-be-excluded'), 'news is NOT excluded (it re-ranks by opens)');
  // sow-297: and the WEEK, which is the prior pool. Distinct from exclude on both sides, so a mutant that
  // aliased the two would red here: `unmailed` is seen and not excluded.
  assert.deepEqual([...w.seen].sort(), ['/articles/a1/', '/articles/unmailed/', '/projects/p1/', '/shares/ann/s1/']);
  assert.ok(w.seen.has('/articles/unmailed/') && !w.exclude.has('/articles/unmailed/'),
    'an item visible last week but never mailed is SEEN and not EXCLUDED: the two sets are not the same question');
});

// sow-297: the one-week transition. Every issue frozen before pools existed has none, so the very next compile
// has nothing to diff. It must NOT fall through to the epoch floor (that is the whole archive) and must NOT
// treat an empty pool as "nothing was visible" (that would mark the entire catalogue new). It falls back to the
// publishedAt proxy at the previous compile time, which is the same question asked less precisely.
test('resolveWindow BOOTSTRAP: a prior issue with no recorded pool -> seen null and the floor tightens to that issue compile time', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'weekly-2026-08-04', generatedAt: gen(7, 4), window: { since: EPOCH }, sections: { article: [{ url: '/articles/a1/' }] } });
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(w.seen, null, 'no pool to diff against, and null is distinct from an empty set');
  assert.equal(w.since, gen(7, 4), 'the floor is the previous compile, NOT the epoch: a weekly issue is one week');
  assert.notEqual(w.since, EPOCH, 'the epoch would re-open the whole back catalogue, which is what this ruling closed');
});

// An EMPTY recorded pool reads the same as a missing one. A site with published content cannot compile to a
// zero-item pool, so an empty array is a recording failure, and the safe read of a recording failure is the
// WIDER window (no visibility filter) rather than the narrower one (everything is new).
test('resolveWindow BOOTSTRAP: an EMPTY pool is treated as absent, not as "nothing was visible"', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'weekly-2026-08-04', generatedAt: gen(7, 4), window: { since: EPOCH }, sections: { article: [] }, pool: [] });
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(w.seen, null, 'an empty pool must not become an empty Set, which would filter nothing but claim it did');
  assert.equal(w.since, gen(7, 4));
});

test('resolveWindow: a foreign (non weekly-) issue id is not counted as a prior, so we stay in the first-issue regime', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'manual-backfill', generatedAt: gen(7, 20), sections: { article: [{ url: '/x/' }] } });
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(w.firstIssue, true, 'the foreign id does not flip us into the exclude regime');
  assert.equal(w.exclude, null);
});

test('resolveWindow: once an issue ages OUT of the depth window, exclude is bounded AND the floor advances to the oldest in-window compile time', async () => {
  const kv = makeKV();
  // Pools recorded, so this exercises the STEADY state rather than the sow-297 bootstrap fallback. The floor is
  // the backstop under the visibility diff, and a backstop only earns its keep if it is tested on its own.
  await putIssue(kv, { issueId: 'weekly-2026-08-04', generatedAt: gen(7, 4), window: { since: EPOCH }, sections: { article: [{ url: '/articles/old/' }] }, pool: ['/articles/old/'] });
  await putIssue(kv, { issueId: 'weekly-2026-08-11', generatedAt: gen(7, 11), sections: { article: [{ url: '/articles/mid/' }] }, pool: ['/articles/old/', '/articles/mid/'] });
  await putIssue(kv, { issueId: 'weekly-2026-08-18', generatedAt: gen(7, 18), sections: { article: [{ url: '/articles/recent/' }] }, pool: ['/articles/old/', '/articles/mid/', '/articles/recent/'] });
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25', historyDepth: 2 });
  assert.deepEqual([...w.exclude].sort(), ['/articles/mid/', '/articles/recent/'], 'the two newest priors only');
  assert.ok(!w.exclude.has('/articles/old/'), 'the issue beyond the history depth is not read for exclusion');
  // 08-04 has aged OUT of the depth-2 window, so an epoch floor would leave anything it mailed above the floor yet
  // no longer excluded: an uncoupled re-mail. The floor advances to 08-11 (the OLDEST issue still IN the window),
  // so anything an aged-out issue mailed (published no later than 08-04, strictly before 08-11) is floored. Floor
  // and exclude now cover the same span, which is the coupling.
  assert.equal(w.since, gen(7, 11), 'the floor is the oldest in-window compile time, not the (now unsafe) fixed epoch');
  assert.deepEqual([...w.seen].sort(), ['/articles/mid/', '/articles/old/', '/articles/recent/'],
    'and the week is the NEWEST prior pool, which is a different bound from the oldest in-window compile time');
});

test('resolveWindow: a first issue with no recorded window.since falls back to its own date as the epoch', async () => {
  const kv = makeKV();
  // A pool is recorded so the sow-297 bootstrap branch does not short-circuit this: resolveEpoch is the branch
  // under test, and it is only reachable once a pool exists.
  await putIssue(kv, { issueId: 'weekly-2026-08-18', generatedAt: gen(7, 18), sections: { article: [{ url: '/a/' }] }, pool: ['/a/'] }); // legacy: no window
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(w.since, Date.UTC(2026, 7, 18, 0, 0, 0), 'parsed from the oldest issue id at midnight UTC, still a real floor');
});

test('compileWeeklyIssue FIRST issue: launch window drops an out-of-window item, keeps an in-window one', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const activity = { entries: [
    // now = 2026-08-25, so the 90-day launch window opens ~2026-05-27. `in` (08-22) is inside; `out` (04-15) is
    // well before the window and must be dropped by the launch bound.
    { type: 'post', slug: 'in', title: 'In launch window', url: '/articles/in/', author: 'ann', publishedAt: Date.UTC(2026, 7, 22), visibility: 'public' },
    { type: 'post', slug: 'out', title: 'Before launch window', url: '/articles/out/', author: 'ann', publishedAt: Date.UTC(2026, 3, 15), visibility: 'public' },
  ] };
  const d = { ...deps(kv), fetchImpl: fakeFetch({ '/activity-index.json': activity, '/shares-index.json': { entries: [] } }), queryItems: async () => ({ items: [] }) };
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, d);
  assert.equal(r.firstIssue, true);
  const issue = await getIssue(kv, 'weekly-2026-08-25');
  assert.deepEqual(issue.sections.article.map((a) => a.title), ['In launch window'], 'the pre-window item is dropped by the launch bound');
  assert.equal(issue.window.since, gen(7, 25) - BOOTSTRAP);
  assert.equal(issue.window.excluded, null);
  assert.ok(issue.launchNote, 'a first issue carries the launch note');
});

test('compileWeeklyIssue THEREAFTER: epoch floor + exclude keeps a held item, drops the pre-newsletter back catalogue, excludes already-mailed', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  // Issue one (the oldest prior) records the newsletter epoch as its window.since and already mailed one article.
  // sow-297: the pool holds ONLY the already-mailed url, deliberately. `held` was still under review at that
  // compile so it was not visible, and `prenews` is left out so the EPOCH floor is the only thing that can drop
  // it: two mechanisms dropping the same item would make neither assertion discriminating.
  await putIssue(kv, { issueId: 'weekly-2026-08-04', generatedAt: gen(7, 4), window: { since: EPOCH, excluded: null, appliesTo: 'members' }, sections: {
    article: [{ url: '/articles/mailed/', title: 'Already mailed' }], project: [], prompt: [], share: [],
  }, pool: ['/articles/mailed/'] });
  const activity = { entries: [
    { type: 'post', slug: 'mailed',  title: 'Already mailed',      url: '/articles/mailed/',  author: 'ann', publishedAt: Date.UTC(2026, 6, 30), visibility: 'public' }, // after epoch, already mailed
    { type: 'post', slug: 'fresh',   title: 'Fresh this week',     url: '/articles/fresh/',   author: 'ann', publishedAt: Date.UTC(2026, 7, 24), visibility: 'public' }, // new, not mailed
    { type: 'post', slug: 'held',    title: 'Held contribution',   url: '/articles/held/',    author: 'bob', publishedAt: Date.UTC(2026, 7, 1),  visibility: 'public' }, // after epoch, never mailed (held for review)
    { type: 'post', slug: 'prenews', title: 'Predates newsletter', url: '/articles/prenews/', author: 'ann', publishedAt: Date.UTC(2026, 3, 1),  visibility: 'public' }, // BEFORE epoch: floored, never the back catalogue
  ] };
  const d = { ...deps(kv), fetchImpl: fakeFetch({ '/activity-index.json': activity, '/shares-index.json': { entries: [] } }), queryItems: async () => ({ items: [] }) };
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, d);
  assert.equal(r.firstIssue, false);
  assert.equal(r.since, EPOCH, 'the floor is the newsletter epoch, not null');
  assert.equal(r.excluded, 1, 'exactly the one already-mailed url is excluded');
  const issue = await getIssue(kv, 'weekly-2026-08-25');
  // Four cases in ONE compile, so no single mutant passes: fresh KEPT, held (after epoch, never mailed) KEPT,
  // already-mailed EXCLUDED, pre-newsletter (before epoch) FLOORED. byDateDesc: fresh (08-24) then held (08-01).
  // since=null would surface 'Predates newsletter'; a removed exclude would surface 'Already mailed'; a tight
  // per-issue window would drop 'Held contribution'.
  assert.deepEqual(issue.sections.article.map((a) => a.title), ['Fresh this week', 'Held contribution'],
    'held item kept (Trap Two), already-mailed excluded, pre-newsletter floored out');
  assert.equal(issue.window.since, EPOCH);
  assert.equal(issue.window.excluded, 1);
  assert.equal(issue.window.seen, 1, 'and the week was measured against the prior pool, not left unset');
  // sow-297: the closure of Trap Two, stated as its own claim rather than inferred from the list above. `held`
  // is dated 08-01, four days BEFORE the previous compile, so a seven-day publishedAt window would drop it on
  // the very day it first became visible. It mails because it was not in the previous pool.
  assert.ok(issue.sections.article.some((a) => a.title === 'Held contribution'),
    'an item published before the last compile but first VISIBLE after it is still new');
  assert.ok(issue.pool.includes('/articles/held/'), 'and this issue records it as visible, so next week it is not new again');
});

// The SEAM the two prior defects lived in: the time floor and the issue-count exclude window are TWO bounds, and
// the unit tests above each exercise ONE compile. This one runs the composer forward over many issues, which is
// the only object that can catch an item slipping BETWEEN the bounds. Without the coupling, a below-cap artifact
// (projects never turn over) escapes the exclude window at historyDepth and, still above a FIXED epoch floor, gets
// re-mailed on a historyDepth cycle. historyDepth is small (3) so the escape point (issue 5) is reached fast.
test('SEAM (multi-issue): a below-cap item is mailed exactly once, never re-mailed after it ages out of the exclude window', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const TUE = (wk) => Date.UTC(2026, 0, 6 + 7 * wk, 13, 0, 0); // successive weekly compiles (distinct weekly- ids)
  // Six projects, all published INSIDE the first issue's launch window (so all are eligible from issue one) and all
  // below the 40-per-type artifact cap, so they are present in EVERY week's artifact and never turn over. That makes
  // the exclude set the ONLY thing that can stop a re-mail, which is exactly the condition the coupling must survive.
  const projects = [1, 2, 3, 4, 5, 6].map((n) => ({
    type: 'project', slug: `p${n}`, title: `Project ${n}`, url: `/projects/p${n}/`, author: 'ann',
    publishedAt: TUE(0) - (7 - n) * 24 * 3600 * 1000, // week0 -6d (p1, oldest) .. -1d (p6, newest), all in the launch window
    visibility: 'public',
  }));
  const activity = { entries: projects };
  const mailedIn = new Map(); // product url -> [issueIds it appeared in]
  for (let wk = 0; wk < 8; wk++) {
    const d = {
      kv, now: at(TUE(wk)), siteUrl: 'https://x', historyDepth: 3,
      fetchImpl: fakeFetch({ '/activity-index.json': activity, '/shares-index.json': { entries: [] } }),
      queryItems: async () => ({ items: [] }),
    };
    // eslint-disable-next-line no-await-in-loop -- sequential issues, each reading the frozen prior ones
    const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, d);
    // eslint-disable-next-line no-await-in-loop
    const issue = await getIssue(kv, r.issueId);
    for (const p of issue.sections.project ?? []) {
      if (!mailedIn.has(p.url)) mailedIn.set(p.url, []);
      mailedIn.get(p.url).push(r.issueId);
    }
  }
  // Every product mailed AT MOST once across the whole run. Under a fixed epoch floor, projects 2-6 (mailed in
  // issue one, then aged out of the depth-3 exclude window by issue five) are above the epoch and no longer
  // excluded, so they re-mail: length 2, and this assertion reds. That is the mutant this test exists to catch.
  // sow-297 adds a second, independent guard on the same property (an item in last week's pool is not new), so
  // the floor coupling is now the BACKSTOP; it is exercised on its own in the aged-out resolveWindow test above.
  for (const [url, issues] of mailedIn) {
    assert.equal(issues.length, 1, `${url} was mailed ${issues.length} times (${issues.join(', ')}); expected exactly once`);
  }
  // FIVE, not six, and the missing one is the owner's ruling rather than a defect (sow-297, 2026-08-31). Six
  // items arrive in one week against a cap of five, so p1 (the oldest) does not fit issue one. Under the weekly
  // window it is not new the following week either: it was visible, so it is not a thing that happened this
  // week. The answer to a section that overflows is a bigger cap for that section, which is why shares carry 10
  // (DEFAULT_SECTION_CAPS), not a queue that walks the archive forward one item at a time.
  assert.equal(mailedIn.size, 5, 'the five that fit the cap were actually mailed (not vacuously passing by mailing nothing)');
  assert.ok(!mailedIn.has('/projects/p1/'), 'the overflow item is dropped, not carried over: it was visible and is no longer new');
});

// The joint SEAM between the advancing floor (resolveWindow, this module's orchestration) and the not-yet-due
// withholding (composeIssue, PR 325). The floor coupling holds only while no item is dated AFTER the compile that
// mailed it; nothing upstream enforces that (no future-date guard in isListed or validate-content). A future-dated
// item (scheduled post, mistyped year) that is treated as mailable NOW sits perpetually above the lagging floor and
// re-mails once per historyDepth, which PR 324's clamp did NOT fix (it re-projected the item to each new compile,
// so it stayed above the floor). PR 325 withholds it until due instead. This runs the WHOLE orchestrator forward
// (resolveWindow + the artifact fetch + composeIssue), a different composition than the composeIssue-level harness.
//
// TWO controls, not one (PublicationMaster's caution, learned from a harness bug of theirs). A first-issue control
// alone is near-useless for a floor: their broken harness advanced the floor during ramp-up, so early items mailed
// and later ones NEVER did, and a "mails once at issue 0" assertion passes cleanly against that wrong world. The
// property a floor bug destroys is an item having to WAIT its turn, so the load-bearing control is `wait`, which
// perSection 1 forces onto issue 1. `immediate` guards the opposite failure (the harness dropping everything).
test('SEAM (future-dated): a not-yet-due item is withheld then mailed once; a late-arriving item still mails', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const DAY = 24 * 3600 * 1000;
  const TUE = (wk) => Date.UTC(2026, 0, 6 + 7 * wk, 13, 0, 0);
  // perSection 1 so only the single newest due item mails each issue. `immediate` mails at issue 0 and is the
  // control against a harness that drops everything. `future` is 100 days ahead: TUE(15) = +105d is the first
  // compile at or after it (TUE(14) = +98d is still before), so it is due at issue 15. Run well past 15 so a
  // re-mail (the bug) would show as a second entry.
  //
  // sow-297 REPLACED the old `wait` control, and the replacement is the stronger one. `wait` proved an item
  // could sit out an issue and mail on the next, which is no longer a property: under the weekly window an item
  // that was visible last week is not new this week, by design. `latecomer` proves the thing that actually
  // matters and that this design exists to protect. Its publishedAt is THREE DAYS BEFORE the first compile, and
  // it does not enter the artifact until week 3, so a publishedAt window of any sane width would have floored it
  // out on the day it first became visible. It mails because it was not in week 2's pool.
  const immediate = { type: 'project', slug: 'immediate', title: 'Immediate', url: '/projects/immediate/', author: 'ann', publishedAt: TUE(0) - DAY, visibility: 'public' };
  const future = { type: 'project', slug: 'future', title: 'Future', url: '/projects/future/', author: 'ann', publishedAt: TUE(0) + 100 * DAY, visibility: 'public' };
  const latecomer = { type: 'project', slug: 'latecomer', title: 'Held for review', url: '/projects/latecomer/', author: 'bob', publishedAt: TUE(0) - 3 * DAY, visibility: 'public' };
  const mailedIn = new Map(); // url -> [week index]
  for (let wk = 0; wk < 22; wk++) {
    const activity = { entries: wk >= 3 ? [immediate, future, latecomer] : [immediate, future] };
    const d = {
      kv, now: at(TUE(wk)), siteUrl: 'https://x', historyDepth: 3, perSection: 1,
      fetchImpl: fakeFetch({ '/activity-index.json': activity, '/shares-index.json': { entries: [] } }),
      queryItems: async () => ({ items: [] }),
    };
    // eslint-disable-next-line no-await-in-loop
    const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, d);
    // eslint-disable-next-line no-await-in-loop
    const issue = await getIssue(kv, r.issueId);
    for (const p of issue.sections.project ?? []) {
      if (!mailedIn.has(p.url)) mailedIn.set(p.url, []);
      mailedIn.get(p.url).push(wk);
    }
  }
  assert.deepEqual(mailedIn.get('/projects/immediate/'), [0], 'the newest item mails at the first issue (harness is not dropping everything)');
  // The load-bearing control. It arrives in week 3 carrying a date from before week 0, which is exactly the
  // shape of a contribution held for review. A weekly window measured on publishedAt gives it [] here.
  assert.deepEqual(mailedIn.get('/projects/latecomer/'), [3],
    'an item that becomes VISIBLE in week 3 mails in week 3, however old its publishedAt is');
  // The future item is WITHHELD every issue until it comes due, then mails exactly once. Under PR 324's clamp it
  // re-mailed at 0, 4, 8, 12 (every historyDepth+1); unbounded, the same. Both fail this, so it is discriminating.
  assert.deepEqual(mailedIn.get('/projects/future/'), [15],
    'the future-dated item is withheld until due, then mails exactly once, and does NOT re-mail on a historyDepth cycle');
});


// ---------- sow-166 digest v2 (2026-08-23): source display names at gather time ----------

// THE DEFECT THIS CLOSES, tested against the REAL id rather than a stand-in. The first delivered issue showed
// `object-object` under a Verge headline, because that string is literally the source id in
// house/news-sources.yml (and in the bundled seed this test resolves against, offline).
test('gatherNewsEntries resolves the source DISPLAY NAME, including the mangled object-object id', async () => {
  const kv = makeKV();
  const items = [
    { guid: 'v1', title: 'A Verge headline', link: 'https://www.theverge.com/x', source: 'object-object', publishedAt: 10 },
    { guid: 'u1', title: 'Unlisted', link: 'https://other/y', source: 'not-a-real-source-id', publishedAt: 9 },
  ];
  const out = await gatherNewsEntries({ SIGNUP_KV: kv, NEWS_KV: {} }, { kv, queryItems: async () => ({ items }) });
  assert.equal(out[0].sourceName, 'The Verge', 'the id resolves to the name a reader should see');
  assert.equal(out[0].source, 'object-object', 'and the stored id is preserved, because it is the key');
  assert.equal(out[1].sourceName, null, 'an unlisted id resolves to null; the renderer falls back to the id');
});

test('gatherNewsEntries passes the image and BOTH summary fields through for the normalizer to choose', async () => {
  const kv = makeKV();
  const items = [{ guid: 'g', title: 'T', link: 'https://n/1', source: 's', publishedAt: 1,
    digest: 'AI summary', summary: 'feed summary', image: 'https://i/x.jpg' }];
  const [out] = await gatherNewsEntries({ SIGNUP_KV: kv, NEWS_KV: {} }, { kv, queryItems: async () => ({ items }) });
  assert.equal(out.digest, 'AI summary');
  assert.equal(out.summary, 'feed summary');
  assert.equal(out.image, 'https://i/x.jpg');
});

test('a source list that THROWS is fail-soft: every row falls back to its id, news is not lost', async () => {
  const kv = makeKV();
  const items = [{ guid: 'g', title: 'T', link: 'https://n/1', source: 'object-object', publishedAt: 1 }];
  const out = await gatherNewsEntries({ SIGNUP_KV: kv, NEWS_KV: {} }, {
    kv, queryItems: async () => ({ items }), sourceList: async () => { throw new Error('sources unreachable'); },
  });
  assert.equal(out.length, 1, 'the news itself still gathers');
  assert.equal(out[0].sourceName, null, 'names are a display nicety, never a gate on the item');
});

// sow-166: THE SPLIT. A weekly and a welcome are compiled from the same content but go to disjoint audiences,
// and the whole feature is that nobody's FIRST email is a thin weekly. These drive the real functions rather
// than the predicates, because the predicate being right and the compile not calling it is the failure that
// would ship silently.

test('WELCOME SPLIT: an unwelcomed subscriber gets the welcome and is absent from the weekly', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['old1', 'old2']);                        // welcomed long ago -> weekly
  seedSubscribers(kv, ['newbie'], { welcomedAt: null });        // never welcomed -> welcome only
  const env = { SIGNUP_KV: kv, NEWS_KV: {} };

  const weekly = await compileWeeklyIssue(env, deps(kv));
  assert.equal(weekly.recipients, 2, 'the weekly goes to the two already-welcomed subscribers');
  assert.ok(!(await readPendingIndex(kv, weekly.issueId)).includes('newbie'), 'an unwelcomed subscriber must never be in a weekly');

  const welcome = await compileWelcomeIssue(env, deps(kv));
  assert.equal(welcome.issueId, 'welcome-2026-08-25');
  assert.equal(welcome.recipients, 1);
  assert.deepEqual(await readPendingIndex(kv, welcome.issueId), ['newbie']);
});

test('WELCOME SCOPE: the welcome is composed over the full 90 days even when a weekly is narrow', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['newbie'], { welcomedAt: null });
  // A prior weekly exists, so the WEEKLY regime is the narrow epoch-floored one.
  await putIssue(kv, { issueId: 'weekly-2026-08-18', generatedAt: Date.UTC(2026, 7, 18), sections: {}, counts: {} });
  const welcome = await compileWelcomeIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  const ninetyDays = 90 * 24 * 3600 * 1000;
  assert.equal(welcome.since, Date.UTC(2026, 7, 25, 13, 0, 0) - ninetyDays, 'the welcome always reaches back 90 days');
});

test('WELCOME SWEEP is idempotent: a second sweep in the same day enqueues nobody new', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['newbie'], { welcomedAt: null });
  const env = { SIGNUP_KV: kv, NEWS_KV: {} };
  const first = await compileWelcomeIssue(env, deps(kv));
  assert.equal(first.enqueued, 1);
  const second = await compileWelcomeIssue(env, deps(kv));
  assert.equal(second.composed, false, 'the frozen welcome is reused, never recomposed');
  assert.equal(second.enqueued, 0, 'a repeat sweep must not enqueue the same recipient twice');
});

test('WELCOME SWEEP short-circuits when nobody needs one, writing nothing and fetching nothing', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['old1']); // already welcomed
  let fetched = 0;
  const d = deps(kv);
  const r = await compileWelcomeIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, {
    ...d,
    fetchImpl: (...a) => { fetched++; return d.fetchImpl(...a); },
  });
  assert.equal(r.skipped, true);
  assert.equal(r.recipients, 0);
  assert.equal(fetched, 0, 'the common tick must not fetch the site indexes: this runs every five minutes');
  assert.equal(await getIssue(kv, 'welcome-2026-08-25'), null, 'and it must not mint a welcome issue nobody needs');
});

test('a subscriber welcomed DURING this cycle skips this weekly and joins at the next one', async () => {
  const kv = makeKV();
  // The previous weekly was compiled at this timestamp; the cycle began then.
  const prevGen = Date.UTC(2026, 7, 18);
  await putIssue(kv, { issueId: 'weekly-2026-08-18', generatedAt: prevGen, sections: {}, counts: {} });
  seedSubscribers(kv, ['midCycle'], { welcomedAt: prevGen + 1000 }); // welcomed after the cycle began
  seedSubscribers(kv, ['earlier'], { welcomedAt: prevGen - 1000 });  // welcomed before it
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.deepEqual(await readPendingIndex(kv, r.issueId), ['earlier'], 'only the earlier-welcomed subscriber gets this weekly');
});
