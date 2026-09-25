// sow-227: one category picker, hierarchical and searchable, on both hosts.
//
// Owner, 2026-09-22: "make the category select not flat, hierarchical, and searchable", one control shared by the
// website and the extension, the extension following the website. Rulings 2026-09-23: share topics are grouped
// under the Categories screen's headings; the follow grid stays a grid, restyled; the design was drawn and approved
// before any code. These tests pin the pure core, the element's value contract, and where each host wires it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import { treeNodesFromJson, highlightParts, pickerRows, valueDisplay, moveActive, categoryFieldHtml, PATH_SEP } from '../client-ui/src/category-picker-core.mjs';
import { GbtiCategoryPicker } from '../client-ui/src/elements/gbti-category-picker.mjs';
import { TOKENS } from '../client-ui/src/tokens.mjs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const REAL_TREE = yaml.load(read('house/taxonomy.yml')).tree;
const TREE = { tree: REAL_TREE };

const TOPICS = {
  kind: 'topics',
  groupOrder: ['DevOps', 'AI'],
  topics: [
    { key: 'ai', label: 'AI', group: 'AI', groupKey: 'ai' },
    { key: 'docker', label: 'Docker', group: 'DevOps', groupKey: 'devops' },
    { key: 'llm', label: 'LLM', group: 'AI', groupKey: 'ai' },
    { key: 'node', label: 'Node', group: 'DevOps', groupKey: 'devops' },
  ],
};

// ---- the tree ----

test('the tree becomes options keyed by FULL path, so the two Entertainments stay two', () => {
  const nodes = treeNodesFromJson(TREE);
  const ents = nodes.filter((n) => n.label === 'Entertainment');
  assert.deepEqual(ents.map((n) => n.key), ['ai/prompts/entertainment', 'entertainment']);
  assert.deepEqual(ents[0].crumbs, ['AI', 'Prompts & Skills'], 'the nested one reads as AI > Prompts & Skills > Entertainment');
  assert.deepEqual(ents[1].crumbs, []);
  assert.equal(nodes.find((n) => n.key === 'entertainment/gaming/minecraft/mods').depth, 3, 'the four-deep branch keeps its depth');
  assert.equal(new Set(nodes.map((n) => n.key)).size, nodes.length, 'every option key is unique');
  assert.deepEqual(treeNodesFromJson(null), []);
  assert.deepEqual(treeNodesFromJson({ tree: [] }), []);
});

test('a tree search keeps each match\'s parents in view, muted and still choosable', () => {
  const vocab = { kind: 'tree', nodes: treeNodesFromJson(TREE) };
  const { options } = pickerRows(vocab, 'enter');
  assert.deepEqual(options.map((o) => [o.key, o.muted]), [
    ['ai', true], ['ai/prompts', true], ['ai/prompts/entertainment', false], ['entertainment', false],
  ]);
  assert.equal(pickerRows(vocab, '').options.length, vocab.nodes.length, 'no query lists the whole tree');
  assert.deepEqual(pickerRows(vocab, 'zzz-nothing').options, []);
  // A match on a node's own key counts (ui-ux is labelled UI/UX).
  assert.ok(pickerRows(vocab, 'ui-ux').options.some((o) => o.key === 'design/ui-ux'));
});

// ---- the topics ----

test('topics are grouped under their headings in the given order, and a search drops empty headings', () => {
  const { rows, options } = pickerRows(TOPICS, '');
  assert.deepEqual(rows.map((r) => r.type === 'group' ? `# ${r.label}` : r.key), ['# DevOps', 'docker', 'node', '# AI', 'ai', 'llm']);
  assert.deepEqual(options.map((o) => o.key), ['docker', 'node', 'ai', 'llm']);
  const hit = pickerRows(TOPICS, 'll');
  assert.deepEqual(hit.rows.map((r) => r.type === 'group' ? `# ${r.label}` : r.key), ['# AI', 'llm']);
});

// ---- sow-408: the topics read as a two-level tree ----

