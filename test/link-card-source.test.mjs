// sow-445 (owner, 2026-10-08): a share's link card ends with the SOURCE's name ("| Quanta Magazine"), the brand when
// the page states one and the domain when not, instead of "| GBTI Network". These follow the name from the page that
// states it, through the preview route and every surface that makes or edits a share, to the card the build writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { siteNameOf, scrapeOgPreview } from '../workers/lib/og-scrape.mjs';
import { previewFromOembed } from '../workers/lib/oembed-providers.mjs';
import { handleOgPreview } from '../workers/signup/membership-og.mjs';
import { shareSchema } from '../client/src/schemas.mjs';
import { buildShareFile, shareSummary } from '../client/src/content-ops.mjs';
import { editInputFor } from '../client-ui/src/share-post-core.mjs';
import { platformLabel } from '../client/src/share-source.mjs';
import { cardSourceFor, newsHostNames, newsCardSource, hostOfUrl } from '../src/lib/link-card.mjs';
import { readNewsSourceList } from '../src/lib/news-source-list.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const meta = (k, v, attr = 'property') => `<meta ${attr}="${k}" content="${v}">`;

test('the page names itself: og:site_name, then application-name, and never the headline', () => {
  assert.equal(siteNameOf(meta('og:site_name', 'Quanta Magazine') + '<title>Why Physicists Think Space</title>'), 'Quanta Magazine');
  assert.equal(siteNameOf(meta('application-name', 'Ars Technica', 'name')), 'Ars Technica');
  assert.equal(siteNameOf(meta('og:site_name', 'Kotaku') + meta('application-name', 'Other', 'name')), 'Kotaku', 'og:site_name first');
  assert.equal(siteNameOf('<title>Why Physicists Think Space</title>' + meta('og:title', 'Headline')), '', 'a card reading "Headline | Headline" is worse than the domain');
  assert.equal(siteNameOf(''), '');
  assert.equal(siteNameOf(meta('og:site_name', 'AT&amp;T Newsroom')), 'AT&T Newsroom', 'entities decoded');
});

test('the name is cut to the brand, and a name worse than the domain is dropped', () => {
  assert.equal(siteNameOf(meta('og:site_name', 'Engadget - Technology News &amp; Expert Reviews')), 'Engadget', 'a strap line is cut');
  assert.equal(siteNameOf(meta('og:site_name', 'CoinDesk: Bitcoin, Ethereum, Crypto News')), 'CoinDesk');
  assert.equal(siteNameOf(meta('og:site_name', 'X (formerly Twitter)')), 'X', 'a bracketed tail goes');
  for (const generic of ['Docs', 'Blog', 'home', 'News']) assert.equal(siteNameOf(meta('og:site_name', generic)), '', `${generic} names a section, not a source`);
  assert.equal(siteNameOf(meta('og:site_name', 'TECHCOMMUNITY.MICROSOFT.COM')), 'techcommunity.microsoft.com', 'an all-capitals domain reads as the domain');
  assert.equal(siteNameOf(meta('og:site_name', 'Unite.AI')), 'Unite.AI', 'a brand that writes itself as a domain is kept as written');
  assert.ok(siteNameOf(meta('og:site_name', 'A Very Long Publication Name That Keeps Going And Going')).length <= 40, 'capped');
});

test('the preview carries the name: scraped from the page, or the oEmbed provider', () => {
  assert.equal(scrapeOgPreview(meta('og:site_name', 'Quanta Magazine') + meta('og:title', 'T'), 'https://www.quantamagazine.org/a').siteName, 'Quanta Magazine');
  assert.equal(scrapeOgPreview(meta('og:title', 'T')).siteName, '');
  assert.equal(previewFromOembed({ title: 'A video', provider_name: 'YouTube', author_name: 'Lane 8' }).siteName, 'YouTube');
  assert.equal(previewFromOembed({ title: 'A video' }).siteName, null);
});

