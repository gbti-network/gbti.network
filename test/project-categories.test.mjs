// sow-269: the project families and the banner color presets are separate lists by design (removing a family must
// never remove a preset that published frontmatter names), and gbti-v3.css restates the presets as literal
// hero rules because a stylesheet cannot import a module. Three lists that must agree by hand drifted before:
// Chrome Extensions was a taxonomy leaf with no family, no preset and no hero rule, so Ryker rendered as a
// Utilities project with no filter chip. The failure is SILENT: a preset key with no CSS rule validates, shows
// in the editor, publishes, and renders as the ink default. This suite is what makes it loud.
//
// `drift()` is pure so its negative controls live here permanently: each synthetic case below must be caught,
// which is what stops a regex that matches nothing from passing the real-file check on zero subjects.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { PROJECT_CATEGORIES, OTHER_CATEGORY, categoryOf, categoryStyle } from '../src/lib/project-categories.mjs';
import { BANNER_PRESETS } from '../src/lib/banner-presets.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const HEX = /^#[0-9a-f]{6}$/;
const RULE = /\.pd-hero\[data-preset="([^"]+)"\]\s*\{\s*background:\s*linear-gradient\(150deg,\s*(#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)\s*;?\s*\}/g;

function taxonomyLeaves(tree) {
  const keys = new Set();
  const walk = (nodes) => {
    for (const [k, v] of Object.entries(nodes || {})) { keys.add(k); walk(v && v.children); }
  };
  walk(tree);
  return keys;
}

