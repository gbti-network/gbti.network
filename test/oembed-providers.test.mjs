// SOW-102: provider oEmbed fallbacks for the share link preview — URL matching (bounded provider set) and
// the oEmbed JSON -> preview mapping, plus the handler-level oEmbed-first flow with the scrape fallback and
// the empty-signal suggester skip. No network: injected fetch fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oembedEndpointFor, previewFromOembed, maxresThumbCandidate } from '../workers/lib/oembed-providers.mjs';
import { handleOgPreview } from '../workers/signup/membership-og.mjs';

const OWNER_URL = 'https://www.youtube.com/watch?v=N_GfH09iP9c&list=RDN_GfH09iP9c&start_radio=1';

test('oembedEndpointFor matches YouTube + Vimeo shapes and nothing else', () => {
  // The exact URL from the report (watch + list + start_radio params) matches.
  const owner = oembedEndpointFor(OWNER_URL);
  assert.ok(owner.startsWith('https://www.youtube.com/oembed?url='));
  assert.ok(owner.includes(encodeURIComponent(OWNER_URL)));
  assert.ok(owner.endsWith('&format=json'));
  // Shortlink, shorts, music host, vimeo.
  assert.ok(oembedEndpointFor('https://youtu.be/N_GfH09iP9c'));
  assert.ok(oembedEndpointFor('https://www.youtube.com/shorts/abcdef123'));
  assert.ok(oembedEndpointFor('https://music.youtube.com/watch?v=N_GfH09iP9c'));
  assert.ok(oembedEndpointFor('https://vimeo.com/123456789').startsWith('https://vimeo.com/api/oembed.json?url='));
  assert.ok(oembedEndpointFor('https://player.vimeo.com/video/123456789'));
  // Non-matches: other hosts, channel/user pages, garbage.
  assert.equal(oembedEndpointFor('https://example.com/watch?v=abc'), null);
  assert.equal(oembedEndpointFor('https://www.youtube.com/@somechannel'), null);
  assert.equal(oembedEndpointFor('https://www.youtube.com/results?search_query=x'), null);
  assert.equal(oembedEndpointFor('https://vimeo.com/about'), null);
  assert.equal(oembedEndpointFor('not a url'), null);
  assert.equal(oembedEndpointFor('ftp://youtu.be/abcdef1'), null);
});

test('previewFromOembed maps title + thumbnail + a by-line description; null without usable fields', () => {
  const p = previewFromOembed({
    title: 'Lane 8 - Summer 2026 Mixtape', author_name: 'This Never Happened',
    provider_name: 'YouTube', type: 'video', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
  });
  assert.equal(p.title, 'Lane 8 - Summer 2026 Mixtape');
  assert.equal(p.image, 'https://i.ytimg.com/vi/x/hqdefault.jpg');
  assert.equal(p.description, 'A video by This Never Happened on YouTube');
  assert.deepEqual(p.tags, []);
  // Title-only still previews (no image, no by-line without an author); junk yields null.
  const bare = previewFromOembed({ title: 'T', thumbnail_url: 'http://insecure/x.jpg' });
  assert.equal(bare.image, null);
  assert.equal(bare.description, null);
  assert.equal(previewFromOembed({}), null);
  assert.equal(previewFromOembed(null), null);
});

// ---- handler-level: oEmbed first for matched URLs, scrape fallback, suggester signal gating ----

const req = (body) => ({
  method: 'POST',
  headers: { get: (h) => (h === 'Authorization' ? 'Bearer tok' : null) },
  async json() { return body; },
});
const fetchUser = async () => ({ githubId: '42' });
const OEMBED_JSON = { title: 'Video title', author_name: 'Chan', provider_name: 'YouTube', type: 'video', thumbnail_url: 'https://i.ytimg.com/vi/x/hq.jpg' };

