// SOW-122: the Bluesky adapter (clients/syndication/bluesky.mjs). Covers secret gating, template + stub
// parity, the external embed card (present with a url, absent without), the web-URL construction, textOverride,
// 300 truncation, and error mapping. Injected two-call fetch (createSession then createRecord); no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlueskyAdapter, blueskyWebUrl, mentionFacet, hashtagFacets } from '../clients/syndication/bluesky.mjs';
import { syndicationConfigFromParsed } from '../membership/syndication-config-core.mjs';

const ENV = { BLUESKY_HANDLE: 'gbti.bsky.social', BLUESKY_APP_PASSWORD: 'app-pass' };
const CFG = syndicationConfigFromParsed({ syndication: { channel_templates: { bluesky: {
  post: 'New {content-type} by {fullName}: "{title}" {category-hashtag} {tags-hashtags}',
} } } });
const ITEM = { source: 'post', title: 'Hello World', url: 'https://gbti.network/articles/hello/', authorName: 'Hudson Atwell', blurb: 'A tutorial.', category: 'AI', tags: ['Prompts'], enqueuedAt: 1000 };

function fakeFetch({ authOk = true, postOk = true, uri = 'at://did:plc:abc/app.bsky.feed.post/xyz123', resolveDid = 'did:plc:author', resolveOk = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('createSession')) return authOk ? { ok: true, json: async () => ({ accessJwt: 'jwt', did: 'did:plc:abc', handle: 'gbti.bsky.social' }) } : { ok: false, status: 401, json: async () => ({ message: 'bad password' }) };
    if (url.includes('resolveHandle')) return resolveOk ? { ok: true, json: async () => ({ did: resolveDid }) } : { ok: false, status: 400, json: async () => ({}) };
    return postOk ? { ok: true, json: async () => ({ uri }) } : { ok: false, status: 400, json: async () => ({ message: 'record too long' }) };
  };
  return { calls, fetchImpl };
}
const BSKY_CFG = syndicationConfigFromParsed({ syndication: { channel_templates: { bluesky: {
  post: 'New {content-type} by {member-bluesky-handle}: "{title}"',
} } } });
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

// SOW-122 follow-up: the {member-bluesky-handle} mention facet.
test('a member with a Bluesky handle: the handle is rendered and faceted with the resolved DID', async () => {
  const { calls, fetchImpl } = fakeFetch({ resolveDid: 'did:plc:author' });
  await createBlueskyAdapter({ env: ENV, fetchImpl, cfg: BSKY_CFG })
    .post({ ...ITEM, authorBluesky: 'https://bsky.app/profile/atwellpub.bsky.social' });
  const rec = recordOf(calls);
  assert.ok(rec.text.includes('@atwellpub.bsky.social'), 'the handle is in the text');
  assert.ok(Array.isArray(rec.facets) && rec.facets.length === 1, 'a facet is attached');
  const f = rec.facets[0];
  assert.equal(f.features[0]['$type'], 'app.bsky.richtext.facet#mention');
  assert.equal(f.features[0].did, 'did:plc:author');
  // The byte range covers exactly "@atwellpub.bsky.social".
  const start = new TextEncoder().encode(rec.text.slice(0, rec.text.indexOf('@atwellpub.bsky.social'))).length;
  assert.equal(f.index.byteStart, start);
  assert.equal(f.index.byteEnd, start + new TextEncoder().encode('@atwellpub.bsky.social').length);
  assert.ok(calls.some((c) => c.url.includes('resolveHandle')), 'resolveHandle was called');
});

test('a member without a Bluesky handle: full-name fallback, no facet, no resolve call', async () => {
  const { calls, fetchImpl } = fakeFetch();
  await createBlueskyAdapter({ env: ENV, fetchImpl, cfg: BSKY_CFG }).post({ ...ITEM, authorName: 'Hudson Atwell' });
  const rec = recordOf(calls);
  assert.ok(rec.text.includes('Hudson Atwell'));
  assert.equal(rec.facets, undefined);
  assert.ok(!calls.some((c) => c.url.includes('resolveHandle')));
});

