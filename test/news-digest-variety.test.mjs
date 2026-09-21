// sow-384: the digest's news picks one story per category and one per publication, from a ranked list.
//
// The incident this exists for: the weekly of 2026-09-21 carried five crypto stories. The six crypto outlets sit side
// by side in the collection rotation, so one hourly run collected only crypto just before the compile, and the digest
// took the five newest stories it had. POOL_2026_09_21 below is that pool as it stood at compile time (the newest 20
// of the 60, public headlines from the news feed), and the first test proves it reproduces the incident before the
// rest test the fix, so a fixture that stopped reproducing it could not make the fix look good.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVariedNews, composeIssue } from '../membership/mail-digest.mjs';
import { normalizeNewsEntry } from '../membership/mail-compile-core.mjs';

const at = (t) => () => t;

// Newest first, which is the ranked order when nobody has opened anything (opens were all zero on the day).
const POOL_2026_09_21 = [
  { title: 'Bitcoin taps $85,000 for first time since January as crypto short liquidations s', source: 'the-block', category: 'Blockchain', date: 1789988214 },
  { title: 'NEAR jumps nearly 80% in a week as Intents volume nears $30B', source: 'cointelegraph-com-news', category: 'Blockchain', date: 1789987955 },
  { title: 'Bitcoin hits $85,000 as short squeeze forces out $648 million of bearish bets', source: 'coindesk-bitcoin-ethereum-crypto-news-an', category: 'Blockchain', date: 1789986600 },
  { title: 'BTC price nears eight-month high above $85K: Five things to know in Bitcoin this', source: 'cointelegraph-com-news', category: 'Business/Funding', date: 1789985751 },
  { title: 'X sues its own users for running a fake bitcoin news bot farm', source: 'coindesk-bitcoin-ethereum-crypto-news-an', category: 'Business/Funding', date: 1789985744 },
  { title: 'Crypto Worker\'s Children Held Hostage in Latest French ‘Wrench Attack,’ $46,000', source: 'decrypt', category: 'Business/Funding', date: 1789984284 },
  { title: 'X sues Bitcoin account operators over alleged $278K payout fraud', source: 'cointelegraph-com-news', category: 'Business/Funding', date: 1789983325 },
  { title: 'X sues UK duo over alleged $277K crypto account payout fraud', source: 'the-block', category: 'Blockchain', date: 1789982667 },
  { title: 'Crypto enjoys bullish bounce post-Fed rate hike: Crypto Week Ahead', source: 'coindesk-bitcoin-ethereum-crypto-news-an', category: 'Business/Funding', date: 1789981962 },
  { title: 'Hana Bank issues South Korea’s first digital bond using Euroclear’s blockchain', source: 'coindesk-bitcoin-ethereum-crypto-news-an', category: 'Blockchain', date: 1789980599 },
  { title: 'ClickFix Lures Deploy ChainScript RAT Using Polygon to Rotate C2 Infrastructure', source: 'thehackernews-com', category: 'Security', date: 1789979978 },
  { title: 'The Sinclair Spectrum Gets A Desktop GUI', source: 'hackaday', category: 'Frameworks/Libraries', date: 1789977634 },
  { title: 'AI can find vulnerabilities. Humans find ways in', source: 'techcentral', category: 'AI/ML', date: 1789977371 },
  { title: 'Knowledge cutoff is a poor proxy for model capability', source: 'visual-studio-blog', category: 'AI/ML', date: 1789977106 },
  { title: 'ZetaChain holders approve plan to wind down L1, move ZETA to Solana', source: 'cointelegraph-com-news', category: 'Blockchain', date: 1789975907 },
  { title: 'VMware has quietly walked its SmartNIC ambitions', source: 'the-register', category: 'Frameworks/Libraries', date: 1789974120 },
  { title: 'Bank of Korea launches 24-hour won settlement pilot for foreign investors', source: 'cointelegraph-com-news', category: 'Business/Funding', date: 1789972883 },
  { title: 'Boss bought cheap \'printer\' from a catalog and was left without a leg to stand', source: 'the-register', category: 'Business/Funding', date: 1789972200 },
  { title: 'Kalshi faces ‘fake crypto volume’ allegations as critic flags identical $5,500 t', source: 'coindesk-bitcoin-ethereum-crypto-news-an', category: 'Blockchain', date: 1789971647 },
  { title: 'Jade Sleet Linked to Indian IT Provider Breach With FLATROOF and ROOFDECK Backdo', source: 'thehackernews-com', category: 'Security', date: 1789970804 },
];

