// SOW-035 Phase 3: the Playwright EXTENSION-UI smoke. Loads the unpacked MV3 extension in a persistent context,
// optionally seeds a signed-in state into the background worker's chrome.storage, and drives the real UI:
//   - the new-tab page renders (greeting + activity feed), and shows the signed-in identity when seeded;
//   - the content script stamps gbti.network (data-gbti-extension), and the signed-in header chip appears.
//
// It mutates NOTHING on production: it only reads the live site + seeds a token into a THROWAWAY browser profile
// (a temp user-data dir, deleted at the end). The signed-in assertions SKIP without a real token (E2E_TOKEN /
// GH_BOT_TOKEN). If headed Chromium cannot launch here (no display), it SKIPS cleanly (exit 0) so it is safe to
// run anywhere; in CI it runs under xvfb. Install the browser once with: npx playwright install chromium.
//
// Run: xvfb-run -a node --env-file=.env tests/e2e/ext-ui.mjs    (or plain node if a display is present)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const EXT_DIR = path.join(ROOT, 'extension');
const SITE = process.env.E2E_SITE || 'https://gbti.network';
const TOKEN = process.env.E2E_TOKEN || process.env.GITHUB_BOT_TOKEN || '';
const HAVE_TOKEN = !!TOKEN && !/^REPLACE/i.test(TOKEN) && TOKEN.length >= 40;

const results = [];
const check = (name, ok, detail = '') => { results.push({ state: ok ? 'pass' : 'fail' }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); return ok; };
const skip = (name, reason) => { results.push({ state: 'skip' }); console.log(`SKIP  ${name}  (${reason})`); };

async function main() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.log('SKIP  extension UI (playwright not installed: npx playwright install chromium)'); process.exit(0); }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-e2e-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // MV3 extensions require a head; DISPLAY / xvfb provides it
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--no-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (e) {
    console.log(`SKIP  extension UI (could not launch headed Chromium: ${e?.message ?? e}). Run under xvfb-run.`);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    process.exit(0);
  }

  try {
    // The MV3 background service worker carries the extension id in its URL.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
    const extId = sw ? new URL(sw.url()).host : null;
    check('extension loaded (background service worker)', !!extId, extId || 'no service worker');
    if (!extId || !sw) throw new Error('no extension id / service worker');

    if (HAVE_TOKEN) {
      await sw.evaluate((tok) => chrome.storage.local.set({ gbti: { githubToken: tok, identity: { login: 'gbtilabs', githubId: '125175036', username: 'gbtilabs' } } }), TOKEN);
    }

    // --- the new tab page ---
    const nt = await context.newPage();
    if (process.env.E2E_DEBUG) {
      nt.on('pageerror', (e) => console.log('  [newtab pageerror]', e.message));
      nt.on('console', (m) => { if (m.type() === 'error') console.log('  [newtab console.error]', m.text()); });
    }
    await nt.goto(`chrome-extension://${extId}/newtab.html`, { waitUntil: 'domcontentloaded' });
    await nt.waitForSelector('[data-greeting]', { timeout: 10000 });
    const greeting = (await nt.textContent('[data-greeting]')) || '';
    check('new tab renders (greeting)', /morning|afternoon|evening/i.test(greeting), greeting.trim());
    // Wait for ACTUAL rows (not the initial "Loading..." .muted, which would satisfy an OR-selector prematurely).
    await nt.waitForSelector('.feed a.row', { timeout: 25000 }).catch(() => {});
    const rows = await nt.locator('.feed a.row').count();
    check('new tab activity feed loads from the live site', rows > 0, `${rows} rows`);
    if (HAVE_TOKEN) {
      await nt.waitForFunction(() => /@gbtilabs/i.test(document.querySelector('[data-acct]')?.textContent || ''), { timeout: 12000 }).catch(() => {});
      const acct = (await nt.textContent('[data-acct]')) || '';
      check('new tab shows the signed-in identity', /@gbtilabs/i.test(acct), acct.trim());
    } else skip('new tab shows the signed-in identity', 'no real token');

    // --- the content-script bridge on gbti.network ---
    const site = await context.newPage();
    if (process.env.E2E_DEBUG) {
      site.on('pageerror', (e) => console.log('  [site pageerror]', e.message, '\n  stack:', (e.stack || '').split('\n').slice(0, 6).join('\n    ')));
      site.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [site ${m.type()}]`, m.text()); });
    }
    await site.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
    await site.waitForFunction(() => !!document.documentElement.dataset.gbtiExtension, { timeout: 20000 }).catch(() => {});
    const stamp = await site.evaluate(() => document.documentElement.dataset.gbtiExtension || null);
    check('content script stamps gbti.network (extension detected)', !!stamp, stamp ? `version ${stamp}` : 'not stamped');
    if (HAVE_TOKEN) {
      await site.waitForFunction(() => { const m = document.querySelector('[data-head-me]'); return !!m && !m.hidden; }, { timeout: 15000 }).catch(() => {});
      const chip = await site.evaluate(() => { const m = document.querySelector('[data-head-me]'); return !!m && !m.hidden; });
      const chipText = await site.evaluate(() => document.querySelector('[data-head-me-name]')?.textContent || '');
      check('site header shows the signed-in chip (SOW-030 bridge)', chip && /@gbtilabs/i.test(chipText), chipText);
    } else skip('site header shows the signed-in chip (SOW-030 bridge)', 'no real token');
  } catch (e) {
    check('extension UI smoke ran', false, e?.message ?? String(e));
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const pass = results.filter((r) => r.state === 'pass').length;
  const fail = results.filter((r) => r.state === 'fail').length;
  const skipped = results.filter((r) => r.state === 'skip').length;
  console.log(`\n=== ${pass} passed, ${fail} failed, ${skipped} skipped (of ${results.length}) ===`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('E2E ext-ui crashed:', e?.message ?? e); process.exit(1); });
