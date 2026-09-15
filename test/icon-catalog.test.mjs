// sow-337: the button icon library (membership/icon-catalog.mjs, scripts/lib/icon-catalog-store.mjs). The build reads
// React Icons as text and never runs it, converts each icon through the same allowlist a saved icon meets, and serves
// a names index plus shards. These tests read the pinned package itself, so a release that changes the generated file
// shape reds here instead of shipping an empty picker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  parseIconModule, parseIconsManifest, convertIconSet, packIcon, unpackIcon, iconShardKey, iconWords, searchIcons,
  ICON_SHARD_SIZE, ICON_CATALOG_VERSION,
} from '../membership/icon-catalog.mjs';
import { readIconCatalog } from '../scripts/lib/icon-catalog-store.mjs';
import { reactIconToCta, iconProblems } from '../membership/cta-icon.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const PKG = path.join(ROOT, 'node_modules', 'react-icons');

test('the pinned package is the version the catalog is written for', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/react-icons'].version, ICON_CATALOG_VERSION);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies['react-icons'], ICON_CATALOG_VERSION, 'pinned exactly, never a range');
});

test('a real set parses completely from its text, and the committed Stranger icon is in it unchanged', () => {
  const { icons, unreadable } = parseIconModule(fs.readFileSync(path.join(PKG, 'fa', 'index.mjs'), 'utf8'));
  assert.equal(unreadable, 0);
  assert.ok(icons.length > 1500, `Font Awesome 5 has over 1,500 icons, parsed ${icons.length}`);
  const set = convertIconSet('Font Awesome 5', icons);
  assert.equal(set.refused, 0);
  const at = set.names.indexOf('FaAmazon');
  const committed = yaml.load(fs.readFileSync(path.join(ROOT, 'house', 'ctas.yml'), 'utf8')).ctas.find((c) => c.id === 'stranger-in-a-strange-land').icon;
  assert.deepEqual(unpackIcon('FaAmazon', 'Font Awesome 5', set.packed[at]), committed);
});

test('parsing never runs the module: code outside the icon exports is ignored, and a broken export is counted', () => {
  const tree = { tag: 'svg', attr: { viewBox: '0 0 24 24' }, child: [{ tag: 'path', attr: { d: 'M0 0h24v24H0z' }, child: [] }] };
  const src = [
    '// THIS FILE IS AUTO GENERATED',
    "import { GenIcon } from '../lib/index.mjs';",
    'globalThis.__iconCatalogRan = true; throw new Error("executed");',
    `export function AbGood (props) {\n  return GenIcon(${JSON.stringify(tree)})(props);\n};`,
    'export function AbBroken (props) {\n  return GenIcon({"tag":"svg",)(props);\n};',
    'export function AbOther (props) { return fetch("https://example.com"); }',
  ].join('\n');
  const { icons, unreadable } = parseIconModule(src);
  assert.deepEqual(icons.map((i) => i.name), ['AbGood']);
  assert.equal(unreadable, 2);
  assert.equal(globalThis.__iconCatalogRan, undefined);
});

test('the set list is read as data, and a malformed list gives no sets rather than a guess', () => {
  const rows = parseIconsManifest(fs.readFileSync(path.join(PKG, 'lib', 'iconsManifest.mjs'), 'utf8'));
  assert.ok(rows.length >= 30);
  assert.ok(rows.some((r) => r.id === 'fa' && r.name === 'Font Awesome 5'));
  assert.deepEqual(parseIconsManifest('export var IconsManifest = [ {"id": "fa", '), []);
  assert.deepEqual(parseIconsManifest('export var IconsManifest = [{"id":"../x","name":"Bad"}]'), [], 'a set id that is not a plain word is dropped');
});

test('an icon the allowlist refuses is left out of the library, and a group label is dropped instead of refusing', () => {
  const bad = { tag: 'svg', attr: { viewBox: '0 0 24 24' }, child: [{ tag: 'script', attr: {}, child: [] }] };
  const labelled = { tag: 'svg', attr: { viewBox: '0 0 24 24' }, child: [{ tag: 'g', attr: { id: 'Zoom_Out' }, child: [{ tag: 'path', attr: { d: 'M1 1h2' }, child: [] }] }] };
  const set = convertIconSet('Test', [{ name: 'AbBad', tree: bad }, { name: 'AbLabelled', tree: labelled }]);
  assert.equal(set.refused, 1);
  assert.deepEqual(set.names, ['AbLabelled']);
  const icon = reactIconToCta('AbLabelled', 'Test', labelled);
  assert.deepEqual(icon.shapes, [{ tag: 'g', attrs: {}, children: [{ tag: 'path', attrs: { d: 'M1 1h2' } }] }]);
  const stored = structuredClone(icon);
  stored.shapes[0].attrs.id = 'Zoom_Out';
  assert.ok(iconProblems(stored).length > 0, 'a saved icon carrying an id is still refused');
});

