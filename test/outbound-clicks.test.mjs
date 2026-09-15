// sow-289 Phase 2: the daily outbound click rollup (scripts/lib/outbound-clicks.mjs). The pure reductions get the
// rules: a click is a 301 answer, a named crawler is a subset of clicks, other answers (Cloudflare's own Early Hints
// probes among them) are kept apart, rows are scaled by their sample interval, a re-run replaces a date rather than
// adding to it, and a day the query could not read is never written as zeros. The sync runs over a fake GitHub
// client and a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import {
  summarizeDay, mergeClicks, normalizeClicks, renderClicksFile, clicksEqual, isCrawler, estimateOf, dayBefore,
  syncOutboundClicks, emptyClicks, OUTBOUND_CLICKS_PATH, ROLLUP_DAYS,
} from '../scripts/lib/outbound-clicks.mjs';

const PATHS = ['/outbound/codeable', '/codeable', '/outbound/tailscale'];
const row = (path, status, count, ua = 'Mozilla/5.0 (Linux; Android 13)', sampleInterval = 1) => ({ count, avg: { sampleInterval }, dimensions: { clientRequestPath: path, edgeResponseStatus: status, userAgent: ua } });
const NOW = new Date('2026-09-15T07:17:00Z');

test('summarizeDay: 301 answers are clicks, named crawlers are a subset, Early Hints 504s are other, absent paths are explicit zeros', () => {
  const rows = [
    row('/outbound/codeable', 301, 3),
    row('/outbound/codeable', 301, 1, 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0)'),
    row('/outbound/codeable', 504, 5, 'nginx-ssl early hints'),
    row('/codeable', 301, 2, 'Mozilla/5.0 (compatible; bingbot/2.0)'),
    row('/somewhere/else', 301, 9),
  ];
  assert.deepEqual(summarizeDay(rows, PATHS), {
    '/outbound/codeable': { clicks: 4, crawlers: 1, other: 5 },
    '/codeable': { clicks: 2, crawlers: 2, other: 0 },
    '/outbound/tailscale': { clicks: 0, crawlers: 0, other: 0 },
  });
});

test('summarizeDay scales each row by its sample interval, and isCrawler matches case-insensitively', () => {
  assert.equal(estimateOf(row('/x', 301, 2, 'ua', 3.5)), 7);
  assert.deepEqual(summarizeDay([row('/codeable', 301, 2, 'ua', 3.5), row('/codeable', 301, 1, 'ua', 1.5)], ['/codeable']), { '/codeable': { clicks: 9, crawlers: 0, other: 0 } });
  assert.equal(isCrawler('Mozilla/5.0 (compatible; YandexBot/3.0)'), true);
  assert.equal(isCrawler('Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'), true);
  assert.equal(isCrawler('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128'), false);
  // Found by the live cross-check on 2026-09-12: an Ahrefs site-audit agent that is not "AhrefsBot".
  assert.equal(isCrawler('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.173 Mobile Safari/537.36 (compatible; AhrefsSiteAudit/6.1; +http://ahrefs.com/robot/site-audit)'), true);
  assert.equal(isCrawler(''), false);
});

test('mergeClicks: a re-run of the same date REPLACES its row (no double count), an older date backfills, coverage grows and sorts', () => {
  const day1 = mergeClicks(emptyClicks(), { date: '2026-09-14', byPath: { '/codeable': { clicks: 2, crawlers: 0, other: 0 } } }, { now: NOW });
  const again = mergeClicks(day1, { date: '2026-09-14', byPath: { '/codeable': { clicks: 2, crawlers: 0, other: 0 } } }, { now: NOW });
  assert.deepEqual(again.clicks['/codeable']['2026-09-14'], { clicks: 2, crawlers: 0, other: 0 });
  assert.deepEqual(again.coverage, ['2026-09-14']);
  const back = mergeClicks(again, { date: '2026-09-10', byPath: { '/codeable': { clicks: 1, crawlers: 1, other: 4 } } }, { now: NOW });
  assert.deepEqual(back.coverage, ['2026-09-10', '2026-09-14']);
  assert.deepEqual(Object.keys(back.clicks['/codeable']), ['2026-09-10', '2026-09-14']);
  assert.ok(clicksEqual(day1, again) && !clicksEqual(again, back));
});