test('sow-408: a group row carries its size and its matches, and its topics sit one level in', () => {
  const all = pickerRows(TOPICS, '');
  assert.deepEqual(all.rows.filter((r) => r.type === 'group').map((r) => [r.label, r.count, r.total]), [['DevOps', 2, 2], ['AI', 2, 2]]);
  assert.deepEqual(all.options.map((o) => [o.key, o.depth, o.group]), [['docker', 1, 'DevOps'], ['node', 1, 'DevOps'], ['ai', 1, 'AI'], ['llm', 1, 'AI']]);
  const hit = pickerRows(TOPICS, 'll');
  assert.deepEqual(hit.rows.filter((r) => r.type === 'group').map((r) => [r.label, r.count, r.total]), [['AI', 1, 2]], 'the total is the whole group, not the matches');
});

test('sow-408: a group row is never an option, so the arrow keys can only land on topics', () => {
  for (const q of ['', 'll', 'o']) {
    const { rows, options } = pickerRows(TOPICS, q);
    assert.ok(options.every((o) => o.type === 'option'), `no group among the options for "${q}"`);
    assert.equal(options.length, rows.filter((r) => r.type === 'option').length);
  }
});

test('sow-408: a payload without groups keeps the flat list it had', () => {
  const flat = { kind: 'topics', groupOrder: [], topics: [{ key: 'go', label: 'Go' }, { key: 'rust', label: 'Rust' }] };
  const { rows, options } = pickerRows(flat, '');
  assert.equal(rows.some((r) => r.type === 'group'), false);
  assert.deepEqual(options.map((o) => [o.key, o.depth, 'group' in o]), [['go', 0, false], ['rust', 0, false]]);
  assert.deepEqual(valueDisplay(flat, 'go'), { state: 'known', crumbs: [], leaf: 'Go' });
});

// The element's list, rendered in node: $ hands back a stand-in list and nothing else exists.
function renderList(vocab, attrs, { query = '', value = '' } = {}) {
  const el = picker(vocab, attrs);
  const list = { innerHTML: '' };
  el.$ = (sel) => (sel === '.list' ? list : null);
  el.$$ = () => [];
  el._query = query;
  el._value = value;
  el._renderList();
  return list.innerHTML;
}

