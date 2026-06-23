// Responsive screenshot harness (SOW-035 pattern). Loads the unpacked MV3 extension in a persistent Chromium
// context, seeds a signed-in identity into the background worker's chrome.storage (so the live Worker authenticates
// and the UI renders with REAL data), then screenshots each major surface at every target viewport. Read-only on
// production (only reads the live site; the seeded token lives in a throwaway profile deleted at the end).
//
// Run: node --env-file=.env tests/e2e/responsive-shots.mjs   (needs GITHUB_BOT_TOKEN/E2E_TOKEN + headed Chromium;
// DISPLAY is set here, otherwise wrap with xvfb-run). Output: tests/e2e/shots/<surface>-<w>x<h>-<label>.png
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const EXT_DIR = path.join(ROOT, 'extension');
const SHOTS = path.join(ROOT, 'tests/e2e/shots');
const TOKEN = process.env.E2E_TOKEN || process.env.GITHUB_BOT_TOKEN || '';
const HAVE_TOKEN = !!TOKEN && !/^REPLACE/i.test(TOKEN) && TOKEN.length >= 40;

// The owner's target matrix (phones, tablets, desktops).
const VIEWPORTS = [
  [375, 667, 'iphone-se'], [390, 844, 'iphone-13'], [430, 932, 'iphone-15-max'],
  [360, 740, 'galaxy-s8'], [412, 915, 'pixel-7'], [768, 1024, 'ipad-mini'],
  [1024, 1366, 'ipad-pro'], [1280, 720, 'desktop-720'], [1920, 1080, 'desktop-1080'], [2560, 1440, 'desktop-1440'],
];
// To keep a run quick + reviewable, default to a representative subset; pass --all for the full matrix.
const ALL = process.argv.includes('--all');
const SET = ALL ? VIEWPORTS : VIEWPORTS.filter(([w]) => [360, 375, 768, 1024, 1280, 1920].includes(w));

const log = (m) => console.log(m);

// Without a real token the forced-sign-in gate overlays the app (html[data-unauth] + a .gbti-authwrap splash). For a
// LAYOUT audit we dismiss it so the shell chrome + feed render (identity/name + private data stay empty, but the
// responsive STRUCTURE — topbar, rail, feed cards, popups, reader — is exactly what we are inspecting).
async function dismissGate(page) {
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-unauth');
    document.querySelector('.gbti-authwrap')?.remove();
  }).catch(() => {});
  await page.waitForTimeout(500);
}

async function shoot(page, surface) {
  for (const [w, h, label] of SET) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400); // let CSS reflow + lazy bits settle
    const file = path.join(SHOTS, `${surface}-${w}x${h}-${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    log(`  shot ${path.basename(file)}`);
  }
}

async function main() {
  if (!HAVE_TOKEN) log('WARN no real token; auditing LAYOUT with the gate dismissed (identity + private data empty).');
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { log('SKIP responsive-shots (playwright not installed: npx playwright install chromium)'); process.exit(0); }

  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-shots-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--no-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (e) {
    log(`SKIP responsive-shots (could not launch headed Chromium: ${e?.message ?? e}). Wrap with xvfb-run.`);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    process.exit(0);
  }

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
    const extId = sw ? new URL(sw.url()).host : null;
    if (!extId || !sw) throw new Error('no extension id / service worker');
    log(`extension id ${extId}`);
    await sw.evaluate((tok) => chrome.storage.local.set({ gbti: { githubToken: tok, identity: { login: 'gbtilabs', githubId: '125175036', username: 'gbtilabs' } } }), TOKEN);

    const newtabUrl = `chrome-extension://${extId}/newtab.html`;

    // 1) New tab (greeting + feed river)
    {
      const p = await context.newPage();
      await p.goto(newtabUrl, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('[data-greeting]', { timeout: 12000 }).catch(() => {});
      await dismissGate(p);
      await p.waitForSelector('gbti-card-list [data-card]', { timeout: 15000 }).catch(() => {});
      await shoot(p, 'newtab');
      await p.close();
    }

    // 2) The create popup (open the "+")
    {
      const p = await context.newPage();
      await p.goto(newtabUrl, { waitUntil: 'domcontentloaded' });
      await dismissGate(p);
      await p.waitForSelector('[data-compose]', { timeout: 12000 }).catch(() => {});
      await p.click('[data-compose]').catch(() => {});
      await p.waitForSelector('.create-modal', { timeout: 6000 }).catch(() => {});
      await shoot(p, 'create-popup');
      await p.close();
    }

    // 3) The Share composer (open "+" -> New Share)
    {
      const p = await context.newPage();
      await p.goto(newtabUrl, { waitUntil: 'domcontentloaded' });
      await dismissGate(p);
      await p.waitForSelector('[data-compose]', { timeout: 12000 }).catch(() => {});
      await p.click('[data-compose]').catch(() => {});
      await p.click('.create-modal [data-new="share"]').catch(() => {});
      await p.waitForSelector('.compose-modal gbti-share-composer', { timeout: 6000 }).catch(() => {});
      await shoot(p, 'share-composer');
      await p.close();
    }

    // 4) The in-extension reader (open a prompt from the feed)
    {
      const p = await context.newPage();
      await p.goto(`${newtabUrl}#type=prompt`, { waitUntil: 'domcontentloaded' });
      await dismissGate(p);
      await p.waitForSelector('gbti-card-list [data-card]', { timeout: 15000 }).catch(() => {});
      await p.locator('gbti-card-list [data-card]').first().click().catch(() => {});
      await p.waitForSelector('gbti-reader', { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(600);
      await shoot(p, 'reader');
      await p.close();
    }

    // 5) The WorkBench
    {
      const p = await context.newPage();
      await p.goto(`chrome-extension://${extId}/workspace.html`, { waitUntil: 'domcontentloaded' });
      await dismissGate(p);
      await p.waitForSelector('gbti-workspace', { timeout: 12000 }).catch(() => {});
      await p.waitForTimeout(800);
      await shoot(p, 'workspace');
      await p.close();
    }

    log(`\nDONE -> ${SHOTS}`);
  } catch (e) {
    log(`ERROR ${e?.message ?? e}`);
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}
main();
