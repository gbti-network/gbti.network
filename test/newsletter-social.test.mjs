// sow-484 (owner, 2026-10-27): "We need to make sure that the weekly newsletter is included into our social queue
// preparation." Once a weekly issue has gone out, its public web edition is queued for syndication as a `newsletter`
// item, and the drain turns that into Social Queue tasks for every channel whose newsletter cell is On-Manual.
// These run the real step, the real store and the real drain over a fake KV, against the LIVE
// house/syndication-config.yml through the same mirror the Worker reads. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import {
  queueNewsletterPosts, newsletterItem, recentWeeklyIds, newsletterSocialKey, NEWSLETTER_SOURCE,
} from '../workers/signup/newsletter-social.mjs';
import { enqueue, SYND_CONFIG_KEY } from '../workers/signup/syndication-store.mjs';
import { drainSyndication } from '../workers/signup/syndication-drain.mjs';
import {
  toSyndicationMirror, syndicationConfigFromParsed, autoModeFor, defaultAutoMode, templateFor, deliverChannelsForType,
  AUTO_TYPES, TEMPLATE_TYPES, DEFAULT_NEWSLETTER_FORMAT,
} from '../membership/syndication-config-core.mjs';
import { buildQueueItem, normalizeItem, QUEUE_TYPES } from '../membership/syndication-queue.mjs';
import { issueHeadline, renderIssue, DIGEST_OG_IMAGE } from '../membership/mail-render.mjs';
import { issueKey } from '../membership/mail-digest.mjs';
import { renderTemplate } from '../membership/syndication-format.mjs';
import { statsKey } from '../membership/mail-stats.mjs';

const LIVE = yaml.load(fs.readFileSync(new URL('../house/syndication-config.yml', import.meta.url), 'utf8'));
const MIRROR = JSON.stringify(toSyndicationMirror(LIVE));
const NOW = Date.parse('2026-10-27T13:05:00Z'); // a Tuesday, five minutes after the first send tick
const ID = 'weekly-2026-10-27';
const ENV = { PUBLIC_BASE_URL: 'https://signup.gbti.network' };
const WEB = `https://signup.gbti.network/digest/${ID}`;
const MANUAL = ['x', 'linkedin', 'bluesky', 'dailydev', 'substack'];
const LINE = (summary) => `The GBTI Digest is out: ${summary} Read this week's issue: ${WEB}`;

function fakeKV(seed = {}, { throwOn = null } = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      if (throwOn && throwOn(key)) throw new Error('kv down');
      const v = store.get(key);
      return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v);
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const at = (t) => () => t;
const issue = (id = ID, extra = {}) => ({
  issueId: id, generatedAt: Date.parse(`${id.slice(-10)}T12:00:00Z`),
  counts: { article: 4, project: 2, prompt: 0, share: 1, news: 3 }, layout: [], ...extra,
});
// A frozen issue, and (optionally) proof it went out: the durable stats snapshot.
function seedIssue(seed, id = ID, { sent = true } = {}) {
  seed[issueKey(id)] = JSON.stringify(issue(id));
  if (sent) seed[statsKey(id)] = JSON.stringify({ sent: 12, failed: 0, suppressed: 0 });
  return seed;
}
const recorder = (answer = (input) => ({ enqueued: true, id: `newsletter:${input.targetSlug}#1` })) => {
  const calls = [];
  const fn = async (env, input) => { calls.push(input); return answer(input); };
  return { fn, calls };
};

// ---------------------------------------------------------------- the step

test('a weekly issue that has gone out is queued once, as a public newsletter item linking its web edition', async () => {
  const kv = fakeKV(seedIssue({ [SYND_CONFIG_KEY]: MIRROR }));
  const rec = recorder();
  const out = await queueNewsletterPosts(ENV, { kv, now: at(NOW), enqueueItem: rec.fn });
  assert.deepEqual(out.queued, [ID]);
  assert.equal(rec.calls.length, 1);
  const { subject, summary } = issueHeadline(issue());
  assert.deepEqual(rec.calls[0], {
    source: 'newsletter', targetType: 'newsletter', targetSlug: ID, visibility: 'public',
    title: subject, blurb: summary, url: WEB, image: `https://gbti.network${DIGEST_OG_IMAGE}`,
  });
  assert.match(subject, /^GBTI Digest · 10 items · /);
  assert.equal(summary, '4 articles, 2 projects, 1 member share and 3 news picks from the network this week.');
  assert.ok(kv.store.get(newsletterSocialKey(ID)), 'the once-per-issue marker is written');
});

