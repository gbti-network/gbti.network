// SOW-122: the Bluesky adapter (clients/syndication/bluesky.mjs). Covers secret gating, template + stub
// parity, the external embed card (present with a url, absent without), the web-URL construction, textOverride,
// 300 truncation, and error mapping. Injected two-call fetch (createSession then createRecord); no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlueskyAdapter, blueskyWebUrl } from '../clients/syndication/bluesky.mjs';
import { syndicationConfigFromParsed } from '../membership/syndication-config-core.mjs';

const ENV = { BLUESKY_HANDLE: 'gbti.bsky.social', BLUESKY_APP_PASSWORD: 'app-pass' };
const CFG = syndicationConfigFromParsed({ syndication: { channel_templates: { bluesky: {
  post: 'New {content-type} by {fullName}: "{title}" {category-hashtag} {tags-hashtags}',
} } } });
const ITEM = { source: 'post', title: 'Hello World', url: 'https://gbti.network/articles/hello/', authorName: 'Hudson Atwell', blurb: 'A tutorial.', category: 'AI', tags: ['Prompts'], enqueuedAt: 1000 };

function fakeFetch({ authOk = true, postOk = true, uri = 'at://did:plc:abc/app.bsky.feed.post/xyz123' } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('createSession')) return authOk ? { ok: true, json: async () => ({ accessJwt: 'jwt', did: 'did:plc:abc' }) } : { ok: false, status: 401, json: async () => ({ message: 'bad password' }) };
    return postOk ? { ok: true, json: async () => ({ uri }) } : { ok: false, status: 400, json: async () => ({ message: 'record too long' }) };
  };
  return { calls, fetchImpl };
}
const recordOf = (calls) => JSON.parse(calls.find((c) => c.url.includes('createRecord')).opts.body).record;

test('enabled() requires the handle + app password', () => {
  assert.equal(createBlueskyAdapter({ env: ENV }).enabled(), true);
  assert.equal(createBlueskyAdapter({ env: { BLUESKY_HANDLE: 'x' } }).enabled(), false);
  assert.equal(createBlueskyAdapter({ env: {} }).enabled(), false);
});

test('a public post renders the bluesky template (no url in text) + an external embed card + a web URL', async () => {
  const { calls, fetchImpl } = fakeFetch();
  const r = await createBlueskyAdapter({ env: ENV, fetchImpl, cfg: CFG }).post(ITEM);
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://bsky.app/profile/gbti.bsky.social/post/xyz123');
  const rec = recordOf(calls);
  assert.ok(rec.text.includes('Hello World') && rec.text.includes('#AI') && rec.text.includes('#Prompts'));
  assert.ok(!rec.text.includes('https://gbti.network'), 'the url is NOT in the text (the card carries it)');
  assert.equal(rec.embed['$type'], 'app.bsky.embed.external');
  assert.equal(rec.embed.external.uri, ITEM.url);
  assert.equal(rec.embed.external.title, 'Hello World');
  assert.equal(rec.embed.external.description, 'A tutorial.');
});

test('a url-less item posts no embed card', async () => {
  const { calls, fetchImpl } = fakeFetch();
  await createBlueskyAdapter({ env: ENV, fetchImpl, cfg: CFG }).post({ ...ITEM, url: '' });
  assert.equal(recordOf(calls).embed, undefined);
});

test('a members-only item renders the bluesky stub', async () => {
  const { calls, fetchImpl } = fakeFetch();
  await createBlueskyAdapter({ env: ENV, fetchImpl, cfg: syndicationConfigFromParsed({}) }).post({ ...ITEM, visibility: 'members' });
  assert.ok(/Members-only on the GBTI Network/i.test(recordOf(calls).text));
});

test('textOverride wins and the text truncates to 300', async () => {
  const a = fakeFetch();
  await createBlueskyAdapter({ env: ENV, fetchImpl: a.fetchImpl, cfg: CFG }).post({ ...ITEM, textOverride: 'hand written' });
  assert.equal(recordOf(a.calls).text, 'hand written');
  const b = fakeFetch();
  await createBlueskyAdapter({ env: ENV, fetchImpl: b.fetchImpl, cfg: CFG }).post({ ...ITEM, textOverride: 'z'.repeat(400) });
  assert.ok(recordOf(b.calls).text.length <= 300);
});

test('auth failure and post failure map to { ok:false, error }', async () => {
  const r = await createBlueskyAdapter({ env: ENV, fetchImpl: fakeFetch({ authOk: false }).fetchImpl, cfg: CFG }).post(ITEM);
  assert.equal(r.ok, false); assert.ok(/bluesky auth/.test(r.error));
  const r2 = await createBlueskyAdapter({ env: ENV, fetchImpl: fakeFetch({ postOk: false }).fetchImpl, cfg: CFG }).post(ITEM);
  assert.equal(r2.ok, false); assert.ok(/record too long/.test(r2.error), r2.error);
});

test('blueskyWebUrl builds bsky.app/profile/<handle>/post/<rkey>', () => {
  assert.equal(blueskyWebUrl('at://did:plc:abc/app.bsky.feed.post/xyz123', 'gbti.bsky.social'), 'https://bsky.app/profile/gbti.bsky.social/post/xyz123');
  assert.equal(blueskyWebUrl('at://did/coll/r', '@handle'), 'https://bsky.app/profile/handle/post/r');
  assert.equal(blueskyWebUrl('', 'h'), null);
});