const titles = (list) => list.map((n) => n.title.slice(0, 28));
const plainSlice = (ranked, n) => ranked.slice(0, n); // the pick before sow-384

test('the fixture reproduces the incident: the old top-five slice was five crypto stories from three outlets', () => {
  const old = plainSlice(POOL_2026_09_21, 5);
  assert.deepEqual(old.map((n) => n.category), ['Blockchain', 'Blockchain', 'Blockchain', 'Business/Funding', 'Business/Funding']);
  assert.deepEqual([...new Set(old.map((n) => n.source))].sort(), ['coindesk-bitcoin-ethereum-crypto-news-an', 'cointelegraph-com-news', 'the-block']);
});

test('sow-384: the same pool picks one story per category and one per publication', () => {
  const picks = pickVariedNews(POOL_2026_09_21, 5);
  assert.deepEqual(titles(picks), [
    'Bitcoin taps $85,000 for firs',
    'BTC price nears eight-month h',
    'ClickFix Lures Deploy ChainSc',
    'The Sinclair Spectrum Gets A ',
    'AI can find vulnerabilities. ',
  ].map((t) => t.slice(0, 28)));
  assert.deepEqual(picks.map((n) => n.category), ['Blockchain', 'Business/Funding', 'Security', 'Frameworks/Libraries', 'AI/ML']);
  assert.equal(new Set(picks.map((n) => n.category)).size, 5, 'no category twice');
  assert.equal(new Set(picks.map((n) => n.source)).size, 5, 'no publication twice');
});

test('sow-384: the picks keep their ranked order and never include an unranked story', () => {
  const picks = pickVariedNews(POOL_2026_09_21, 5);
  const positions = picks.map((p) => POOL_2026_09_21.indexOf(p));
  assert.ok(positions.every((p) => p >= 0), 'every pick is from the ranked list, by identity');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'in ranked order');
});

test('sow-384: a short week relaxes the CATEGORY limit and never the publication one (owner ruling 2026-09-21)', () => {
  // Two categories, five publications: the first pass finds two, the second fills from new publications.
  const ranked = ['a', 'b', 'c', 'd', 'e'].map((src, i) => ({ title: `t${i}`, source: src, category: i % 2 ? 'AI/ML' : 'Security' }));
  const picks = pickVariedNews(ranked, 5);
  assert.equal(picks.length, 5, 'the section fills');
  assert.deepEqual(picks.map((n) => n.source), ['a', 'b', 'c', 'd', 'e'], 'every publication once, categories repeating');

  // Three publications only: the relaxed pass cannot add a fourth, so the section is short rather than repeating one.
  const three = ['a', 'a', 'b', 'b', 'c', 'c'].map((src, i) => ({ title: `u${i}`, source: src, category: `k${i}` }));
  const short = pickVariedNews(three, 5);
  assert.deepEqual(short.map((n) => n.source), ['a', 'b', 'c'], 'one per publication, even when that leaves the section short');
});

test('sow-384: the relaxed pass runs only when the first pass comes up short', () => {
  // Five categories and publications available: a repeat-category story ranked second must NOT be taken.
  const ranked = [
    { title: 'first', source: 'a', category: 'Security' },
    { title: 'same category, ranked second', source: 'b', category: 'Security' },
    { title: 'c', source: 'c', category: 'AI/ML' },
    { title: 'd', source: 'd', category: 'Energy' },
    { title: 'e', source: 'e', category: 'Hardware' },
    { title: 'f', source: 'f', category: 'Web Dev' },
  ];
  assert.deepEqual(pickVariedNews(ranked, 5).map((n) => n.title), ['first', 'c', 'd', 'e', 'f']);
});