/** Every disagreement between the family list, the preset list, the hero CSS and the taxonomy. */
function drift({ categories, presets, css, taxonomyKeys }) {
  const problems = [];
  const rules = new Map();
  for (const m of css.matchAll(RULE)) {
    if (rules.has(m[1])) problems.push(`hero rule for "${m[1]}" is declared twice`);
    rules.set(m[1], { from: m[2].toLowerCase(), to: m[3].toLowerCase() });
  }
  // A rule in a shape RULE does not read would otherwise count as "missing" for its key AND hide that it exists.
  const declared = (css.match(/\.pd-hero\[data-preset="/g) || []).length;
  if (declared !== rules.size) problems.push(`${declared} hero preset selectors but only ${rules.size} readable rules`);

  const presetByKey = new Map(presets.map((p) => [p.key, p]));
  for (const p of presets) {
    const r = rules.get(p.key);
    if (!r) problems.push(`preset "${p.key}" has no hero rule, so it renders as ink`);
    else if (r.from !== p.from.toLowerCase() || r.to !== p.to.toLowerCase()) {
      problems.push(`preset "${p.key}" is ${p.from}->${p.to} but its hero rule is ${r.from}->${r.to}`);
    }
  }
  for (const k of rules.keys()) if (!presetByKey.has(k)) problems.push(`hero rule "${k}" has no preset`);

  for (const c of categories) {
    if (!taxonomyKeys.has(c.leaf)) problems.push(`family "${c.leaf}" is not a taxonomy key`);
    const p = presetByKey.get(c.leaf);
    if (!p) problems.push(`family "${c.leaf}" has no banner preset`);
    else if (p.from.toLowerCase() !== c.cb.toLowerCase()) problems.push(`family "${c.leaf}" base ${c.cb} but its preset starts ${p.from}`);
  }
  return problems;
}

const real = () => ({
  categories: PROJECT_CATEGORIES,
  presets: BANNER_PRESETS,
  css: read('src/styles/gbti-v3.css'),
  taxonomyKeys: taxonomyLeaves(yaml.load(read('house/taxonomy.yml')).tree),
});

test('sow-269: the families, the presets, the hero CSS and the taxonomy agree', () => {
  const r = real();
  assert.ok(r.categories.length >= 5 && r.presets.length >= 8, 'the lists under test are not empty');
  assert.ok([...r.css.matchAll(RULE)].length === r.presets.length, 'every preset rule was read, not zero of them');
  assert.deepEqual(drift(r), []);
});

test('sow-269: drift() catches each way the lists come apart (negative controls)', () => {
  const r = real();
  const one = (patch, pattern) => {
    const problems = drift({ ...r, ...patch });
    assert.ok(problems.some((p) => pattern.test(p)), `expected ${pattern} in ${JSON.stringify(problems)}`);
  };
  const ruleFor = (k) => new RegExp(`\\.pd-hero\\[data-preset="${k}"\\][^\\n]*\\n`);
  assert.match(r.css, ruleFor('chrome-extensions'), 'the anchor the next case removes exists');
  one({ css: r.css.replace(ruleFor('chrome-extensions'), '') }, /"chrome-extensions" has no hero rule/);
  one({ css: r.css.replace('#e0584a, #25232b', '#e0584b, #25232b') }, /"chrome-extensions" is #e0584a->#25232b but its hero rule/);
  one({ presets: [...r.presets, { key: 'teal', label: 'Teal', from: '#138178', to: '#25232b' }] }, /"teal" has no hero rule/);
  one({ presets: r.presets.filter((p) => p.key !== 'utilities') }, /hero rule "utilities" has no preset/);
  one({ presets: r.presets.filter((p) => p.key !== 'utilities') }, /family "utilities" has no banner preset/);
  one({ categories: [...r.categories, { leaf: 'react', cb: '#61dafb' }] }, /family "react" has no banner preset/);
  one({ categories: [...r.categories.slice(0, -1), { ...r.categories.at(-1), cb: '#ffffff' }] }, /base #ffffff but its preset starts/);
  one({ categories: [...r.categories, { leaf: 'not-a-leaf', cb: '#000000' }] }, /"not-a-leaf" is not a taxonomy key/);
  one({ css: r.css.replace('.pd-hero[data-preset="mods"] { background:', '.pd-hero[data-preset="mods"] { background-image:') }, /hero preset selectors but only/);
});

test('sow-269: the family list is well formed and every glyph it names is drawn', () => {
  const directory = read('src/components/projects/ProjectDirectory.astro');
  const all = [...PROJECT_CATEGORIES, OTHER_CATEGORY];
  assert.equal(new Set(PROJECT_CATEGORIES.map((c) => c.key)).size, PROJECT_CATEGORIES.length, 'family keys are unique');
  assert.equal(new Set(PROJECT_CATEGORIES.map((c) => c.leaf)).size, PROJECT_CATEGORIES.length, 'family leaves are unique');
  assert.ok(!PROJECT_CATEGORIES.some((c) => c.key === OTHER_CATEGORY.key), 'no family can collide with the fallback key');
  for (const c of all) {
    for (const s of ['ca', 'cb', 'ct', 'cl']) assert.match(c[s], HEX, `${c.key}.${s}`);
    assert.ok(directory.includes(`<g id="${c.glyph}">`), `glyph ${c.glyph} is defined in ProjectDirectory.astro`);
  }
});

test('sow-269: categoryOf resolves by the leaf and falls back to the neutral family', () => {
  assert.equal(categoryOf(['devops', 'frameworks', 'chrome-extensions'], 'Chrome Extensions').key, 'chrome');
  assert.equal(categoryOf(['devops', 'utilities'], 'Utilities').key, 'util');
  const other = categoryOf(['entertainment'], 'Entertainment');
  assert.equal(other.key, 'other');
  assert.equal(other.label, 'Entertainment');
  assert.equal(other.cb, OTHER_CATEGORY.cb, 'the fallback no longer borrows the Utilities teal');
  assert.equal(categoryOf(undefined, '').label, 'Project');
  assert.equal(categoryOf([], undefined).key, 'other');
  // A family key must not resolve from anywhere but the LEAF: a path THROUGH a family leaf is not that family.
  assert.equal(categoryOf(['wordpress', 'something'], 'Something').key, 'other');
  assert.equal(OTHER_CATEGORY.label, null, 'the shared fallback object is not mutated by a lookup');
  assert.equal(categoryStyle(PROJECT_CATEGORIES[0]), '--ca:#2f63c0;--cb:#5a8de0;--ct:#eef3fc;--cl:#bcd0f0');
});

test('sow-269: no site file keeps its own copy of the family palette', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(astro|ts|mjs|css)$/.test(e.name) && rel !== path.join('src', 'lib', 'project-categories.mjs')) {
        const s = read(rel);
        if (/DESIGN_CAT\b|\.c-(wp|ide|mod|util)\s*\{|--cb:\s*#/.test(s)) offenders.push(rel);
      }
    }
  };
  walk('src');
  assert.deepEqual(offenders, [], 'these files restate a family palette instead of importing src/lib/project-categories.mjs');
});
