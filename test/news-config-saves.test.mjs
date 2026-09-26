// sow-415: the blocked words (sow-372) and the source weights (sow-338) shipped unable to save anything. Their
// validators live in node-free membership cores that THROW and return bare args, the Worker's config dispatch
// expected { ok, args }, and it answered every save with a 200 and an EMPTY body, which both managers reported as
// "Done." No blocked-word pull request was ever opened, and house/news-source-weights.yml never held a value.
//
// The tests that shipped with those features read the Worker's action table as TEXT and tested the pure cores on
// their own, so neither could see the seam between the two. These drive a save through the route itself and
// assert on what was WRITTEN, and the census at the end asks every admin action the same question at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';
import { WORKER_ADMIN_ACTIONS } from '../client/src/admin-worker-actions.mjs';
import { pendingEdits, overlayWords, overlayWeights } from '../client-ui/src/news-source-manager-core.mjs';

const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
const staffSuper = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const allow = async () => ({ allowed: true });
const signJwt = async () => 'fake.jwt.sig';
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deB64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');

const FILES = {
  'house/news-banwords.yml': '# the words that keep a story out\nwords:\n  - covid\n  - trump\n',
  'house/news-source-weights.yml': '# how much we take from a source\nweights: {}\n',
};

// A GitHub that serves the two house files above and records every write. Any other house file reads as an empty
// document, which is enough for the census: it asks only that each action answers with a status and a body.
function ghFetch(record) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/app\/installations\/\d+\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'inst' }; } };
    const read = url.match(/\/contents\/(house\/[^?]+)\?ref=main$/);
    if (read && method === 'GET') return { ok: true, status: 200, async json() { return { content: b64(FILES[read[1]] ?? 'x: 1\n'), sha: 'abc' }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') { record.push({ method, url }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; } };
    if (/\/contents\//.test(url) && method === 'PUT') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return { number: 9, html_url: 'https://x/pull/9' }; } }; }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const kv = { async get() { return null; }, async put() {} };
const run = (body, record = []) => membershipAdminAuthor(req(body), env, { fetchImpl: ghFetch(record), authorize: staffSuper, kv, limiter: allow, signJwt });
const written = (record) => yaml.load(deB64(record.find((r) => r.method === 'PUT').body.content));

test('sow-415: blocking a word writes it and opens a pull request', async () => {
  const record = [];
  const r = await run({ action: 'news-banword-add', word: '  Election ' }, record);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body?.number, 9, 'the manager reads the pull request number from the reply');
  assert.deepEqual(written(record).words, ['covid', 'election', 'trump'], 'normalised and kept sorted');
  const put = record.find((x) => x.method === 'PUT');
  assert.match(put.url, /contents\/house\/news-banwords\.yml/);
  assert.match(deB64(put.body.content), /^# the words that keep a story out/, 'the leading comment survives');
  assert.ok(record.some((x) => /\/pulls$/.test(x.url)), 'one pull request is opened');
});

test('sow-415: unblocking a word removes it, and an unknown word is a clean no-op', async () => {
  const record = [];
  const r = await run({ action: 'news-banword-remove', word: 'trump' }, record);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(written(record).words, ['covid']);
  const none = [];
  const n = await run({ action: 'news-banword-remove', word: 'nothing' }, none);
  assert.equal(n.status, 200);
  assert.equal(n.body?.noop, true);
  assert.equal(none.length, 0, 'a no-op writes nothing');
});

test('sow-415: a malformed word is refused with a reason, and nothing is written', async () => {
  for (const word of ['x', '42', 'a.b', '']) {
    const record = [];
    const r = await run({ action: 'news-banword-add', word }, record);
    assert.equal(r.status, 400, `${JSON.stringify(word)}: ${JSON.stringify(r.body)}`);
    assert.match(r.body?.message || '', /blocked word/);
    assert.equal(record.length, 0);
  }
});

test('sow-415: a source weight saves, and an out-of-range one is refused', async () => {
  const record = [];
  const r = await run({ action: 'news-source-weight', id: 'hacker-news', weight: -1 }, record);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(written(record).weights['hacker-news'], -1);
  const bad = [];
  const b = await run({ action: 'news-source-weight', id: 'hacker-news', weight: 9 }, bad);
  assert.equal(b.status, 400);
  assert.equal(bad.length, 0);
});

// The census. An EMPTY payload is the worst case for a validator, and every one of these must still answer with a
// numeric status and an object body. A missing status is what the route turned into a silent 200 (the defect this
// file exists for); a throw is a 500 with no reason. Neither may come back for any action, present or future.
test('sow-415: every admin action answers an empty payload with a status and a body', async () => {
  const bad = [];
  for (const action of WORKER_ADMIN_ACTIONS) {
    let r;
    try { r = await run({ action }); } catch (e) { bad.push(`${action}: threw ${e?.message}`); continue; }
    if (typeof r?.status !== 'number' || !r.body || typeof r.body !== 'object') bad.push(`${action}: ${JSON.stringify(r)}`);
    // The dispatch's own backstop answers a validator of the wrong shape with a 500. That keeps the route honest, but
    // it is still the defect, so it fails here too: the backstop must never be the thing that answers.
    else if (/could not check its input/.test(r.body.message || '')) bad.push(`${action}: a validator returned the wrong shape`);
  }
  assert.deepEqual(bad, []);
  assert.ok(WORKER_ADMIN_ACTIONS.has('news-banword-add') && WORKER_ADMIN_ACTIONS.size > 30, 'the census ran over the real table');
});

test('sow-415: a saved word shows at once and is dropped once main agrees', () => {
  const held = pendingEdits();
  held.words.set('election', true);
  assert.deepEqual(overlayWords(['covid', 'trump'], held), ['covid', 'election', 'trump'], 'shown before it merges');
  assert.equal(held.words.size, 1, 'still held while main lacks it');
  assert.deepEqual(overlayWords(['covid', 'election', 'trump'], held), ['covid', 'election', 'trump']);
  assert.equal(held.words.size, 0, 'settled once main has it');
  held.words.set('trump', false);
  assert.deepEqual(overlayWords(['covid', 'election', 'trump'], held), ['covid', 'election'], 'an unblock hides at once');
  assert.deepEqual(overlayWords(['covid', 'election'], held), ['covid', 'election']);
  assert.equal(held.words.size, 0);
});

test('sow-415: a saved weight shows at once, neutral is absence, and it settles like the words', () => {
  const held = pendingEdits();
  held.weights.set('hn', 1);
  held.weights.set('wired', 0);
  assert.deepEqual(overlayWeights({ wired: -2 }, held), { hn: 1 }, 'a step back to neutral removes the entry');
  assert.equal(held.weights.size, 2);
  assert.deepEqual(overlayWeights({ hn: 1 }, held), { hn: 1 });
  assert.equal(held.weights.size, 0);
});