test('sow-384: Other is ONE category, and a story with no category counts as Other', () => {
  const ranked = [
    { title: 'unclassified', source: 'a', category: null },
    { title: 'filed under Other', source: 'b', category: 'Other' },
    { title: 'real category', source: 'c', category: 'AI/ML' },
  ];
  assert.deepEqual(pickVariedNews(ranked, 2).map((n) => n.title), ['unclassified', 'real category'], 'the second Other waits');
});

test('sow-384: categories and publications compare case-insensitively; no publication id falls back to the web host', () => {
  const ranked = [
    { title: 'one', source: 'Wired', category: 'AI/ML' },
    { title: 'same outlet, other case', source: 'wired', category: 'Energy' },
    { title: 'same category, other case', source: 'x', category: 'ai/ml' },
    { title: 'no id, host a', url: 'https://a.example/1', category: 'Security' },
    { title: 'no id, same host', url: 'https://a.example/2', category: 'Hardware' },
    { title: 'no id, other host', url: 'https://b.example/1', category: 'Web Dev' },
  ];
  // A cap of 3 is filled by the FIRST pass alone, so a case-sensitive comparison would show: it would take "same
  // outlet, other case" (a new category) or "same category, other case" (a new publication) ahead of the host picks.
  assert.deepEqual(pickVariedNews(ranked, 3).map((n) => n.title), ['one', 'no id, host a', 'no id, other host']);
  // With room for more, the relaxed pass adds the repeated category from a new publication, at its ranked position,
  // and still refuses the second Wired story and the second story from host a.
  assert.deepEqual(pickVariedNews(ranked, 6).map((n) => n.title), ['one', 'same category, other case', 'no id, host a', 'no id, other host']);
});

test('sow-384: the cap is honoured, and nonsense input yields nothing rather than throwing', () => {
  assert.equal(pickVariedNews(POOL_2026_09_21, 3).length, 3);
  assert.deepEqual(pickVariedNews(POOL_2026_09_21, 0), []);
  assert.deepEqual(pickVariedNews(null, 5), []);
  assert.deepEqual(pickVariedNews(POOL_2026_09_21, 'x'), []);
});

// The integration: composeIssue ranks by opens then newest and THEN picks, and the category survives the
// normalizer and the frozen projection. A picker that was right and never called would pass every test above.
test('sow-384: composeIssue ranks first, picks for variety second, and keeps the category on the frozen issue', () => {
  const news = POOL_2026_09_21.map((n, i) => normalizeNewsEntry({ ...n, url: `https://news.example/${i}`, opens: 0 }));
  // One reader opened the Hackaday story: it outranks everything, and the variety pick still follows.
  news[11] = { ...news[11], opens: 1 };
  const issue = composeIssue({ issueId: 'i', items: [], news, now: at(1_790_000_000_000) }, { maxNews: 5 });
  assert.deepEqual(issue.topNews.map((n) => n.category), ['Frameworks/Libraries', 'Blockchain', 'Business/Funding', 'Security', 'AI/ML']);
  assert.equal(issue.topNews[0].title, 'The Sinclair Spectrum Gets A Desktop GUI', 'the opened story leads');
  assert.ok(issue.topNews.every((n) => typeof n.category === 'string' && n.category), 'the category reaches the frozen issue');
});

test('sow-384: the thin-week lift still widens the section, still one per category and publication', () => {
  const news = POOL_2026_09_21.map((n, i) => normalizeNewsEntry({ ...n, url: `https://news.example/${i}` }));
  const issue = composeIssue({ issueId: 'i', items: [], news, now: at(1_790_000_000_000) }, { maxNews: 3, maxNewsThin: 8 });
  // The fixture spans five categories, so the first pass finds five and the relaxed pass adds three more from
  // publications not yet used, never repeating one.
  assert.equal(issue.topNews.length, 8);
  assert.equal(new Set(issue.topNews.map((n) => n.source)).size, 8, 'eight different publications');
});
