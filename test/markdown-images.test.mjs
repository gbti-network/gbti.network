// Markdown image rendering (client/src/markdown.mjs) + the reader's repo-relative src resolution
// (client-ui/src/assets.mjs resolveMarkdownAssets). Pure, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { resolveMarkdownAssets } from '../client-ui/src/assets.mjs';

test('renderMarkdown renders images (empty alt, absolute + relative srcs) and keeps links working', () => {
  const html = renderMarkdown([
    '![](./images/luna-city-1.webp)',
    '![A caption](https://cdn.example.com/x.png)',
    '![site](/media/anim.webp)',
    '[a link](https://example.com/page)',
  ].join('\n\n'));
  assert.ok(html.includes('<img src="./images/luna-city-1.webp" alt="" loading="lazy">'));
  assert.ok(html.includes('<img src="https://cdn.example.com/x.png" alt="A caption" loading="lazy">'));
  assert.ok(html.includes('<img src="/media/anim.webp" alt="site" loading="lazy">'));
  assert.ok(html.includes('<a href="https://example.com/page"'));
  assert.ok(!html.includes('![')); // nothing renders as literal markdown
});

test('renderMarkdown never emits an img from a javascript: or data: src', () => {
  const html = renderMarkdown('![x](javascript:alert(1))\n\n![y](data:text/html;base64,AAAA)');
  assert.ok(!html.includes('<img'));
});

test('resolveMarkdownAssets rewrites ./ srcs against the item folder and leaves the rest alone', () => {
  const md = '![](./images/luna-city-1.webp)\n![abs](https://x.example/a.png)\n![site](/media/b.webp)';
  const out = resolveMarkdownAssets(md, 'members/atwellpub/posts/have-spacesuit-will-travel/index.md');
  assert.ok(out.includes('![](https://cdn.jsdelivr.net/gh/gbti-network/gbti.network@main/members/atwellpub/posts/have-spacesuit-will-travel/images/luna-city-1.webp)'));
  assert.ok(out.includes('![abs](https://x.example/a.png)'));
  assert.ok(out.includes('![site](/media/b.webp)'));
  assert.equal(resolveMarkdownAssets(md, null), md); // no path -> untouched
});

test('the two compose: relative markdown resolves then renders as a CDN img', () => {
  const md = resolveMarkdownAssets('![](./images/pewee-decent.webp)', 'members/atwellpub/posts/have-spacesuit-will-travel/index.md');
  const html = renderMarkdown(md);
  assert.ok(html.includes('<img src="https://cdn.jsdelivr.net/gh/gbti-network/gbti.network@main/members/atwellpub/posts/have-spacesuit-will-travel/images/pewee-decent.webp" alt="" loading="lazy">'));
});
