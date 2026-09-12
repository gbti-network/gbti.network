// sow-225: the WorkBench quick actions on the website page, the account page's New links, the curator-only MCP
// tile and guide, and the MCP server riding inside the extension package. Source-level guards over the page
// files plus the packager driven against a temp root; no network, no build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageExtension, readZipEntries } from '../extension/package.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the account page New rows open a blank editor (#new=), not the list tab', () => {
  const src = read('src/pages/account.astro');
  // the rows are an object list (href: '...'), not markup
  for (const t of ['post', 'project', 'prompt']) assert.ok(src.includes(`href: '/workbench/#new=${t}'`), `#new=${t}`);
  for (const t of ['post', 'project', 'prompt']) assert.ok(!src.includes(`href: '/workbench/#tab=${t}'`), `no list-tab link for ${t}`);
  for (const t of ['prs', 'saved', 'subs']) assert.ok(src.includes(`href: '/workbench/#tab=${t}'`), `#tab=${t} kept`);
});

test('the WorkBench page carries three New buttons, the share bar, the modal and the MCP tile', () => {
  const src = read('src/pages/workbench.astro');
  for (const t of ['post', 'prompt', 'project']) assert.match(src, new RegExp(`href="/workbench/#new=${t}"`));
  assert.ok(src.includes('data-wb-new'), 'the New row');
  assert.ok(src.includes('class="home-share-bar wb-share" data-wb-share hidden'), 'the share bar, hidden by default');
  assert.ok(src.includes('<HomeShareModal />'), 'the shared share modal');
  assert.ok(src.includes('href="/workbench/mcp/" data-wb-mcp hidden'), 'the MCP tile, hidden by default');
  assert.ok(!src.includes('hsb-wb'), 'no WorkBench link inside the bar on the WorkBench itself');
});

// sow-323: both gates were an EXACT-STRING test for the creator tier, which was right while that tier was the
// publishing plan and became wrong on 2026-09-12 when the owner collapsed the two paid plans into one. They now
// admit any paid member through meetsTier, which is also the fail-closed helper: it returns false for an absent
// or unresolvable tier, so a down status oracle still hides the surface rather than revealing it.
test('the tile and the share bar admit any paid member, through the fail-closed tier test', () => {
  const src = read('src/pages/workbench.astro');
  assert.match(src, /meetsTier\(p\.paidTier, TIER\.member\)/);
  assert.doesNotMatch(src, /paidTier === 'creator'/, 'the retired exact-string gate must not come back');
  assert.match(src, /mcp\.hidden = !isPaid/);
  assert.match(src, /share\.hidden = !isPaid/);
  // the New buttons are for every signed-in member: revealed unconditionally once the session resolves
  assert.match(src, /quick\.hidden = false/);
});

test('the guide page is noindex, gated on a PAID membership, and lists tools from the server definitions', () => {
  const src = read('src/pages/workbench/mcp/index.astro');
  assert.match(src, /noindex=\{true\}/);
  assert.match(src, /meetsTier\(s\.paidTier, TIER\.member\)/);
  assert.doesNotMatch(src, /paidTier === 'creator'/, 'the MCP server is part of the one paid plan now');
  assert.ok(src.includes('mcpToolNames()'), 'tools come from the module that reads client/src/mcp-tools.mjs');
  assert.ok(src.includes('data-mcp-gate'), 'the line shown to a reader without a paid membership');
});

test('mcp-guide reads the real tool names from the server definitions and groups them all', async () => {
  const mod = await import('../src/lib/mcp-guide.ts').catch(() => null);
  if (!mod) { // ts is not importable under plain node; assert by regex the same way the module does
    const src = read('client/src/mcp-tools.mjs');
    const names = [...src.matchAll(/^\s*name: '([a-z_]+)',/gm)].map((m) => m[1]);
    assert.ok(names.includes('login') && names.includes('publish_content') && names.includes('whoami'), 'the regex finds the server tools');
    assert.ok(names.length >= 20, `found ${names.length} tools`);
    return;
  }
  const names = mod.mcpToolNames();
  assert.ok(names.length >= 20);
  const grouped = mod.mcpToolGroups(names).flatMap((g) => g.tools);
  assert.deepEqual([...grouped].sort(), [...names].sort(), 'every tool lands in exactly one group');
});

test('the extension page no longer offers the unpublished npm fallback', () => {
  const src = read('src/pages/extension/index.astro');
  assert.ok(!src.includes('npx gbti-network'), 'the npm package was never published');
  assert.ok(src.includes("from '../../lib/mcp-guide'"), 'the prompt is single-sourced');
});

test('packageExtension ships the MCP server under mcp/ and names it in latest.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-pkg-'));
  const ext = path.join(root, 'extension');
  fs.mkdirSync(path.join(ext, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(ext, 'mcp'), { recursive: true });
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({ version: '9.9.9', name: 'T', background: { service_worker: 'dist/background.js' } }));
  fs.writeFileSync(path.join(ext, 'dist', 'background.js'), 'x');
  fs.writeFileSync(path.join(ext, 'mcp', 'gbti-network-mcp.mjs'), '#!/usr/bin/env node\nconsole.log(1)');
  const out = packageExtension({ root, write: false });
  const names = readZipEntries(out.buf).map((e) => e.name);
  assert.ok(names.includes('mcp/gbti-network-mcp.mjs'), `zip carries the server: ${names.join(', ')}`);
  assert.ok(names.includes('manifest.json') && names.includes('dist/background.js'));
  assert.equal(out.mcp, 'mcp/gbti-network-mcp.mjs', 'latest.json names the server path');
  // and without the built server the packager refuses rather than shipping a zip that lies
  fs.rmSync(path.join(ext, 'mcp'), { recursive: true });
  assert.throws(() => packageExtension({ root, write: false }), /extension not built/);
});