test('packing leaves out the default paint and unpacks to exactly the converted icon', () => {
  const plain = { name: 'AbA', set: 'Test', viewBox: '0 0 24 24', attrs: { fill: 'currentColor', stroke: 'currentColor', 'stroke-width': '0' }, shapes: [{ tag: 'path', attrs: { d: 'M0 0' } }] };
  assert.deepEqual(packIcon(plain), { v: '0 0 24 24', s: plain.shapes });
  assert.deepEqual(unpackIcon('AbA', 'Test', packIcon(plain)), plain);
  const outline = { ...plain, attrs: { fill: 'none', stroke: 'currentColor', 'stroke-width': '2' } };
  assert.deepEqual(packIcon(outline).a, outline.attrs);
  assert.deepEqual(unpackIcon('AbA', 'Test', packIcon(outline)), outline);
  assert.equal(iconShardKey('fa', ICON_SHARD_SIZE - 1), 'fa-0');
  assert.equal(iconShardKey('fa', ICON_SHARD_SIZE), 'fa-1');
});

test('search ranks the exact name first, then whole words, then prefixes, then any match, and filters by set', () => {
  const index = { sets: [
    { id: 'fa', name: 'Font Awesome 5', names: ['FaCcAmazonPay', 'FaAmazonPay', 'FaAmazon', 'FaBook'] },
    { id: 'si', name: 'Simple Icons', names: ['SiAmazonaws', 'SiAmazon'] },
  ] };
  assert.equal(iconWords('FaCcAmazonPay'), 'cc amazon pay');
  const r = searchIcons(index, 'amazon');
  assert.deepEqual(r.results.map((x) => x.name), ['FaAmazon', 'SiAmazon', 'FaCcAmazonPay', 'FaAmazonPay', 'SiAmazonaws']);
  assert.equal(r.total, 5);
  assert.deepEqual(r.results[0], { name: 'FaAmazon', index: 2, setId: 'fa', setName: 'Font Awesome 5', shard: 'fa-0' });
  assert.deepEqual(searchIcons(index, 'amazon', { setId: 'si' }).results.map((x) => x.name), ['SiAmazon', 'SiAmazonaws']);
  assert.deepEqual(searchIcons(index, 'amazon', { limit: 2 }).results.length, 2);
  assert.equal(searchIcons(index, 'amazon', { limit: 2 }).total, 5, 'the count is every match, not the page shown');
  assert.equal(searchIcons(index, 'zzz').total, 0);
  assert.equal(searchIcons(index, '').total, 6, 'an empty search lists the whole library');
});

test('the build reader converts the whole pinned library into shards, and FaAmazon ranks first for "amazon"', () => {
  const c = readIconCatalog(ROOT);
  assert.equal(c.available, true, c.problem);
  assert.equal(c.version, ICON_CATALOG_VERSION);
  const total = c.sets.reduce((n, s) => n + s.names.length, 0);
  assert.ok(total > 45000, `about 50,000 icons, read ${total}`);
  for (const s of c.sets) {
    for (let i = 0; i < s.names.length; i += ICON_SHARD_SIZE) assert.ok(c.shards.get(iconShardKey(s.id, i))?.length > 0, `${s.id} shard ${i}`);
  }
  const first = searchIcons(c, 'amazon').results[0];
  assert.equal(first.name, 'FaAmazon');
  assert.ok(c.shards.get(first.shard)[first.index % ICON_SHARD_SIZE].s.length > 0);
});

test('a missing or broken package never fails the build: the catalog says it is unavailable and why', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  try {
    const missing = readIconCatalog(ROOT, { dir: path.join(dir, 'absent') });
    assert.equal(missing.available, false);
    assert.match(missing.problem, /could not be read \(ENOENT\)/);
    fs.mkdirSync(path.join(dir, 'broken', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken', 'package.json'), '{"version":"5.7.0"}');
    fs.writeFileSync(path.join(dir, 'broken', 'lib', 'iconsManifest.mjs'), 'export var IconsManifest = nonsense');
    const broken = readIconCatalog(ROOT, { dir: path.join(dir, 'broken') });
    assert.equal(broken.available, false);
    assert.match(broken.problem, /set list could not be read/);
    assert.equal(broken.shards.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
