// The manifest `description` is the extension's one-line summary in the Chrome Web Store, shown under its name and
// in search results. It ships inside the package, so it can only be corrected by an upload, and nothing read it:
// it kept saying the extension "edits your own gbti.network pages in place" for four releases after the extension
// stopped editing pages and authoring articles, projects and prompts, which moved to the WorkBench on gbti.network
// (found in the 0.6.0 release audit, 2026-10-07). It still posts shares, so a summary may say so. The repo's no-dash test does not read
// manifest.json either. This test is the only check on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../extension/manifest.json', import.meta.url)), 'utf8'));
const summary = manifest.description;

test('the store summary exists and fits the Chrome Web Store limit of 132 characters', () => {
  assert.equal(typeof summary, 'string');
  assert.ok(summary.trim().length > 20, 'the store summary is missing or empty');
  assert.ok([...summary].length <= 132, `the store summary is ${[...summary].length} characters; the store allows 132`);
});

test('the store summary follows the house copy rules', () => {
  assert.ok(!/[–—]/.test(summary), 'no em or en dash in the store summary');
  assert.ok(!/\s-\s/.test(summary), 'no spaced hyphen used as a dash in the store summary');
  // Straight or curly apostrophe. Possessives ("the network's") are allowed; the 's contractions are listed by word.
  assert.ok(!/\b\w+['\u2019](t|re|ve|ll|d|m)\b/i.test(summary), 'no contraction in the store summary');
  assert.ok(!/\b(it|that|there|what|here|who)['\u2019]s\b/i.test(summary), 'no contraction in the store summary');
});

test('the store summary does not claim the extension edits pages or publishes', () => {
  // The extension is a reader: articles, projects and prompts are written in the WorkBench on gbti.network.
  for (const claim of [/in place/i, /\bedit[^.]*\bpages?\b/i, /\bpublish/i]) {
    assert.ok(!claim.test(summary), `the store summary claims authoring the extension does not do (${claim}): "${summary}"`);
  }
});
