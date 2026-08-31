#!/usr/bin/env node
// sow-290 browser proof: a JPEG carrying an EXIF ImageDescription marker is decoded and canvas-encoded by the real
// shared intake module. The marker must exist in the input and be absent from the staged WebP bytes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const REQUIRE_BROWSER = process.env.REQUIRE_BROWSER === '1';
const die = (message) => { console.error(`✗ check:image-intake: ${message}`); process.exit(1); };
const skip = (message) => {
  if (REQUIRE_BROWSER) die(`REQUIRE_BROWSER is set: ${message}`);
  console.log(`· check:image-intake skipped: ${message}`);
  process.exit(0);
};

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch { skip('playwright is not installed'); }

const port = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => { const { port: value } = probe.address(); probe.close(() => resolve(value)); });
});
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/') {
    res.writeHead(200, {
      'content-type': 'text/html',
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data:",
    });
    res.end('<!doctype html><title>image intake check</title>');
    return;
  }
  const file = path.join(ROOT, url.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': 'text/javascript' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

let browser;
try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
catch (bundledError) {
  try { browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
  catch { server.close(); skip(`could not launch Chromium: ${bundledError.message.split('\n')[0]}`); }
}

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const result = await page.evaluate(async () => {
    const marker = 'GBTI-GPS-PROOF-41.8781N-87.6298W';
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 40;
    const context = canvas.getContext('2d');
    context.fillStyle = '#137a4b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const original = new Uint8Array(await jpeg.arrayBuffer());
    const text = new TextEncoder().encode(`${marker}\0`);
    const payload = new Uint8Array(6 + 26 + text.length);
    payload.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0); // Exif\0\0
    payload.set([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0], 6); // little-endian TIFF header
    payload.set([1, 0, 0x0e, 1, 2, 0], 14); // one ImageDescription ASCII entry
    new DataView(payload.buffer).setUint32(20, text.length, true);
    new DataView(payload.buffer).setUint32(24, 26, true);
    payload.set([0, 0, 0, 0], 28);
    payload.set(text, 32);
    const app1 = new Uint8Array(payload.length + 4);
    app1.set([0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]);
    app1.set(payload, 4);
    const withExif = new Uint8Array(original.length + app1.length);
    withExif.set(original.subarray(0, 2));
    withExif.set(app1, 2);
    withExif.set(original.subarray(2), 2 + app1.length);
    const contains = (bytes) => new TextDecoder('latin1').decode(bytes).includes(marker);
    const file = new File([withExif], 'phone-photo.jpg', { type: 'image/jpeg' });
    const { processImageFile, blobToBase64, processedImageDataUrl } = await import('/client-ui/src/image-intake.mjs');
    const processed = await processImageFile(file);
    const output = new Uint8Array(await processed.blob.arrayBuffer());
    const previewUrl = processedImageDataUrl(processed.blob, await blobToBase64(processed.blob));
    const preview = new Image();
    const previewLoaded = await new Promise((resolve) => {
      preview.onload = () => resolve(true);
      preview.onerror = () => resolve(false);
      preview.src = previewUrl;
    });
    return {
      inputHasMarker: contains(withExif),
      outputHasMarker: contains(output),
      type: processed.type,
      size: processed.blob.size,
      reencoded: processed.reencoded,
      previewLoaded,
      previewScheme: previewUrl.split(':')[0],
    };
  });
  if (!result.inputHasMarker) die('positive-control EXIF marker is missing from the input');
  if (result.outputHasMarker) die('EXIF marker survived the image processor');
  if (!result.reencoded || result.type !== 'image/webp') die(`expected re-encoded WebP, got ${result.type}`);
  if (result.size > 1_048_576) die(`processed output exceeds 1MB (${result.size} bytes)`);
  if (!result.previewLoaded || result.previewScheme !== 'data') die('processed preview did not load under the production image CSP');
  console.log(`✓ image intake removed EXIF marker and loaded the ${result.size}-byte WebP preview under production CSP`);
} finally {
  await browser.close();
  server.close();
}