const req = (body) => ({ method: 'POST', headers: { get: (h) => (h === 'Authorization' ? 'Bearer tok' : null) }, async json() { return body; } });
const fetchUser = async () => ({ githubId: '42', githubLogin: 'me' });
const page = (html) => async () => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => html });

test('the preview route returns sourceName, and null when the page names nothing', async () => {
  const deps = { fetchUser, suggest: async () => null, suggestTagsImpl: async () => [] };
  const named = await handleOgPreview(req({ url: 'https://www.quantamagazine.org/a' }), {}, { ...deps, fetchImpl: page(meta('og:site_name', 'Quanta Magazine') + meta('og:title', 'Holography')) });
  assert.equal(named.status, 200);
  assert.equal(named.body.sourceName, 'Quanta Magazine');
  const bare = await handleOgPreview(req({ url: 'https://example.com/a' }), {}, { ...deps, fetchImpl: page(meta('og:title', 'Holography')) });
  assert.equal(bare.body.sourceName, null);
  const failed = await handleOgPreview(req({ url: 'https://example.com/a' }), {}, { ...deps, fetchImpl: async () => ({ ok: false, status: 503, headers: { get: () => 'text/html' }, text: async () => '' }) });
  assert.equal(failed.body.sourceName, null, 'the empty preview names the field too');
});

test('a share keeps the name: the schema parses it, the file carries it, a summary and an edit keep it', () => {
  const base = { id: '20261008-x', author: 'ann', createdAt: '2026-10-08T00:00:00Z' };
  assert.equal(shareSchema.parse({ ...base, sourceName: 'Quanta Magazine' }).sourceName, 'Quanta Magazine', 'a zod object drops keys it does not name');
  assert.equal(shareSchema.safeParse({ ...base, sourceName: 'x'.repeat(81) }).success, false, 'bounded');
  assert.match(read('src/content.config.ts'), /sourceName: z\.string\(\)\.max\(80\)\.optional\(\),/, 'the site schema names it too, or the share page never sees it');
  const built = buildShareFile({ username: 'ann', input: { ...base, visibility: 'public', category: 'space', url: 'https://www.quantamagazine.org/a', sourceName: 'Quanta Magazine' } });
  assert.match(built.markdown, /^sourceName: Quanta Magazine$/m);
  const s = shareSummary('members/ann/shares/20261008-x.md', { ...base, url: 'https://www.quantamagazine.org/a', sourceName: ' Quanta Magazine ' });
  assert.equal(s.sourceName, 'Quanta Magazine');
  assert.equal(shareSummary('p', {}).sourceName, null);
  const share = { ...base, url: 'https://www.quantamagazine.org/a', sourceName: 'Quanta Magazine', visibility: 'public' };
  assert.equal(editInputFor({ share, fields: { title: 'New' } }).sourceName, 'Quanta Magazine', 'an edit keeps it: the edit rebuilds the file and drops what it does not name');
  assert.equal('sourceName' in editInputFor({ share, fields: { removeUrl: true } }), false, 'the name belongs to the link and goes with it');
});

test('the composer and the agent tool save the name the preview reported', () => {
  const c = read('client-ui/src/elements/gbti-share-composer.mjs');
  assert.match(c, /this\._sourceName = og\?\.sourceName \? String\(og\.sourceName\)\.slice\(0, 80\) : null;/);
  assert.match(c, /if \(url && this\._sourceName\) input\.sourceName = this\._sourceName;/);
  assert.match(c, /this\._sourceName = item\.sourceName \|\| null;/, 'an edit shows the stored one');
  // every place the composer forgets the creator forgets the name too, or a later link would be posted under the
  // previous link's publication
  assert.equal((c.match(/this\._creator = null;/g) || []).length, (c.match(/this\._creator = null;[^\n]*this\._sourceName = null;/g) || []).length);
  assert.match(read('client/src/mcp-tools.mjs'), /sourceName: typeof og\?\.sourceName === 'string' \? og\.sourceName\.slice\(0, 80\) : undefined,/);
});

