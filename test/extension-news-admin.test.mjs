// sow-420 (owner, 2026-09-28: "we want our superadmin ability to add weight or remove weight to news sources from the
// extension."): the website's superadmin card on a news story (sow-338) now sits in the extension's news reader.
// These tests hold the parts that can be checked without a browser: the remove/restore relay reaches the Worker with
// the member's token, both hosts serve it, the client can call it, only a superadmin gets the card, and the card says
// what the website card says. The browser drive of the card itself is recorded in the sow-420 document.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { dispatch } from '../extension/src/ext-dispatch.mjs';
import { handleApi } from '../client/src/api.mjs';
import { createHttpClient } from '../client-ui/src/client.mjs';
import { NEWS_ADMIN_COPY, savedWeightNote, removeQuestion } from '../client-ui/src/elements/gbti-news-admin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function workerStub(answer = { ok: true }, status = 200) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null });
    return { ok: status < 400, status, async json() { return answer; } };
  };
  return { calls, fetch };
}

function ctxFor({ fetch, identity = { login: 'alice', githubId: '1', username: 'alice' } } = {}) {
  return {
    identity: () => identity,
    store: { get: (k) => ({ githubToken: 'tok' })[k] },
    getRepoClient: () => null,
    fetch: fetch ?? (async () => { throw new Error('no network in test'); }),
    reader: { async readFile() { return null; } },
  };
}

test('sow-420: the extension relays remove and restore to the Worker with the member token', async () => {
  const { calls, fetch } = workerStub({ ok: true, removed: true });
  const ctx = ctxFor({ fetch });
  for (const action of ['remove', 'restore']) {
    const r = await dispatch(ctx, { method: 'POST', pathname: '/api/news-item', body: { action, guid: ' g-1 ' }, query: {} });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.body), [{ action: 'remove', guid: 'g-1' }, { action: 'restore', guid: 'g-1' }]);
  for (const c of calls) {
    assert.match(c.url, /\/membership\/admin\/news-item$/);
    assert.equal(c.method, 'POST');
    assert.equal(c.auth, 'Bearer tok', 'the Worker is the superadmin gate, so it must be handed the member token');
  }
});

test('sow-420: a bad action, a missing story or a GET is refused before anything reaches the Worker', async () => {
  const { calls, fetch } = workerStub();
  const ctx = ctxFor({ fetch });
  const bad = await dispatch(ctx, { method: 'POST', pathname: '/api/news-item', body: { action: 'delete', guid: 'g-1' }, query: {} });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'bad-request');
  const noGuid = await dispatch(ctx, { method: 'POST', pathname: '/api/news-item', body: { action: 'remove', guid: '  ' }, query: {} });
  assert.equal(noGuid.status, 400);
  assert.equal(noGuid.json.error, 'bad-request');
  const get = await dispatch(ctx, { method: 'GET', pathname: '/api/news-item', query: {} });
  assert.equal(get.status, 404);
  assert.equal(calls.length, 0);
  // Signed out: the identity gate answers first.
  const anon = await dispatch(ctxFor({ fetch, identity: null }), { method: 'POST', pathname: '/api/news-item', body: { action: 'remove', guid: 'g-1' }, query: {} });
  assert.notEqual(anon.status, 200);
  assert.equal(calls.length, 0);
});

test('sow-420: a Worker refusal reaches the card as its own message', async () => {
  const { fetch } = workerStub({ error: 'forbidden', message: 'superadmin only' }, 403);
  const r = await dispatch(ctxFor({ fetch }), { method: 'POST', pathname: '/api/news-item', body: { action: 'remove', guid: 'g-1' }, query: {} });
  assert.notEqual(r.status, 200);
  assert.equal(r.json.message, 'superadmin only');
});

test('sow-420: the agent server serves the same route the same way', async () => {
  const { calls, fetch } = workerStub();
  const r = await handleApi({ method: 'POST', pathname: '/api/news-item', body: { action: 'remove', guid: 'g-2' } }, ctxFor({ fetch }));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { action: 'remove', guid: 'g-2' });
  const bad = await handleApi({ method: 'POST', pathname: '/api/news-item', body: { action: 'nope', guid: 'g-2' } }, ctxFor({ fetch }));
  assert.equal(bad.status, 400);
});