test('one delivered record is enough while the issue is still going out (the web page\'s own rule)', async () => {
  const seed = seedIssue({ [SYND_CONFIG_KEY]: MIRROR }, ID, { sent: false });
  seed[`mail:send:${ID}:abc`] = JSON.stringify({ status: 'sent' });
  const rec = recorder();
  const out = await queueNewsletterPosts(ENV, { kv: fakeKV(seed), now: at(NOW), enqueueItem: rec.fn });
  assert.deepEqual(out.queued, [ID]);
});

test('an issue frozen but not yet sent waits: nothing is queued and no marker is written', async () => {
  const seed = seedIssue({ [SYND_CONFIG_KEY]: MIRROR }, ID, { sent: false });
  seed[`mail:send:${ID}:abc`] = JSON.stringify({ status: 'pending' });
  const kv = fakeKV(seed);
  const rec = recorder();
  const out = await queueNewsletterPosts(ENV, { kv, now: at(NOW), enqueueItem: rec.fn });
  assert.deepEqual(out.waiting, [ID]);
  assert.equal(rec.calls.length, 0);
  assert.equal(kv.store.get(newsletterSocialKey(ID)), undefined);
});

test('welcome, members and rehearsal issues, and a weekly older than six days, are never queued', async () => {
  const seed = { [SYND_CONFIG_KEY]: MIRROR };
  for (const id of ['welcome-2026-10-27', 'members-2026-10-27', 'test-2026-10-27', 'weekly-2026-10-20']) seedIssue(seed, id);
  const rec = recorder();
  const out = await queueNewsletterPosts(ENV, { kv: fakeKV(seed), now: at(NOW), enqueueItem: rec.fn });
  assert.equal(rec.calls.length, 0, `queued: ${rec.calls.map((c) => c.targetSlug).join(', ')}`);
  assert.deepEqual(out.queued, []);
});

test('a second tick queues nothing more, even after the queued item is gone (the marker holds)', async () => {
  const kv = fakeKV(seedIssue({ [SYND_CONFIG_KEY]: MIRROR }));
  const rec = recorder();
  await queueNewsletterPosts(ENV, { kv, now: at(NOW), enqueueItem: rec.fn });
  // The real store would forget a deleted or cancelled item; the recorder stands in for that by always accepting.
  await queueNewsletterPosts(ENV, { kv, now: at(NOW + 5 * 60_000), enqueueItem: rec.fn });
  await queueNewsletterPosts(ENV, { kv, now: at(NOW + 24 * 3600_000), enqueueItem: rec.fn });
  assert.equal(rec.calls.length, 1);
});

test('an item already queued (duplicate) still writes the marker; a refused enqueue writes none and retries', async () => {
  const dupKv = fakeKV(seedIssue({ [SYND_CONFIG_KEY]: MIRROR }));
  await queueNewsletterPosts(ENV, { kv: dupKv, now: at(NOW), enqueueItem: recorder(() => ({ enqueued: false, reason: 'duplicate', id: 'x' })).fn });
  assert.ok(dupKv.store.get(newsletterSocialKey(ID)));

  const kv = fakeKV(seedIssue({ [SYND_CONFIG_KEY]: MIRROR }));
  const refused = recorder(() => ({ enqueued: false, reason: 'kv write failed' }));
  await queueNewsletterPosts(ENV, { kv, now: at(NOW), enqueueItem: refused.fn });
  assert.equal(kv.store.get(newsletterSocialKey(ID)), undefined);
  await queueNewsletterPosts(ENV, { kv, now: at(NOW + 5 * 60_000), enqueueItem: refused.fn });
  assert.equal(refused.calls.length, 2, 'the next tick tries again');
});

