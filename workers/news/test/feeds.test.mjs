import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, cleanText, toEpochSeconds } from '../src/feeds.mjs';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example</title>
  <item>
    <title>First &amp; Best</title>
    <link>https://ex.com/1</link>
    <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
    <pubDate>Mon, 15 Jun 2026 12:00:00 GMT</pubDate>
    <guid>https://ex.com/1</guid>
  </item>
  <item>
    <title>Second</title>
    <link>https://ex.com/2</link>
    <guid isPermaLink="false">guid-2</guid>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Example</title>
  <entry>
    <title>Atom Post</title>
    <link href="https://ex.com/a1" rel="alternate"/>
    <id>tag:ex.com,2026:a1</id>
    <summary>Some &lt;em&gt;summary&lt;/em&gt;</summary>
    <published>2026-06-14T10:00:00Z</published>
  </entry>
</feed>`;

const SINGLE_ITEM_RSS = `<rss version="2.0"><channel><item>
  <title>Only one</title><link>https://ex.com/only</link>
</item></channel></rss>`;

test('parseFeed handles RSS 2.0', () => {
  const items = parseFeed(RSS, 'ex');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    guid: 'https://ex.com/1',
    source: 'ex',
    title: 'First & Best',
    link: 'https://ex.com/1',
    summary: 'Hello world',
    publishedAt: toEpochSeconds('Mon, 15 Jun 2026 12:00:00 GMT'),
  });
  // guid element with attributes still resolves to its text node
  assert.equal(items[1].guid, 'guid-2');
});

test('parseFeed handles Atom and picks the alternate link href', () => {
  const items = parseFeed(ATOM, 'atom');
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://ex.com/a1');
  assert.equal(items[0].guid, 'tag:ex.com,2026:a1');
  assert.equal(items[0].summary, 'Some summary');
  assert.ok(items[0].publishedAt > 0);
});

test('parseFeed coerces a single <item> into an array', () => {
  const items = parseFeed(SINGLE_ITEM_RSS, 's');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Only one');
  // no guid in feed -> falls back to the link
  assert.equal(items[0].guid, 'https://ex.com/only');
});

test('parseFeed returns [] on garbage instead of throwing', () => {
  assert.deepEqual(parseFeed('not xml at all <<<', 'x'), []);
  assert.deepEqual(parseFeed('', 'x'), []);
});

test('cleanText strips tags, decodes entities, collapses whitespace', () => {
  assert.equal(cleanText('<p>A &amp; B   &lt;3</p>\n\nC'), 'A & B <3 C');
  assert.equal(cleanText('x'.repeat(600)).length, 500);
});

test('toEpochSeconds parses RFC-822 and RFC-3339, null on junk', () => {
  assert.equal(typeof toEpochSeconds('2026-06-14T10:00:00Z'), 'number');
  assert.equal(typeof toEpochSeconds('Mon, 15 Jun 2026 12:00:00 GMT'), 'number');
  assert.equal(toEpochSeconds('not a date'), null);
  assert.equal(toEpochSeconds(''), null);
});