test('a resolve miss leaves the plain @handle and no facet (post still succeeds)', async () => {
  const { calls, fetchImpl } = fakeFetch({ resolveOk: false });
  const r = await createBlueskyAdapter({ env: ENV, fetchImpl, cfg: BSKY_CFG })
    .post({ ...ITEM, authorBluesky: '@propertunity.bsky.social' });
  assert.equal(r.ok, true);
  const rec = recordOf(calls);
  assert.ok(rec.text.includes('@propertunity.bsky.social'));
  assert.equal(rec.facets, undefined);
});

test('mentionFacet computes the byte range (multibyte-safe) or null', () => {
  const f = mentionFacet('hi @a.bsky.social there', 'a.bsky.social', 'did:x');
  assert.equal(f.index.byteStart, 3);
  assert.equal(f.index.byteEnd, 3 + '@a.bsky.social'.length);
  // multibyte prefix shifts the byte offsets
  const f2 = mentionFacet('café @a.bsky.social', 'a.bsky.social', 'did:x'); // the combining accent is 2 bytes
  assert.equal(f2.index.byteStart, new TextEncoder().encode('café ').length);
  assert.equal(mentionFacet('no mention here', 'a.bsky.social', 'did:x'), null);
  assert.equal(mentionFacet('@a.bsky.social', 'a.bsky.social', null), null); // no did
});

// SOW-122: hashtag tag facets.
test('hashtagFacets makes each #tag a tag facet at the right byte range', () => {
  const f = hashtagFacets('hello #AI world #ClaudeCode');
  assert.equal(f.length, 2);
  assert.equal(f[0].features[0]['$type'], 'app.bsky.richtext.facet#tag');
  assert.equal(f[0].features[0].tag, 'AI');
  assert.equal(f[0].index.byteStart, 6);           // "hello " = 6 bytes
  assert.equal(f[0].index.byteEnd, 6 + '#AI'.length);
  assert.equal(f[1].features[0].tag, 'ClaudeCode');
  assert.deepEqual(hashtagFacets('no tags here'), []);
});

// SOW-126 review fix: hashtagFacets must anchor to a hashtag boundary + a non-digit first char, and keep a
// multibyte tag whole, so it does not tag a mid-word '#' or a pure-numeric run, and does not truncate an
// accented tag. (A hex-looking '#FF0000' starts with a letter, so it is a syntactically valid tag and is kept.)
test('hashtagFacets: boundary + non-digit-first + unicode-whole', () => {
  assert.deepEqual(hashtagFacets('foo#bar').map((x) => x.features[0].tag), []); // mid-word '#' -> no boundary, not a tag
  assert.deepEqual(hashtagFacets('Top 10: #1 tip').map((x) => x.features[0].tag), []); // pure numeric -> not a tag
  assert.deepEqual(hashtagFacets('a #1a b').map((x) => x.features[0].tag), []); // digit-first -> not a tag (stricter than Bluesky, safe)
  const cafe = hashtagFacets('love #café today');
  assert.equal(cafe.length, 1);
  assert.equal(cafe[0].features[0].tag, 'café'); // multibyte kept whole (not truncated to 'caf')
  const enc = new TextEncoder();
  assert.equal(cafe[0].index.byteStart, enc.encode('love ').length); // byte range starts at the '#', not the space
  assert.equal(cafe[0].index.byteEnd, cafe[0].index.byteStart + enc.encode('#café').length);
});

test('a post with hashtags AND a mention carries both, ordered by byte offset', async () => {
  const cfg = syndicationConfigFromParsed({ syndication: { channel_templates: { bluesky: { post: 'By {member-bluesky-handle} #AI #Skill' } } } });
  const { calls, fetchImpl } = fakeFetch({ resolveDid: 'did:plc:a' });
  await createBlueskyAdapter({ env: ENV, fetchImpl, cfg }).post({ ...ITEM, authorBluesky: 'https://bsky.app/profile/atwellpub.bsky.social' });
  const facets = recordOf(calls).facets;
  const types = facets.map((x) => x.features[0]['$type']);
  assert.ok(types.includes('app.bsky.richtext.facet#mention'));
  assert.equal(types.filter((t) => t === 'app.bsky.richtext.facet#tag').length, 2);
  for (let i = 1; i < facets.length; i++) assert.ok(facets[i].index.byteStart >= facets[i - 1].index.byteStart, 'ordered by byteStart');
});
