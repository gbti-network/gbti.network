// Responsive screenshot run for the Admin -> Categories workspace (SOW-100 QA). Same rails as
// responsive-shots.mjs: the unpacked MV3 extension in a persistent headed context (xvfb), the signed-in
// identity seeded into chrome.storage so the live Worker authenticates and the workspace renders REAL data.
// Shoots the owner's full viewport matrix (mobile devices, tablets, desktop widths) with a category selected.
// Run: xvfb-run -a node --env-file=.env tests/e2e/admin-categories-shots.mjs [--out <dir>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const EXT_DIR = path.join(ROOT, 'extension');
const outIdx = process.argv.indexOf('--out');
const SHOTS = outIdx > -1 ? process.argv[outIdx + 1] : path.join(ROOT, 'tests/e2e/shots-admin');
const TOKEN = process.env.E2E_TOKEN || process.env.GITHUB_BOT_TOKEN || '';

// The owner's matrix: mobile devices / tablets / desktop browser widths (2026-07-07 responsive directive).
const MOBILE = [[320, 568, 'm-320'], [360, 740, 'm-galaxy'], [375, 667, 'm-se'], [390, 844, 'm-iph13'], [393, 852, 'm-iph15'], [412, 915, 'm-pixel7'], [430, 932, 'm-iph15max']];
const TABLET = [[600, 960, 't-600'], [768, 1024, 't-ipadmini'], [810, 1080, 't-ipad'], [1024, 768, 't-land'], [1024, 1366, 't-ipadpro'], [1366, 1024, 't-ipadpro-land']];
const DESKTOP = [[600, 900, 'd-600'], [650, 900, 'd-650'], [768, 900, 'd-768'], [1024, 768, 'd-1024'], [1280, 720, 'd-1280'], [1366, 768, 'd-1366'], [1440, 900, 'd-1440'], [1536, 864, 'd-1536'], [1920, 1080, 'd-1920'], [2560, 1440, 'd-2560']];
const QUICK = process.argv.includes('--quick');
const SET = QUICK
  ? [[320, 568, 'm-320'], [393, 852, 'm-iph15'], [768, 1024, 't-ipadmini'], [600, 900, 'd-600'], [650, 900, 'd-650'], [1280, 720, 'd-1280'], [1920, 1080, 'd-1920']]
  : [...MOBILE, ...TABLET, ...DESKTOP];

async function main() {
  const { chromium } = await import('playwright');
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-adminshots-'));
  const context = await chromium.launchPersistentContext(udd, {
    headless: false,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
    const extId = new URL(sw.url()).host;
    console.log(`extension id ${extId}`);
    await sw.evaluate((tok) => chrome.storage.local.set({ gbti: { githubToken: tok, identity: { login: 'gbtilabs', githubId: '125175036', username: 'gbtilabs' } } }), TOKEN);

    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/admin.html`, { waitUntil: 'domcontentloaded' });
    // open the Categories tab + wait for the workspace tree (real taxonomy + counts from the live indexes)
    await p.waitForTimeout(1500);
    await p.evaluate(() => document.querySelector('[data-tab="categories"]')?.click());
    await p.waitForFunction(() => {
      const ws = document.querySelector('gbti-categories-workspace');
      return ws?.shadowRoot?.querySelectorAll('.titem').length > 3;
    }, { timeout: 25000 });
    // select the first top-level category so the detail + dashboard render
    await p.evaluate(() => {
      const r = document.querySelector('gbti-categories-workspace').shadowRoot;
      [...r.querySelectorAll('.titem[data-sel]')].find((b) => b.classList.contains('lvl0'))?.click();
    });
    await p.waitForTimeout(800);

    for (const [w, h, label] of SET) {
      await p.setViewportSize({ width: w, height: h });
      await p.waitForTimeout(450);
      await p.screenshot({ path: path.join(SHOTS, `cat-${w}x${h}-${label}.png`), fullPage: false });
      console.log(`shot ${w}x${h} ${label}`);
    }
    // the empty state at three key widths
    await p.evaluate(() => {
      const r = document.querySelector('gbti-categories-workspace').shadowRoot;
      r.querySelector('.titem.on')?.click();
    });
    for (const [w, h, label] of [[393, 852, 'm-iph15'], [768, 1024, 't-ipadmini'], [1920, 1080, 'd-1920']]) {
      await p.setViewportSize({ width: w, height: h });
      await p.waitForTimeout(350);
      await p.screenshot({ path: path.join(SHOTS, `empty-${w}x${h}-${label}.png`), fullPage: false });
    }
    console.log(`done: ${fs.readdirSync(SHOTS).length} shots in ${SHOTS}`);
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(udd, { recursive: true, force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
