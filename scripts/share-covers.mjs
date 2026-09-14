#!/usr/bin/env node
// sow-283 / sow-272: host public share cover images ourselves. The decisions live in scripts/lib/share-covers.mjs
// (pure, unit-tested); this file only reads the repo, fetches, converts and writes. See that module's header for
// the two-stage lifecycle, and .github/workflows/share-covers.yml for how the stages are split across jobs.
//
//   node scripts/share-covers.mjs plan                  what a run would do (no network, no writes)
//   node scripts/share-covers.mjs fetch --out <dir>     STAGE 1, no credentials: fetch + convert into <dir>
//   node scripts/share-covers.mjs ingest <dir>          validate stage 1's output and copy it into the repo
//   node scripts/share-covers.mjs switch [--apply]      STAGE 2: point shares at deployed copies, restore, clean up
//   node scripts/share-covers.mjs open-pr <branch>      open the bot PR for a pushed branch and see it merge
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import sharp from 'sharp';
import { safeGet } from './lib/safe-fetch.mjs';
import { scrapeOgImage } from '../workers/lib/og-scrape.mjs';
import {
  MANIFEST_PATH, planShareCovers, parseManifest, serializeManifest, switchToCopy, restoreOriginal, shareKey,
} from './lib/share-covers.mjs';
import { shareCoverFileName, shareCoverUrl, parseShareCoverUrl } from '../membership/share-cover-url.mjs';

const ROOT = process.cwd();
export const MAX_COPY_BYTES = 300 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const COPY_WIDTH = 1280;
const RUN_BUDGET_MS = 4 * 60 * 1000;

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Every share file, reduced to the fields the planner reads. The id is the file stem, which is what every reader uses. */
export function readShares(root = ROOT) {
  const out = [];
  const members = path.join(root, 'members');
  for (const author of fs.existsSync(members) ? fs.readdirSync(members).sort() : []) {
    const dir = path.join(members, author, 'shares');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      let fm = {};
      try { fm = (m && yaml.load(m[1])) || {}; } catch { fm = {}; }
      out.push({
        author, id: f.slice(0, -3), file: path.join('members', author, 'shares', f),
        status: fm.status, visibility: fm.visibility, url: fm.url, image: fm.image,
        imageSource: fm.imageSource, imageRemoved: fm.imageRemoved === true,
      });
    }
  }
  return out;
}

/** Copy file names present, keyed by author. */
export function readCopyFiles(root = ROOT) {
  const out = {};
  const members = path.join(root, 'members');
  for (const author of fs.existsSync(members) ? fs.readdirSync(members) : []) {
    const dir = path.join(members, author, 'shares', 'images');
    if (fs.existsSync(dir)) out[author] = fs.readdirSync(dir).filter((f) => f.endsWith('.webp')).sort();
  }
  return out;
}

function readManifest(root = ROOT) {
  const p = path.join(root, MANIFEST_PATH);
  return parseManifest(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
}

/** The raster format a buffer's leading bytes declare, or null. Checked BEFORE sharp sees the bytes, and regardless
 *  of the Content-Type header, so an SVG or an HTML error page served as image/jpeg never reaches a decoder. */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && /^(avif|avis)$/.test(buf.subarray(8, 12).toString('latin1'))) return 'avif';
  return null;
}

/** Convert to a WebP at most COPY_WIDTH wide and MAX_COPY_BYTES big. Returns { out } or { error }. */
export async function toCopy(buf) {
  if (!sniffImage(buf)) return { error: 'not-image' };
  try {
    for (const quality of [80, 70, 60, 50, 40]) {
      const out = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width: COPY_WIDTH, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      if (out.length <= MAX_COPY_BYTES) return { out };
    }
    return { error: 'too-large' };
  } catch {
    return { error: 'not-image' };
  }
}