test('an unreadable marker skips the issue rather than queueing it', async () => {
  const kv = fakeKV(seedIssue({ [SYND_CONFIG_KEY]: MIRROR }), { throwOn: (k) => k.startsWith('mail:social:') });
  const rec = recorder();
  await queueNewsletterPosts(ENV, { kv, now: at(NOW), enqueueItem: rec.fn });
  assert.equal(rec.calls.length, 0);
});

test('syndication off, or no channel taking the newsletter, queues nothing and writes no marker', async () => {
  const off = JSON.stringify(toSyndicationMirror({ syndication: { ...LIVE.syndication, enabled: false } }));
  const kvOff = fakeKV(seedIssue({ [SYND_CONFIG_KEY]: off }));
  const rec = recorder();
  assert.equal((await queueNewsletterPosts(ENV, { kv: kvOff, now: at(NOW), enqueueItem: rec.fn })).reason, 'syndication off');

  const noRow = { ...LIVE.syndication.auto_matrix };
  noRow.newsletter = Object.fromEntries(Object.keys(noRow.newsletter).map((ch) => [ch, 'off']));
  const none = JSON.stringify(toSyndicationMirror({ syndication: { ...LIVE.syndication, auto_matrix: noRow } }));
  const kvNone = fakeKV(seedIssue({ [SYND_CONFIG_KEY]: none }));
  assert.equal((await queueNewsletterPosts(ENV, { kv: kvNone, now: at(NOW), enqueueItem: rec.fn })).reason, 'no channel takes the newsletter');
  assert.equal(rec.calls.length, 0);
  assert.equal(kvOff.store.get(newsletterSocialKey(ID)), undefined);
  assert.equal(kvNone.store.get(newsletterSocialKey(ID)), undefined);
});

test('newsletterItem links only a canonical weekly id on an https base; recentWeeklyIds is six UTC days', () => {
  assert.equal(newsletterItem(issue('members-2026-10-27'), { webBase: 'https://signup.gbti.network' }), null);
  assert.equal(newsletterItem(issue(), { webBase: '' }), null, 'no base, no link, no item');
  assert.equal(newsletterItem(issue(), { webBase: 'https://signup.gbti.network', siteUrl: '' }).image, null);
  assert.deepEqual(recentWeeklyIds(Date.parse('2026-11-02T01:00:00Z')),
    ['weekly-2026-11-02', 'weekly-2026-11-01', 'weekly-2026-10-31', 'weekly-2026-10-30', 'weekly-2026-10-29', 'weekly-2026-10-28']);
});

test('the post describes the issue exactly as the email does', () => {
  const it = issue();
  const email = renderIssue(it, { siteUrl: 'https://gbti.network' });
  const head = issueHeadline(it);
  assert.equal(email.subject, head.subject);
  assert.ok(email.html.includes(head.summary), 'the preheader is the post blurb');
  assert.equal(issueHeadline({}).subject, 'The GBTI Network weekly digest');
  assert.equal(issueHeadline({}).summary, 'Your weekly roundup from the GBTI Network.');
});

// ---------------------------------------------------------------- the type and the live settings

test('the queue, the matrix and the templates all know the newsletter type', () => {
  assert.ok(QUEUE_TYPES.has('newsletter'));
  assert.ok(AUTO_TYPES.includes('newsletter'));
  assert.ok(TEMPLATE_TYPES.includes('newsletter'));
  assert.equal(NEWSLETTER_SOURCE, 'newsletter');
  const item = buildQueueItem({ source: 'newsletter', targetSlug: ID, visibility: 'public', title: 't', url: WEB }, { now: at(NOW), holdMs: 0 });
  assert.equal(item.source, 'newsletter');
  assert.equal(item.membersOnly, false);
  assert.equal(normalizeItem(item)?.source, 'newsletter', 'a stored newsletter item is readable, so it can drain');
  assert.equal(defaultAutoMode('newsletter'), 'off', 'a cell nobody chose never posts the newsletter');
  assert.equal(renderTemplate('A {content-type}', { source: 'newsletter' }), 'A newsletter', 'not "A item"');
});