test('mergeClicks drops rows older than the keep window and refuses a non-date', () => {
  const old = mergeClicks(emptyClicks(), { date: '2025-01-01', byPath: { '/codeable': { clicks: 1, crawlers: 0, other: 0 } } }, { now: NOW, keepDays: 400 });
  assert.deepEqual(old, emptyClicks(), 'a row older than the window never lands');
  assert.throws(() => mergeClicks(emptyClicks(), { date: 'yesterday', byPath: {} }), /not a date/);
});

test('the file round-trips: dates stay strings, cells are rounded non-negative integers, the gap-versus-zero rule survives the parse', () => {
  const store = mergeClicks(emptyClicks(), { date: '2026-09-14', byPath: { '/codeable': { clicks: 2.4, crawlers: -1, other: 0 }, '/outbound/tailscale': { clicks: 0, crawlers: 0, other: 0 } } }, { now: NOW });
  const text = renderClicksFile(store, NOW);
  assert.ok(text.startsWith('# sow-289'), 'the header explains the numbers');
  const back = normalizeClicks(yaml.load(text));
  assert.deepEqual(back.coverage, ['2026-09-14']);
  assert.deepEqual(back.clicks['/codeable'], { '2026-09-14': { clicks: 2, crawlers: 0, other: 0 } });
  assert.deepEqual(back.clicks['/outbound/tailscale'], { '2026-09-14': { clicks: 0, crawlers: 0, other: 0 } }, 'a covered zero is an explicit zero');
  assert.equal(back.clicks['/codeable']['2026-09-13'], undefined, 'an uncovered date is simply absent');
  // A date key that a YAML parser turned into a Date object still reads as the calendar date.
  assert.deepEqual(normalizeClicks({ coverage: [new Date('2026-09-14T00:00:00Z')], clicks: { '/a': { '2026-09-14': { clicks: 1 } } } }).coverage, ['2026-09-14']);
});

function fakeGithub() {
  const calls = [];
  return {
    calls,
    async getRef() { calls.push('getRef'); return { object: { sha: 'base' } }; },
    async createRef(b) { calls.push(`createRef ${b}`); },
    async getContent(p) { calls.push(`getContent ${p}`); return { sha: 'old' }; },
    async putContent(p, o) { calls.push(`putContent ${p}`); calls.push('body:' + Buffer.from(o.content, 'base64').toString('utf8')); },
    async createPull(o) { calls.push(`createPull ${o.head}`); return { number: 7 }; },
    async mergePull(n, o) { calls.push(`mergePull ${n} ${o.method}`); },
  };
}

