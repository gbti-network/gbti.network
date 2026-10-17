// sow-462 (the sow-461 decision): old addresses that answered 404 after the launch while Google still sent people to
// them, or a live article still linked them. public/_redirects is GENERATED and rewritten wholesale by
// scripts/gen-redirects.mjs, so each pair must be in the generator's EXTRA list as well as in the committed file,
// or the next regeneration drops it (which is how the hand-added /youtube-invite/ rule was nearly lost).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const PAIRS = [
  ['/hire/', '/contact/'],
  ['/hire/wordpress-developers/', '/contact/'],
  ['/hire/minecraft-developers/', '/contact/'],
  ['/hire/mcp-server-developers/', '/contact/'],
  ['/ai/15-nano-bana-prompts-for-generating-linkedin-headshots/', '/articles/15-nano-banana-prompts-for-generating-linkedin-headshots/'],
  ['/co-op/terms-of-operation/', '/revenue-model/'],
  ['/co-op/guides/gbti-network-product-submission-process-guide/', '/submit-content/'],
  ['/co-op/submit/', '/submit-content/'],
  ['/minecraft/how-to-edit-flan-text-messages-in-minecraft', '/articles/how-to-edit-flan-text-messages-in-minecraft/'],
  ['/frameworks/what-is-markdown/', '/articles/what-is-markdown/'],
  ['/sitemap_index.xml', '/sitemap-index.xml'],
  ['/youtube-invite/', '/articles/100-wordpress-youtube-channels-to-subscribe-to-in-2026/'],
];

test('the redirect generator emits every one of these pairs', () => {
  const gen = read('scripts/gen-redirects.mjs');
  for (const [from, to] of PAIRS) {
    assert.ok(gen.includes(`['${from}', '${to}']`), `gen-redirects lost ${from}; the next regeneration would turn it back into a 404`);
  }
});

test('the committed _redirects carries every pair, each once, ahead of the /blog/ splat', () => {
  const lines = read('public/_redirects').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.ok(lines.length > 50, `only ${lines.length} rules parsed; the assertions below would pass vacuously`);
  const splat = lines.findIndex((l) => l.startsWith('/blog/* '));
  assert.ok(splat > 0, 'the /blog/* splat rule was not found, so the ordering check below proves nothing');
  for (const [from, to] of PAIRS) {
    const rule = `${from} ${to} 301`;
    const at = lines.indexOf(rule);
    assert.ok(at >= 0, `public/_redirects is missing "${rule}"`);
    assert.ok(at < splat, `"${rule}" must come before the /blog/* splat`);
    assert.equal(lines.filter((l) => l.split(/\s+/)[0] === from).length, 1, `${from} has more than one rule; Cloudflare uses the first`);
  }
});