test('the card names, in order: the saved name, the news source pool, the platform, the domain', () => {
  const hosts = newsHostNames([{ id: 'ars', name: 'Ars Technica', description: 'arstechnica.com' }, { id: 'bc', name: 'BleepingComputer', description: 'www.bleepingcomputer.com' }, { id: 'x', name: 'Odd', description: 'not a domain' }]);
  assert.equal(hosts.get('bleepingcomputer.com'), 'BleepingComputer', 'www. is dropped');
  assert.equal(hosts.size, 2, 'a description that is not a domain is skipped');
  assert.equal(cardSourceFor({ url: 'https://www.quantamagazine.org/a', sourceName: 'Quanta Magazine' }, hosts), 'Quanta Magazine');
  assert.equal(cardSourceFor({ url: 'https://arstechnica.com/a', sourceName: 'Ars' }, hosts), 'Ars', 'the saved name first');
  assert.equal(cardSourceFor({ url: 'https://arstechnica.com/a' }, hosts), 'Ars Technica');
  assert.equal(cardSourceFor({ url: 'https://www.youtube.com/watch?v=x' }, hosts), 'YouTube');
  assert.equal(cardSourceFor({ url: 'https://www.quantamagazine.org/a' }, hosts), 'quantamagazine.org');
  assert.equal(cardSourceFor({ url: 'https://www.quantamagazine.org/a', sourceName: '   ' }, hosts), 'quantamagazine.org', 'a blank name is no name');
  assert.equal(cardSourceFor({}, hosts), '', 'no link: the card keeps the site name');
  assert.equal(cardSourceFor({ url: 'javascript:alert(1)' }, hosts), '');
  assert.equal(hostOfUrl('https://m.youtube.com/x'), 'youtube.com');
});

test('the platform label comes from the fixed hosts only', () => {
  assert.equal(platformLabel('https://x.com/a/status/1'), 'X');
  assert.equal(platformLabel('https://twitter.com/a'), 'X');
  assert.equal(platformLabel('https://youtu.be/x'), 'YouTube');
  assert.equal(platformLabel('https://github.com/a/b'), 'GitHub');
  assert.equal(platformLabel('https://someone.substack.com/p/x'), 'Substack');
  assert.equal(platformLabel('https://mastodon.social/@a/1234'), '', 'Mastodon has no fixed host');
  assert.equal(platformLabel('https://example.com/'), '');
});

test('the real news source pool gives every enabled source a host', () => {
  const list = readNewsSourceList();
  const hosts = newsHostNames(list);
  const enabled = list.filter((s) => s.enabled !== false);
  assert.ok(enabled.length > 50, `the pool was read (${enabled.length})`);
  const missing = enabled.filter((s) => ![...hosts.values()].includes(s.name));
  assert.deepEqual(missing.map((s) => s.id), [], 'every enabled source states its domain, so a share of its site is named');
});

test('a news card names the publication by source id, else the story link\'s domain, never the raw id', () => {
  const sources = [{ id: 'ars-technica', name: 'Ars Technica' }];
  assert.equal(newsCardSource({ source: 'ars-technica', link: 'https://arstechnica.com/x' }, sources), 'Ars Technica');
  assert.equal(newsCardSource({ source: 'object-object', link: 'https://www.theverge.com/x' }, sources), 'theverge.com');
  assert.equal(newsCardSource({ source: 'object-object' }, sources), '');
  assert.equal(newsCardSource({ source: 'ars-technica' }, { sources }), 'Ars Technica', 'the artifact shape { sources } is read too');
});

test('the share page passes the card source, and only og:title takes it', () => {
  const p = read('src/pages/shares/[author]/[id].astro');
  assert.match(p, /const cardSource = cardSourceFor\(\{ url: d\.url, sourceName: d\.sourceName \}, newsHostNames\(readNewsSourceList\(\)\)\) \|\| undefined;/);
  assert.match(p, /<BaseLayout [^>]*cardSource=\{cardSource\}/);
});