test('syncOutboundClicks: queries the last seven complete days, never today, and writes ONE squash-merged PR', async () => {
  const asked = [];
  const query = async ({ date, paths }) => { asked.push(date); return paths[0] === '/outbound/codeable' && date === '2026-09-14' ? [row('/outbound/codeable', 301, 3)] : []; };
  const gh = fakeGithub();
  const r = await syncOutboundClicks({ env: { CF_ANALYTICS_TOKEN: 't', CF_ZONE_ID: 'z' }, github: gh, now: NOW, paths: PATHS, query });
  assert.equal(r.synced, true);
  assert.equal(r.prNumber, 7);
  assert.deepEqual(asked, ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']);
  assert.equal(asked.length, ROLLUP_DAYS);
  assert.ok(!asked.includes('2026-09-15'), 'today is never queried');
  assert.equal(gh.calls.filter((c) => c.startsWith('createPull')).length, 1);
  assert.ok(gh.calls.includes(`putContent ${OUTBOUND_CLICKS_PATH}`));
  assert.ok(gh.calls.includes('mergePull 7 squash'));
  const body = gh.calls.find((c) => c.startsWith('body:')).slice(5);
  const written = normalizeClicks(yaml.load(body));
  assert.deepEqual(written.coverage, asked);
  assert.deepEqual(written.clicks['/outbound/codeable']['2026-09-14'], { clicks: 3, crawlers: 0, other: 0 });
  assert.deepEqual(written.clicks['/outbound/tailscale']['2026-09-14'], { clicks: 0, crawlers: 0, other: 0 });
});

test('syncOutboundClicks: a day whose query fails is reported and left UNMEASURED, never written as zeros', async () => {
  const query = async ({ date }) => { if (date === '2026-09-12') throw new Error('cannot request data older than 1w1d'); return []; };
  const gh = fakeGithub();
  const r = await syncOutboundClicks({ env: { CF_ANALYTICS_TOKEN: 't', CF_ZONE_ID: 'z' }, github: gh, now: NOW, paths: PATHS, query });
  assert.equal(r.synced, true);
  assert.deepEqual(r.failedDates.map((f) => f.date), ['2026-09-12']);
  const written = normalizeClicks(yaml.load(gh.calls.find((c) => c.startsWith('body:')).slice(5)));
  assert.ok(!written.coverage.includes('2026-09-12'), 'the failed day is not covered');
  assert.equal(written.clicks['/codeable']['2026-09-12'], undefined, 'and has no row, so it cannot read as zero');
  assert.equal(written.clicks['/codeable']['2026-09-13'].clicks, 0, 'a day that answered with no rows is a covered zero');
});

test('syncOutboundClicks: skipped without a token, without a zone, when nothing changed, and without a GitHub client (which returns the dry result)', async () => {
  assert.deepEqual(await syncOutboundClicks({ env: {}, paths: PATHS }), { synced: false, reason: 'CF_ANALYTICS_TOKEN not set' });
  assert.equal((await syncOutboundClicks({ env: { CF_ANALYTICS_TOKEN: 't' }, paths: PATHS, zoneOf: async () => null })).reason, 'the analytics token cannot see the zone for gbti.network');
  const query = async () => [];
  const current = { coverage: ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'], clicks: Object.fromEntries(PATHS.map((p) => [p, Object.fromEntries(['08', '09', '10', '11', '12', '13', '14'].map((d) => [`2026-09-${d}`, { clicks: 0, crawlers: 0, other: 0 }]))])) };
  const gh = fakeGithub();
  const same = await syncOutboundClicks({ env: { CF_ANALYTICS_TOKEN: 't', CF_ZONE_ID: 'z' }, github: gh, now: NOW, paths: PATHS, query, readCurrent: () => current });
  assert.equal(same.synced, false);
  assert.equal(same.reason, 'clicks unchanged');
  assert.equal(gh.calls.length, 0, 'no PR for an unchanged store');
  const dry = await syncOutboundClicks({ env: { CF_ANALYTICS_TOKEN: 't', CF_ZONE_ID: 'z' }, now: NOW, paths: PATHS, query: async ({ date }) => (date === '2026-09-14' ? [row('/codeable', 301, 1)] : []) });
  assert.equal(dry.synced, false);
  assert.equal(dry.changed, true);
  assert.equal(dry.next.clicks['/codeable']['2026-09-14'].clicks, 1, 'the merged store comes back for a dry read');
});

test('dayBefore counts UTC calendar days', () => {
  assert.equal(dayBefore(NOW, 1), '2026-09-14');
  assert.equal(dayBefore(new Date('2026-09-15T00:10:00Z'), 1), '2026-09-14');
});

// Phase 1: the board's window reduction (exported from the element; base.mjs guards the DOM, so it imports in node).
test('windowFor: a covered date with no row is an explicit zero, an uncovered date is not measured, totals cover measured days only', async () => {
  const { windowFor, WINDOWS } = await import('../client-ui/src/elements/gbti-outbound-link-manager.mjs');
  assert.deepEqual([...WINDOWS], [7, 30]);
  const store = { coverage: ['2026-09-14', '2026-09-12'], clicks: { '/a': { '2026-09-14': { clicks: 3, crawlers: 1, other: 2 } } } };
  const w = windowFor(store, '/a', 3, NOW);
  assert.deepEqual({ clicks: w.clicks, crawlers: w.crawlers, other: w.other, measured: w.measured, unmeasured: w.unmeasured }, { clicks: 3, crawlers: 1, other: 2, measured: 2, unmeasured: 1 });
  assert.deepEqual(w.list.map((x) => [x.date, x.measured, x.clicks ?? null]), [['2026-09-14', true, 3], ['2026-09-13', false, null], ['2026-09-12', true, 0]]);
  const none = windowFor({ coverage: [], clicks: {} }, '/a', 7, NOW);
  assert.equal(none.measured, 0);
  assert.equal(none.unmeasured, 7);
});
