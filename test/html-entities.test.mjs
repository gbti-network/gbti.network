// sow-277: scraped link titles and descriptions are decoded ONCE, at intake, by one shared decoder. A share used to
// be stored reading "SQL Injection &#8211; Ali" and the extension reader showed the code, because the scraper
// decoded only a few named entities (and decoded &amp; first, so "&amp;lt;" came out as "<").
//
// Deliberately NO census of the stored shares here: it would turn main red the day anyone publishes a share whose
// text contains an entity, which is a content event, not a code regression (the sow-233 class). The two stored
// shares that carried one were cleaned in the same commit that fixed the scraper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtmlEntities } from '../membership/html-entities.mjs';
import { scrapeOgPreview } from '../workers/lib/og-scrape.mjs';
import { decodeEntities } from '../src/lib/home-feed.mjs';
import { esc } from '../client-ui/src/base.mjs';

test('decodeHtmlEntities: numeric, hex, named, a bare ampersand, and invalid code points left as written', () => {
  assert.equal(decodeHtmlEntities('SQL Injection &#8211; Ali'), 'SQL Injection – Ali');
  assert.equal(decodeHtmlEntities('We&#8217;re here'), 'We’re here');
  assert.equal(decodeHtmlEntities('A &#x2014; B &#X2014; C'), 'A — B — C');
  assert.equal(decodeHtmlEntities('Q&amp;A &quot;two&quot; it&apos;s &lt;b&gt; wait&hellip; &ndash; &mdash; &lsquo;x&rsquo; &ldquo;y&rdquo;'),
    'Q&A "two" it\'s <b> wait… – — ‘x’ “y”');
  assert.equal(decodeHtmlEntities('&#39;quoted&#039;'), "'quoted'");
  assert.equal(decodeHtmlEntities('Tom & Jerry, R&D, a&b'), 'Tom & Jerry, R&D, a&b', 'a bare ampersand survives');
  assert.equal(decodeHtmlEntities('&unknown; &#; &#xZZ;'), '&unknown; &#; &#xZZ;', 'not an entity we know: untouched');
  for (const bad of ['&#99999999;', '&#0;', '&#xD800;', '&#x110000;']) {
    assert.equal(decodeHtmlEntities(`x ${bad} y`), `x ${bad} y`, `${bad} is left as written, never thrown`);
  }
  assert.equal(decodeHtmlEntities(undefined), '');
  assert.equal(decodeHtmlEntities(null), '');
});

test('one level only: an encoded entity decodes to the entity TEXT, not to the character', () => {
  assert.equal(decodeHtmlEntities('&amp;#8211;'), '&#8211;');
  assert.equal(decodeHtmlEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;', 'the old scraper turned this into <script>');
});

test('decode then escape renders the intended character, and markup still escapes (the composition, not just the helper)', () => {
  assert.equal(esc(decodeHtmlEntities('SQL Injection &#8211; Ali')), 'SQL Injection – Ali');
  assert.equal(esc(decodeHtmlEntities('Q&amp;A')), 'Q&amp;A', 'a real ampersand is escaped exactly once');
  assert.equal(esc(decodeHtmlEntities('&lt;script&gt;alert(1)&lt;/script&gt;')), '&lt;script&gt;alert(1)&lt;/script&gt;');
  // Without the decode, the same value renders as the literal code: the defect.
  assert.equal(esc('SQL Injection &#8211; Ali'), 'SQL Injection &amp;#8211; Ali');
});

test('the scraper returns decoded title and description, so the composer and the MCP tools store clean text', () => {
  const html = '<head><meta property="og:title" content="WordPress Down &#8211; How I Traced It"><meta property="og:description" content="We&#8217;re responding &amp; fixing it"></head>';
  const p = scrapeOgPreview(html, 'https://example.com/post');
  assert.equal(p.title, 'WordPress Down – How I Traced It');
  assert.equal(p.description, 'We’re responding & fixing it');
  // A page whose title literally shows "<b>" encodes it once in the attribute; the scraper decodes exactly once.
  assert.equal(scrapeOgPreview('<meta property="og:title" content="Use &amp;lt;b&amp;gt; tags">', 'https://example.com/').title, 'Use &lt;b&gt; tags');
  // The composer cuts the title at 80 characters. Decoding first means the cut counts characters, not code
  // fragments, so a title of entities is not shortened early or cut through the middle of one.
  const long = `${'&#8211;'.repeat(40)}`;
  const decoded = scrapeOgPreview(`<meta property="og:title" content="${long}">`, 'https://example.com/').title;
  assert.equal(decoded.length, 40);
  assert.equal(String(decoded).slice(0, 80), '–'.repeat(40));
});

test("the site's decodeEntities is the shared decoder, including its refusal to throw", () => {
  assert.equal(decodeEntities('A &#8211; B'), 'A – B');
  assert.equal(decodeEntities('x &#99999999; y'), 'x &#99999999; y');
});
