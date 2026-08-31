#!/usr/bin/env node
// Browser regression for the DOM operations behind list Tab/Shift+Tab and the
// selection toolbar's current heading indicator.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const port = await new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<main id="host"></main>'); return; }
  const file = path.join(ROOT, url.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': 'text/javascript' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
const result = await page.evaluate(async () => {
  const { indentListSelection, readListDom } = await import('/client-ui/src/block-commit.mjs');
  const { createSelectionToolbar } = await import('/client-ui/src/selection-toolbar.mjs');
  const host = document.querySelector('#host');
  const list = document.createElement('ol');
  list.contentEditable = 'true';
  list.innerHTML = '<li>parent</li><li>child</li><li>sibling</li>';
  host.appendChild(list);
  const selection = document.getSelection();
  selection.collapse(list.children[1].firstChild, 5);
  const indented = indentListSelection(list, selection);
  const nested = readListDom(list);
  const caretStayed = selection.anchorNode?.parentElement?.closest('li')?.textContent === 'child';
  const outdented = indentListSelection(list, selection, { outdent: true });
  const flat = readListDom(list);

  const heading = document.createElement('h3');
  heading.contentEditable = 'true'; heading.textContent = 'Current section'; host.appendChild(heading);
  const toolbar = createSelectionToolbar({
    root: document, host: () => host,
    editableOf: (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest('[contenteditable="true"]'),
    onCommit() {}, onRetype() {},
  });
  const range = document.createRange(); range.selectNodeContents(heading);
  selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const active = host.querySelector('[data-w="h3"]')?.classList.contains('is-current');
  const pressed = host.querySelector('[data-w="h3"]')?.getAttribute('aria-pressed');
  toolbar.destroy();
  return { indented, nested, caretStayed, outdented, flat, active, pressed };
});
await browser.close(); server.close();

const expectedNested = JSON.stringify({ kind: 'list', items: ['parent', 'child', 'sibling'], depths: [0, 1, 0] });
const expectedFlat = JSON.stringify({ kind: 'list', items: ['parent', 'child', 'sibling'], depths: [0, 0, 0] });
if (!result.indented || !result.outdented || !result.caretStayed
  || JSON.stringify(result.nested) !== expectedNested || JSON.stringify(result.flat) !== expectedFlat
  || !result.active || result.pressed !== 'true') {
  console.error('✗ editor list/heading browser check failed', result); process.exit(1);
}
console.log('✓ list Tab/Shift+Tab preserves caret and H3 reports its active level in Chromium');