test('sow-408: each group renders as a named section with a pinned header holding its count', () => {
  const html = renderList(TOPICS, { vocab: 'topics' }, { value: 'node' });
  assert.equal((html.match(/<div class="sec" role="group" aria-label="/g) || []).length, 2);
  const devops = html.slice(html.indexOf('aria-label="DevOps"'), html.indexOf('aria-label="AI"'));
  assert.match(devops, /<div class="grp" aria-hidden="true"><span class="gl">DevOps<\/span><span class="gc">2<\/span><\/div>/);
  assert.match(devops, /data-i="0"[^>]*style="padding-left:20px"><span class="br" aria-hidden="true"><\/span><span class="lb">Docker/, 'Docker sits one level in, inside DevOps');
  assert.match(devops, /class="opt sel"[^>]*aria-selected="true"/, 'the chosen topic is marked inside its group');
  assert.equal((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length, 'every section is closed');
  assert.match(renderList(TOPICS, { vocab: 'topics' }, { query: 'll' }), /<span class="gc">1 of 2<\/span>/, 'a search says how many of the group match');
});

test('sow-408: the tree is untouched: no sections, 20px per level, the elbow only below the top', () => {
  const html = renderList({ kind: 'tree', nodes: treeNodesFromJson(TREE) }, { vocab: 'tree' });
  assert.doesNotMatch(html, /class="sec"|class="grp"/);
  assert.match(html, /class="opt top"[^>]*style="padding-left:12px"><span class="lb">/);
  assert.match(html, /style="padding-left:32px"><span class="br"/);
});

test('sow-408: the header is pinned, frosted under Glass, and keyboard movement never parks a row beneath it', () => {
  const src = read('client-ui/src/elements/gbti-category-picker.mjs');
  assert.match(src, /\.grp \{ position:sticky; top:0; z-index:1;/);
  assert.match(src, /background:var\(--panel\);[^}]*backdrop-filter:var\(--glass-blur, none\); \}/);
  assert.match(src, /\.sec \.opt \{ scroll-margin-top:40px; \}/);
});

test('sow-408: the closed picker names the group, on screen and to a screen reader', () => {
  const el = picker(TOPICS, { vocab: 'topics', 'aria-label': 'Category' });
  let out = '';
  el.css = () => '';
  el.set = (h) => { out = h; };
  el.on = () => {};
  el.value = 'docker';
  el.render();
  assert.match(out, new RegExp(`<span class="crumb">DevOps${PATH_SEP}</span><span class="leaf">Docker</span>`));
  assert.match(out, /aria-label="Category: DevOps, Docker"/);
});

// ---- what the closed picker says ----

test('the closed picker shows a full path, and never drops a value it does not know', () => {
  const tree = { kind: 'tree', nodes: treeNodesFromJson(TREE) };
  assert.deepEqual(valueDisplay(tree, 'ai/prompts/skill'), { state: 'known', crumbs: ['AI', 'Prompts & Skills'], leaf: 'Skill' });
  assert.deepEqual(valueDisplay(tree, 'devops/kubernetes'), { state: 'unknown', crumbs: [], leaf: `devops${PATH_SEP}kubernetes` });
  assert.deepEqual(valueDisplay(null, 'ai/llms'), { state: 'loading', crumbs: [], leaf: `ai${PATH_SEP}llms` }, 'not "unknown" while loading');
  assert.equal(valueDisplay(tree, '').state, 'empty');
  // sow-408: a topic now names its group, so the closed picker reads "DevOps — Docker" (was crumbs: []).
  assert.deepEqual(valueDisplay(TOPICS, 'docker'), { state: 'known', crumbs: ['DevOps'], leaf: 'Docker' });
  // Owner ruling 2026-09-24: an em dash is allowed as a separator inside a dropdown or selector, and the path uses it.
  assert.equal(PATH_SEP, ' — ', 'the levels of a path are separated by a spaced em dash');
  assert.equal(valueDisplay(TOPICS, 'retired-topic').state, 'unknown');
});

test('highlightParts and moveActive', () => {
  assert.deepEqual(highlightParts('Entertainment', 'TAIN'), { pre: 'Enter', mid: 'tain', post: 'ment' });
  assert.deepEqual(highlightParts('AI', ''), { pre: 'AI', mid: '', post: '' });
  assert.deepEqual(highlightParts('AI', 'zz'), { pre: 'AI', mid: '', post: '' });
  assert.equal(moveActive(0, -1, 5), 0, 'no wrap at the top');
  assert.equal(moveActive(4, 1, 5), 4, 'no wrap at the bottom');
  assert.equal(moveActive(-1, 1, 5), 0);
  assert.equal(moveActive(2, 1, 0), -1, 'nothing to move to');
});

// ---- the element's value contract (constructed in node, where it has no DOM) ----

function picker(vocab, attrs = {}) {
  const el = new GbtiCategoryPicker();
  el.getAttribute = (n) => attrs[n] ?? null;
  el.hasAttribute = (n) => n in attrs;
  el._vocab = vocab;
  return el;
}

test('the element takes a path for the tree and a key for topics, and knows what its list has', () => {
  const tree = picker({ kind: 'tree', nodes: treeNodesFromJson(TREE) }, { vocab: 'tree' });
  tree.value = 'ai/prompts/entertainment';
  assert.deepEqual(tree.path, ['ai', 'prompts', 'entertainment']);
  assert.equal(tree.has('ai/prompts/entertainment'), true);
  assert.equal(tree.has('entertainment/ai'), false);
  tree.value = null;
  assert.deepEqual(tree.path, []);
  const topics = picker(TOPICS, { vocab: 'topics' });
  topics.value = 'docker';
  assert.deepEqual(topics.path, ['docker']);
  assert.equal(topics.has('docker'), true);
  assert.equal(picker(null, {}).has('docker'), false, 'nothing is known while the list loads');
});

// ---- the editor field ----

test('the editor field keeps the stored shape: the picker plus the comma-joined hidden input gather() reads', () => {
  const html = categoryFieldHtml(['ai', 'prompts', 'skill']);
  assert.match(html, /<gbti-category-picker vocab="tree" data-cat-picker value="ai\/prompts\/skill"><\/gbti-category-picker>/);
  assert.match(html, /<input data-key="categories" data-kind="array" type="hidden" value="ai, prompts, skill" \/>/);
  assert.match(categoryFieldHtml(['a"b']), /value="a&quot;b"/, 'escaped');
  assert.match(categoryFieldHtml([]), /value="" \/>$/);
});

// ---- where each host wires it ----

test('the share composer uses the picker, not a flat select, and no longer loads the list itself', () => {
  const src = read('client-ui/src/elements/gbti-share-composer.mjs');
  assert.doesNotMatch(src, /select\.cat|<select class="cat"|_loadTopics|topicsFromJson/);
  assert.match(src, /import '\.\/gbti-category-picker\.mjs';/);
  assert.match(src, /<gbti-category-picker class="cat" vocab="topics" aria-label="Category" required><\/gbti-category-picker>/);
  assert.match(src, /this\.\$\('\.cat'\)\?\.ready\?\.then\(\(\) => this\._applySuggested\(\)\);/, 'a suggestion waits for the list');
  assert.match(src, /sel\.has\?\.\(this\._suggested\)/, 'only a topic the list has is suggested');
  assert.match(src, /const category = this\.\$\('\.cat'\)\?\.value \|\| '';/, 'the stored key still comes from the control');
  assert.ok(src.split('\n').length <= 900, 'the composer stays under the 900-line cap');
});

test('the editor Category field renders the tree picker and writes the path back on change', () => {
  const src = read('client-ui/src/elements/gbti-content-editor.mjs');
  assert.match(src, /if \(f\.key === 'categories'\) return wrap\(`\$\{label\}\$\{categoryFieldHtml\(arr\)\}`\);/);
  assert.match(src, /\[data-cat-picker\]'\)\?\.addEventListener\('change', \(e\) => \{ const h = this\.\$\('input\[data-key="categories"\]'\); if \(h\) h\.value = \(e\.detail\?\.path \|\| \[\]\)\.join\(', '\); this\._markDirty\(\); \}\);/);
  const fields = read('client/src/form-fields.mjs');
  assert.equal((fields.match(/f\('categories', 'Category', 'array', \{ hint: 'one place in the category tree' \}\)/g) || []).length, 3, 'post, project and prompt');
});

test('the WorkBench Following tab loads the topic grid it renders', () => {
  assert.match(read('client-ui/src/elements/gbti-subscriptions.mjs'), /^import '\.\/gbti-topic-picker\.mjs';$/m);
});

// ---- the website's tokens, pinned in both themes ----

function tokensFor(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = tokensFor(TOKENS.slice(TOKENS.indexOf(':host {'), TOKENS.indexOf(':host-context([data-theme="dark"])')));
const dark = tokensFor(TOKENS.slice(TOKENS.indexOf(':host-context([data-theme="dark"])'), TOKENS.indexOf('data-layout="glass"')));

test('the three website tokens the picker names are defined in both themes, with the site values', () => {
  for (const t of ['--line-2', '--green-tint', '--fg-mute']) {
    assert.ok(light[t], `${t} light`);
    assert.ok(dark[t], `${t} dark`);
  }
  const site = read('src/styles/gbti-v3.css');
  assert.ok(site.includes(`--line-2:     ${light['--line-2']}`) && site.includes(`--green-tint: ${light['--green-tint']}`), 'light values are the site\'s');
});

// WCAG relative luminance over an opaque background (alpha composited).
function rgb(c, over = [255, 255, 255]) {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map((x) => Number(x.trim()));
    return [r, g, b].map((v, i) => v * a + over[i] * (1 - a));
  }
  const h = c.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('a selected chip or option (accent on the green tint) and the muted text pass AA in both themes', () => {
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    const panel = rgb(t['--panel']);
    const tint = rgb(t['--green-tint'], panel);
    assert.ok(ratio(rgb(t['--accent']), tint) >= 4.5, `${name}: selected text ${ratio(rgb(t['--accent']), tint).toFixed(2)}:1`);
    const mute = ratio(rgb(t['--fg-mute'], panel), panel);
    assert.ok(mute >= 4.5, `${name}: muted text ${mute.toFixed(2)}:1`);
  }
  const src = read('client-ui/src/elements/gbti-topic-picker.mjs');
  assert.match(src, /\.chip\.on, \.chip\.on:hover \{ color:var\(--accent\); background:var\(--green-tint\); border-color:var\(--brand\); \}/);
  assert.doesNotMatch(src, /color:#fff; background:var\(--accent\)/, 'the white-on-mint chip is gone');
});