test('handler: a matched URL previews via oEmbed and the watch page itself is never fetched', async () => {
  const fetched = [];
  const r = await handleOgPreview(req({ url: OWNER_URL }), {}, {
    fetchUser,
    fetchImpl: async (url) => {
      fetched.push(url);
      assert.ok(url.startsWith('https://www.youtube.com/oembed?'), 'only the oEmbed endpoint is fetched');
      return { ok: true, async json() { return OEMBED_JSON; } };
    },
    suggest: async (env, { title }) => (title === 'Video title' ? 'ai' : null),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, 'Video title');
  assert.equal(r.body.image, 'https://i.ytimg.com/vi/x/hq.jpg');
  assert.equal(r.body.description, 'A video by Chan on YouTube');
  assert.equal(r.body.suggestedCategory, 'ai'); // the suggester runs off the oEmbed title
  assert.equal(fetched.length, 1);
});

test('handler: a failed oEmbed falls through to the generic scrape', async () => {
  const r = await handleOgPreview(req({ url: 'https://youtu.be/N_GfH09iP9c' }), {}, {
    fetchUser,
    fetchImpl: async (url) => {
      if (url.includes('/oembed')) return { ok: false, status: 403 };
      return {
        ok: true,
        headers: { get: () => 'text/html' },
        async text() { return '<meta property="og:title" content="Scraped title">'; },
      };
    },
    suggest: async () => null,
  });
  assert.equal(r.body.title, 'Scraped title');
});

test('handler: ZERO scraped signal skips the suggester (no hallucinated category)', async () => {
  let suggested = false;
  const r = await handleOgPreview(req({ url: 'https://example.com/empty' }), {}, {
    fetchUser,
    fetchImpl: async () => ({ ok: true, headers: { get: () => 'text/html' }, async text() { return '<html><body>nothing</body></html>'; } }),
    suggest: async () => { suggested = true; return 'web3'; },
  });
  assert.equal(r.body.title, null);
  assert.equal(r.body.suggestedCategory, null);
  assert.equal(suggested, false, 'the suggester never runs without title/description/tags');
});

// The maxres thumbnail upgrade. YouTube's oEmbed only names hqdefault (480x360), which strict scrapers
// reject as too small; maxresdefault (1280x720) exists for most but not all videos, so this helper only ever
// proposes a candidate and the caller confirms it.
test('maxresThumbCandidate proposes the 1280x720 variant for a YouTube thumbnail', () => {
  assert.equal(
    maxresThumbCandidate('https://i.ytimg.com/vi/MsFYd8EdAXw/hqdefault.jpg'),
    'https://i.ytimg.com/vi/MsFYd8EdAXw/maxresdefault.jpg',
  );
  // every smaller variant upgrades, and the alternate hosts normalize onto i.ytimg.com
  assert.equal(maxresThumbCandidate('https://i.ytimg.com/vi/abc-1_2/sddefault.jpg'), 'https://i.ytimg.com/vi/abc-1_2/maxresdefault.jpg');
  assert.equal(maxresThumbCandidate('https://img.youtube.com/vi/abc/mqdefault.jpg'), 'https://i.ytimg.com/vi/abc/maxresdefault.jpg');
});

test('maxresThumbCandidate returns null for anything that is not an upgradable YouTube thumbnail', () => {
  assert.equal(maxresThumbCandidate('https://i.ytimg.com/vi/abc/maxresdefault.jpg'), null); // already there
  assert.equal(maxresThumbCandidate('https://example.com/vi/abc/hqdefault.jpg'), null);     // not YouTube
  assert.equal(maxresThumbCandidate('http://i.ytimg.com/vi/abc/hqdefault.jpg'), null);      // not https
  assert.equal(maxresThumbCandidate('https://i.ytimg.com/vi_webp/abc/hqdefault.webp'), null); // not the jpg path
  assert.equal(maxresThumbCandidate('https://vimeo.com/thumb.jpg'), null);
  assert.equal(maxresThumbCandidate(''), null);
  assert.equal(maxresThumbCandidate(null), null);
});

// Handler level: the upgrade is only taken when the bigger image is CONFIRMED to exist. A video uploaded
// below 720p has no maxresdefault and YouTube 404s it, so the second test here is the one that matters:
// a failed check must leave the working hqdefault in place rather than shipping a dead image URL.
const HQ_JSON = { ...OEMBED_JSON, thumbnail_url: 'https://i.ytimg.com/vi/vid123/hqdefault.jpg' };

test('handler: an hqdefault thumbnail is upgraded to maxresdefault once a HEAD confirms it exists', async () => {
  const seen = [];
  const r = await handleOgPreview(req({ url: OWNER_URL }), {}, {
    fetchUser,
    fetchImpl: async (url, opts) => {
      seen.push({ url, method: opts?.method || 'GET' });
      if (url.includes('/oembed')) return { ok: true, async json() { return HQ_JSON; } };
      return { ok: true }; // the HEAD against i.ytimg.com
    },
    suggest: async () => null,
  });
  assert.equal(r.body.image, 'https://i.ytimg.com/vi/vid123/maxresdefault.jpg');
  const head = seen.find((s) => s.method === 'HEAD');
  assert.ok(head, 'the larger image is confirmed before it is used');
  assert.equal(head.url, 'https://i.ytimg.com/vi/vid123/maxresdefault.jpg');
});

test('handler: a 404 on maxresdefault keeps the hqdefault thumbnail, never a dead URL', async () => {
  const r = await handleOgPreview(req({ url: OWNER_URL }), {}, {
    fetchUser,
    fetchImpl: async (url) => {
      if (url.includes('/oembed')) return { ok: true, async json() { return HQ_JSON; } };
      return { ok: false, status: 404 }; // this video was uploaded below 720p
    },
    suggest: async () => null,
  });
  assert.equal(r.body.image, 'https://i.ytimg.com/vi/vid123/hqdefault.jpg');
});

test('handler: a thrown HEAD keeps the hqdefault thumbnail too', async () => {
  const r = await handleOgPreview(req({ url: OWNER_URL }), {}, {
    fetchUser,
    fetchImpl: async (url) => {
      if (url.includes('/oembed')) return { ok: true, async json() { return HQ_JSON; } };
      throw new Error('network');
    },
    suggest: async () => null,
  });
  assert.equal(r.body.image, 'https://i.ytimg.com/vi/vid123/hqdefault.jpg');
});