async function copyImage(source, get) {
  const res = await get(source, { maxBytes: MAX_IMAGE_BYTES, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1' });
  if (!res.ok) return { error: res.reason };
  if (/^(text\/|application\/(xhtml|json|xml))/.test(res.contentType)) return { error: 'not-image' };
  return toCopy(res.body);
}

/** STAGE 1. Fetch and convert every due item into outDir (mirroring repo paths) and write the updated manifest there. */
export async function runFetch({ outDir, get = safeGet, now = Date.now(), budgetMs = RUN_BUDGET_MS, log = console.log, root = ROOT } = {}) {
  const shares = readShares(root);
  const manifest = readManifest(root);
  const plan = planShareCovers({ shares, manifest, files: readCopyFiles(root), now });
  const started = Date.now();
  const covers = { ...manifest };
  let written = 0;
  // Newest shares first: when the budget runs out, the covers a visitor is most likely to see are already done.
  for (const item of [...plan.fetch].sort((a, b) => b.id.localeCompare(a.id))) {
    if (Date.now() - started > budgetMs) { log(`budget spent, ${item.key} left for the next run`); continue; }
    let source = item.source;
    const record = item.kind === 'lookup' ? { lookup: item.url } : {};
    if (item.kind === 'lookup') {
      const page = await get(item.url, { maxBytes: MAX_PAGE_BYTES, accept: 'text/html,application/xhtml+xml' });
      if (!page.ok) { covers[item.key] = { ...record, failed: page.reason, triedAt: dayOf(now) }; log(`${item.key}: page ${page.reason}`); continue; }
      if (!/html/.test(page.contentType)) { covers[item.key] = { ...record, failed: 'not-html', triedAt: dayOf(now) }; continue; }
      source = scrapeOgImage(page.body.toString('utf8'), page.finalUrl);
      if (!source) { covers[item.key] = { ...record, failed: 'no-preview', triedAt: dayOf(now) }; log(`${item.key}: no preview image`); continue; }
    }
    const copy = await copyImage(source, get);
    if (copy.error) { covers[item.key] = { ...record, source, failed: copy.error, triedAt: dayOf(now) }; log(`${item.key}: ${copy.error}`); continue; }
    const sha256 = crypto.createHash('sha256').update(copy.out).digest('hex');
    const file = shareCoverFileName(item.id, sha256);
    const dest = path.join(outDir, 'members', item.author, 'shares', 'images', file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, copy.out);
    covers[item.key] = { ...record, source, file, sha256, copiedAt: dayOf(now) };
    written++;
    log(`${item.key}: copied ${file} (${copy.out.length} bytes)`);
  }
  const manifestText = serializeManifest(covers);
  const before = serializeManifest(manifest);
  if (manifestText !== before) {
    fs.mkdirSync(path.join(outDir, 'house'), { recursive: true });
    fs.writeFileSync(path.join(outDir, MANIFEST_PATH), manifestText);
  }
  log(`fetch: ${plan.fetch.length} due, ${written} copied`);
  return { due: plan.fetch.length, written };
}

const COPY_PATH_RE = /^members\/([a-z0-9][a-z0-9-]*)\/shares\/images\/([a-z0-9][a-z0-9-]*-[0-9a-f]{8}\.webp)$/;

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Validate stage 1's output before it is copied next to the bot token, then copy it in. Every file must be a copy
 * path for an existing share or the manifest; every copy must be a WebP under the cap whose sha256 matches its
 * name. Anything else refuses the WHOLE ingest: the fetch job decoded untrusted bytes, so its output is untrusted.
 */
export function runIngest(dir, { root = ROOT } = {}) {
  const problems = [];
  const files = fs.existsSync(dir) ? walk(dir) : [];
  const shares = new Set(readShares(root).map((s) => shareKey(s.author, s.id)));
  for (const f of files) {
    if (f === MANIFEST_PATH) {
      try { parseManifest(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { problems.push(`${f}: ${e.message}`); }
      continue;
    }
    const m = COPY_PATH_RE.exec(f);
    if (!m) { problems.push(`${f}: not a share cover path`); continue; }
    const parsed = parseShareCoverUrl(`/media/shares/${m[1]}/${m[2]}`);
    if (!parsed || !shares.has(shareKey(m[1], parsed.id))) { problems.push(`${f}: no such share`); continue; }
    const buf = fs.readFileSync(path.join(dir, f));
    if (buf.length > MAX_COPY_BYTES) problems.push(`${f}: ${buf.length} bytes is over the cap`);
    if (sniffImage(buf) !== 'webp') problems.push(`${f}: not a WebP`);
    if (!crypto.createHash('sha256').update(buf).digest('hex').startsWith(parsed.hash)) problems.push(`${f}: sha256 does not match its name`);
  }
  if (problems.length) return { ok: false, problems };
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.copyFileSync(path.join(dir, f), path.join(root, f));
  }
  return { ok: true, copied: files.length };
}

/** STAGE 2. Point shares at copies that are live, restore shares that stopped being public, delete stale copies. */
export async function runSwitch({ apply = false, get = safeGet, now = Date.now(), log = console.log, root = ROOT } = {}) {
  const shares = readShares(root);
  const byKey = new Map(shares.map((s) => [shareKey(s.author, s.id), s]));
  const manifest = readManifest(root);
  const plan = planShareCovers({ shares, manifest, files: readCopyFiles(root), now });
  const covers = { ...manifest };
  const changed = [];

  for (const r of plan.restore) {
    const s = byKey.get(r.key);
    const text = fs.readFileSync(path.join(root, s.file), 'utf8');
    const next = restoreOriginal(text, { image: r.image });
    if (next && next !== text) { changed.push(`restore ${r.key}`); if (apply) fs.writeFileSync(path.join(root, s.file), next); }
  }
  for (const p of plan.promote) {
    const url = shareCoverUrl(p.author, p.file);
    const live = await get(url, { maxBytes: MAX_COPY_BYTES * 2, accept: 'image/webp' });
    const sha = live.ok ? crypto.createHash('sha256').update(live.body).digest('hex') : null;
    if (sha !== p.sha256) { log(`${p.key}: ${url} is not live yet (${live.ok ? 'different bytes' : live.reason})`); continue; }
    const s = byKey.get(p.key);
    const text = fs.readFileSync(path.join(root, s.file), 'utf8');
    const next = switchToCopy(text, { url, source: p.source });
    if (next && next !== text) { changed.push(`switch ${p.key}`); if (apply) fs.writeFileSync(path.join(root, s.file), next); }
  }
  for (const f of plan.deleteFiles) { changed.push(`delete ${f}`); if (apply) fs.rmSync(path.join(root, f), { force: true }); }
  for (const k of plan.dropEntries) { changed.push(`forget ${k}`); delete covers[k]; }
  if (apply && plan.dropEntries.length) fs.writeFileSync(path.join(root, MANIFEST_PATH), serializeManifest(covers));

  for (const c of changed) log(c);
  log(`switch: ${changed.length} change(s)${apply ? '' : ' (dry run)'}`);
  return { changed };
}

/** Open the bot PR for a pushed branch and wait for the PR gate to merge it (it auto-merges superadmin PRs). */
async function openPr(branch) {
  const { createGitHubClient } = await import('../clients/github.mjs');
  const github = createGitHubClient({ token: process.env.GITHUB_BOT_TOKEN, repo: process.env.GITHUB_CONTENT_REPO });
  const pull = await github.createPull({
    title: 'share-covers: host share cover images on gbti.network',
    head: branch,
    base: 'main',
    body: 'Automated by the share-covers workflow (sow-283). Copies public share cover images to members/<author>/shares/images/, and points a share at its copy only once that copy is live. Details: house/share-covers.yml.',
  });
  for (let i = 0; i < 36; i++) {
    const pr = await github.getPull(pull.number);
    if (pr?.merged) { try { await github.deleteRef(`heads/${branch}`); } catch { /* the repo may delete merged branches itself */ } return pull.number; }
    await new Promise((r) => setTimeout(r, 5000));
  }
  await github.mergePull(pull.number, { method: 'squash' });
  return pull.number;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const flag = (f) => process.argv.includes(f);
  const opt = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
  if (cmd === 'plan') {
    const plan = planShareCovers({ shares: readShares(), manifest: readManifest(), files: readCopyFiles() });
    console.log(JSON.stringify({ ...plan, fetch: plan.fetch.map((f) => `${f.kind} ${f.key}`) }, null, 2));
  } else if (cmd === 'fetch') {
    const out = opt('--out');
    if (!out) throw new Error('fetch needs --out <dir>');
    await runFetch({ outDir: path.resolve(out) });
  } else if (cmd === 'ingest') {
    const r = runIngest(path.resolve(arg));
    if (!r.ok) { for (const p of r.problems) console.error(p); process.exit(1); }
    console.log(`ingest: ${r.copied} file(s)`);
  } else if (cmd === 'switch') {
    await runSwitch({ apply: flag('--apply') });
  } else if (cmd === 'open-pr') {
    console.log(`merged #${await openPr(arg)}`);
  } else {
    console.error('usage: share-covers.mjs plan | fetch --out <dir> | ingest <dir> | switch [--apply] | open-pr <branch>');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
}