test('sow-420: the extension client sends removeNewsItem and restoreNewsItem to the relay', async () => {
  const sent = [];
  const client = createHttpClient({ token: 'extension', fetch: async (url, init) => { sent.push({ url, method: init.method, body: JSON.parse(init.body) }); return { ok: true, status: 200, async json() { return { ok: true }; } }; } });
  await client.removeNewsItem('g-3');
  await client.restoreNewsItem('g-3');
  assert.deepEqual(sent, [
    { url: '/api/news-item', method: 'POST', body: { action: 'remove', guid: 'g-3' } },
    { url: '/api/news-item', method: 'POST', body: { action: 'restore', guid: 'g-3' } },
  ]);
  // The website client already had these two names (sow-338); the card calls the same ones on either client.
  const web = read('src/lib/workbench-client.ts') + '\n' + read('src/lib/workbench-client-admin.ts'); // admin methods, split out at the 900-line cap
  assert.match(web, /removeNewsItem\(guid/);
  assert.match(web, /restoreNewsItem\(guid/);
});

test('sow-420: the reader creates the card for a superadmin and for nobody else', () => {
  const src = read('client-ui/src/elements/gbti-news-reader.mjs');
  // The only place the card is created, and the only call to it, behind the superadmin role.
  assert.equal((src.match(/createElement\('gbti-news-admin'\)/g) || []).length, 1);
  const calls = src.match(/this\._mountAdmin\(/g) || [];
  assert.equal(calls.length, 1, 'one call site, so the role check below covers every way the card is created');
  // sow-171: the same superadmin check now also creates the news share panel, in one block.
  assert.match(src, /if \(status\?\.role === 'superadmin' && item\.guid && this\._item === item\) \{ this\._mountAdmin\(item\); this\._mountShare\(item\); \}/);
  // Every open() starts without a card, so a card from a superadmin session never carries over to another story.
  const open = src.slice(src.indexOf('async open(item)'), src.indexOf('this.render();', src.indexOf('async open(item)')));
  assert.match(open, /this\._admin = null;/);
  // The card is placed only when one was made.
  assert.match(src, /\$\{this\._admin \? '<div data-admin-slot><\/div>' : ''\}/);
});

test('sow-420: the card says what the website card says', () => {
  const astro = read('src/components/news/NewsAdminControls.astro');
  // Every string in the card's copy is on the website card word for word. The one note the extension adds sits
  // outside this object: the website reads the weight with the story, the extension reads it separately and can fail.
  for (const [key, text] of Object.entries(NEWS_ADMIN_COPY)) {
    assert.ok(astro.includes(text), `${key}: "${text}" is not on the website card`);
  }
  assert.ok(astro.includes('`Saved. We will take ${weightLabel(target).toLowerCase()} from this source on the next deploy.`'));
  assert.equal(savedWeightNote(2), 'Saved. We will take much more from this source on the next deploy.');
  assert.equal(savedWeightNote(0), NEWS_ADMIN_COPY.backToNormal);
  assert.ok(astro.includes('Remove ${title} from the news index? You can put it back from this page.'));
  assert.equal(removeQuestion('A story'), 'Remove "A story" from the news index? You can put it back from this page.');
  assert.equal(removeQuestion(''), 'Remove this story from the news index? You can put it back from this page.');
});

test('sow-420: no em or en dash and no contraction in what the card shows', () => {
  const src = read('client-ui/src/elements/gbti-news-admin.mjs');
  const shown = [...Object.values(NEWS_ADMIN_COPY), savedWeightNote(1), removeQuestion('x'),
    ...[...src.matchAll(/this\._weightNote = '([^']+)'/g)].map((m) => m[1])];
  assert.ok(shown.length > Object.keys(NEWS_ADMIN_COPY).length + 2, 'the load-failure note was found, so the scan reached it');
  for (const s of shown) {
    assert.doesNotMatch(s, /[–—]/, s);
    assert.doesNotMatch(s, /\b\w+'(t|s|re|ll|ve|d)\b/, s);
  }
});
