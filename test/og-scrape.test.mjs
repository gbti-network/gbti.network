// SOW-057: the shared OG scraper (workers/lib/og-scrape.mjs). Pure regex scrape; never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrapeOgImage, scrapeOgPreview, absolutize } from '../workers/lib/og-scrape.mjs';

test('scrapeOgImage still prefers og:image and resolves relative/protocol-relative (news parity)', () => {
  assert.equal(scrapeOgImage('<meta property="og:image" content="https://cdn.ex.com/a.jpg">'), 'https://cdn.ex.com/a.jpg');
  assert.equal(scrapeOgImage('<meta property="og:image" content="//cdn.ex.com/b.jpg">'), 'https://cdn.ex.com/b.jpg');
  assert.equal(scrapeOgImage('<meta property="og:image" content="/img/c.jpg">', 'https://ex.com/post/1'), 'https://ex.com/img/c.jpg');
  assert.equal(scrapeOgImage('<meta name="twitter:image" content="https://cdn.ex.com/t.png">'), 'https://cdn.ex.com/t.png');
});

test('absolutize rejects data: and .svg and unusable relative-without-base', () => {
  assert.equal(absolutize('data:image/png;base64,xxxx', 'https://ex.com'), '');
  assert.equal(absolutize('/logo.svg', 'https://ex.com'), '');
  assert.equal(absolutize('relative.jpg', ''), '');
  assert.equal(absolutize('https://ex.com/ok.jpg'), 'https://ex.com/ok.jpg');
});

test('scrapeOgPreview returns image + title + description with fallbacks', () => {
  const html = `
    <head>
      <meta property="og:image" content="https://cdn.ex.com/og.jpg">
      <meta property="og:title" content="The headline">
      <meta property="og:description" content="why it matters">
      <title>doc title</title>
    </head>`;
  assert.deepEqual(scrapeOgPreview(html, 'https://ex.com/a'), {
    image: 'https://cdn.ex.com/og.jpg', title: 'The headline', description: 'why it matters', tags: [],
  });
});

test('scrapeOgPreview falls back to <title> and meta description, and decodes entities', () => {
  const html = `<head><title>Fish &amp; Chips</title><meta name="description" content="Tom&#39;s blog"></head>`;
  const p = scrapeOgPreview(html, 'https://ex.com');
  assert.equal(p.title, 'Fish & Chips');
  assert.equal(p.description, "Tom's blog");
  assert.equal(p.image, ''); // no image present
});

test('scrapeOgPreview never throws on garbage', () => {
  assert.doesNotThrow(() => scrapeOgPreview(null));
  assert.deepEqual(scrapeOgPreview(''), { image: '', title: '', description: '', tags: [] });
});

// SOW-087: the declared keyword/tag hints feed the share category suggestion.
test('scrapeOgPreview collects article:tag + comma-split keywords, deduped and capped', () => {
  const html = `
    <head>
      <meta property="article:tag" content="DevOps">
      <meta property="article:tag" content="Kubernetes">
      <meta property="article:tag" content="devops">
      <meta name="keywords" content="cloud, DevOps , observability,">
      <meta name="news_keywords" content="platform engineering">
    </head>`;
  const p = scrapeOgPreview(html, 'https://ex.com');
  assert.deepEqual(p.tags, ['DevOps', 'Kubernetes', 'cloud', 'observability', 'platform engineering']);
});

test('scrapeOgPreview drops over-long tags and stops at the tag cap', () => {
  const many = Array.from({ length: 20 }, (_, i) => `<meta property="article:tag" content="tag-${i}">`).join('');
  const long = `<meta property="article:tag" content="${'x'.repeat(60)}">`;
  const p = scrapeOgPreview(`<head>${long}${many}</head>`, 'https://ex.com');
  assert.equal(p.tags.length, 12); // MAX_TAGS
  assert.ok(!p.tags.some((t) => t.length > 48));
});