test('the live settings send the newsletter to the five hand-posted channels, with the approved line', () => {
  const cfg = syndicationConfigFromParsed(LIVE);
  assert.deepEqual(deliverChannelsForType(cfg, 'newsletter').sort(), [...MANUAL].sort());
  for (const ch of ['reddit', 'discord', 'discord-category', 'devto']) assert.equal(autoModeFor(cfg, 'newsletter', ch), 'off', ch);
  for (const ch of MANUAL) assert.equal(templateFor(cfg, 'newsletter', ch, { channelOnly: true }), DEFAULT_NEWSLETTER_FORMAT, ch);
  assert.equal(DEFAULT_NEWSLETTER_FORMAT, "The GBTI Digest is out: {short-description} Read this week's issue: {url}");
});

test('end to end: the sent issue becomes five Social Queue tasks with the line and the link, and nothing else', async () => {
  const kv = fakeKV(seedIssue({ [SYND_CONFIG_KEY]: MIRROR }));
  const out = await queueNewsletterPosts(ENV, { kv, now: at(NOW), enqueueItem: enqueue });
  assert.deepEqual(out.queued, [ID]);
  await drainSyndication({}, { kv, now: at(NOW + 2 * 3600_000), adapters: {} });
  const tasks = [...kv.store.entries()].filter(([k]) => k.startsWith('social:task:')).map(([, v]) => JSON.parse(v));
  assert.deepEqual(tasks.map((t) => t.channel).sort(), [...MANUAL].sort());
  const summary = issueHeadline(issue()).summary;
  for (const t of tasks) {
    assert.equal(t.status, 'pending');
    assert.equal(t.source, 'newsletter');
    assert.equal(t.url, WEB);
    assert.equal(t.text, LINE(summary), t.channel);
  }
  const item = [...kv.store.entries()].filter(([k]) => k.startsWith('synd:item:')).map(([, v]) => JSON.parse(v))[0];
  for (const ch of ['reddit', 'discord-category', 'devto']) assert.equal(item.perChannel?.[ch]?.status, 'skipped', ch);
});

// ---------------------------------------------------------------- the wiring

const src = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the five-minute tick runs the step after the mail drain and reports it', () => {
  const s = src('workers/signup/cron.mjs');
  const body = s.slice(s.indexOf('async function drainFiveMinute'), s.indexOf('const WEEKLY_DIGEST_JOB'));
  const drain = body.indexOf('drainMail(env');
  const step = body.indexOf('newsletter = await queueNewsletterPosts(env);');
  assert.ok(drain > 0 && step > drain, 'the step must run after this tick\'s sends');
  assert.match(body, /try \{ newsletter = await queueNewsletterPosts\(env\); \} catch \(e\) \{ newsletter = \{ error:/, 'fail-soft');
  assert.match(body, /return \{[^}]*\bnewsletter \};/, 'its result is in the tick\'s log line');
});

test('the Social Queue, the tracker and the Channels manager all name the newsletter', () => {
  assert.match(src('client-ui/src/elements/gbti-social-queue.mjs'), /const SRC_LABEL = \{[^}]*newsletter: 'Newsletter' \}/);
  assert.match(src('client-ui/src/elements/gbti-syndication-tracker.mjs'), /const SRC_LABEL = \{[^}]*newsletter: 'Newsletter' \}/);
  const m = src('client-ui/src/elements/gbti-channel-map-manager.mjs');
  assert.match(m, /const MATRIX_TYPE_LABEL = \{[^}]*newsletter: 'Newsletter' \}/);
  assert.match(m, /\{ key: 'newsletter', nm: 'Newsletter', df: 'weekly issue' \}/);
  assert.match(m, /const TMPL_KEYS = \[[^\]]*'newsletter'/, 'without it an edited newsletter template is not saved');
});
