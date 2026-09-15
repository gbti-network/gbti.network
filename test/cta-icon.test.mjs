// sow-337: the button icon allowlist (membership/cta-icon.mjs). A stored icon reaches every page carrying its card
// as raw SVG, so the rule is what it lets through, not what it filters: these tests feed it each way an SVG can run
// code or fetch something and require a refusal naming the part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { iconProblems, iconSvg, reactIconToCta, ICON_LIMITS } from '../membership/cta-icon.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const icon = (over = {}) => ({ name: 'FaBook', set: 'Font Awesome 5', viewBox: '0 0 448 512', attrs: { fill: 'currentColor' }, shapes: [{ tag: 'path', attrs: { d: 'M0 0h10v10z' } }], ...over });
const refused = (ic, re) => {
  const p = iconProblems(ic);
  assert.ok(p.some((s) => re.test(s)), `${JSON.stringify(ic).slice(0, 200)} -> ${JSON.stringify(p)}`);
  assert.equal(iconSvg(ic), '', 'an icon the rules refuse is never drawn');
};

test('the committed Stranger card icon is FaAmazon, valid, and draws as one path in currentColor', () => {
  const parsed = yaml.load(fs.readFileSync(path.join(ROOT, 'house/ctas.yml'), 'utf8'));
  const ic = parsed.ctas.find((c) => c.id === 'stranger-in-a-strange-land').icon;
  assert.equal(ic.name, 'FaAmazon');
  assert.deepEqual(iconProblems(ic), []);
  const svg = iconSvg(ic, 'pcta-ic');
  assert.match(svg, /^<svg class="pcta-ic" viewBox="0 0 448 512" fill="currentColor" stroke="currentColor" stroke-width="0" aria-hidden="true" focusable="false"><path d="M257\.2 /);
  assert.equal((svg.match(/<path /g) || []).length, 1);
});

test('elements that run code, fetch, or reference are refused: script, foreignObject, use, image, style, a, text', () => {
  for (const tag of ['script', 'foreignObject', 'use', 'image', 'style', 'a', 'text', 'animate', 'set', 'SCRIPT']) {
    refused(icon({ shapes: [{ tag, attrs: {} }] }), new RegExp(`element "${tag}" is not allowed`));
  }
  refused(icon({ shapes: [{ tag: 'g', children: [{ tag: 'script' }] }] }), /element "script" is not allowed/);
});

test('attributes outside the list are refused: handlers, style, href, class, id, and any value outside its pattern', () => {
  for (const k of ['onload', 'onclick', 'style', 'href', 'xlink:href', 'class', 'id', 'filter', 'mask', 'clip-path']) {
    refused(icon({ shapes: [{ tag: 'path', attrs: { d: 'M0 0', [k]: 'x' } }] }), new RegExp(`attribute "${k}" is not allowed`));
  }
  refused(icon({ attrs: { onload: 'alert(1)' } }), /attrs: attribute "onload" is not allowed/);
  refused(icon({ attrs: { d: 'M0 0' } }), /attrs: attribute "d" is not allowed/);
  for (const [k, v] of [['fill', 'url(#x)'], ['fill', 'red;background:url(x)'], ['stroke', 'javascript:1'], ['d', 'M0 0 javascript'], ['d', 'M0 0"/><script>'], ['transform', 'url(x)'], ['stroke-width', '1;x'], ['points', '1,2 <']]) {
    refused(icon({ shapes: [{ tag: k === 'points' ? 'polygon' : 'path', attrs: { d: 'M0 0', [k]: v } }] }), new RegExp(`attribute "${k}" has a value`));
  }
  refused(icon({ shapes: [{ tag: 'path', attrs: { d: { toString: () => 'M0 0' } } }] }), /must be a string or number/);
});

test('the icon envelope: names, set, viewBox, keys, empty shapes, children only on g, depth, size', () => {
  refused(icon({ name: 'faBook' }), /name must be a React Icons name/);
  refused(icon({ name: '<svg>' }), /name must be a React Icons name/);
  refused(icon({ set: 'x"y' }), /set must be/);
  refused(icon({ viewBox: '0 0 24' }), /viewBox must be four numbers/);
  refused(icon({ viewBox: '0 0 24 24" onload="x' }), /viewBox must be four numbers/);
  refused(icon({ extra: 1 }), /key "extra" is not allowed/);
  refused(icon({ shapes: [] }), /non-empty list/);
  refused(icon({ shapes: [{ tag: 'path', attrs: { d: 'M0 0' }, children: [] }] }), /only a group \(g\) may have children/);
  refused(icon({ shapes: [{ tag: 'path', attrs: { d: 'M0 0' }, on: 1 }] }), /key "on" is not allowed/);
  let deep = [{ tag: 'path', attrs: { d: 'M0 0' } }];
  for (let i = 0; i < ICON_LIMITS.depth; i++) deep = [{ tag: 'g', children: deep }];
  refused(icon({ shapes: deep }), /nested too deeply/);
  refused(icon({ shapes: Array.from({ length: ICON_LIMITS.nodes + 1 }, () => ({ tag: 'path', attrs: { d: 'M0 0' } })) }), /too many shapes/);
  refused(icon({ shapes: [{ tag: 'path', attrs: { d: 'M'.padEnd(ICON_LIMITS.value + 1, '0') } }] }), /too long/);
  refused(icon({ shapes: Array.from({ length: 4 }, () => ({ tag: 'path', attrs: { d: 'M'.padEnd(ICON_LIMITS.value, '0') } })) }), /too large/);
  assert.deepEqual(iconProblems(icon({ shapes: [{ tag: 'g', attrs: { transform: 'translate(2 2) scale(.5)' }, children: [{ tag: 'circle', attrs: { cx: 12, cy: '12', r: '4.5' } }, { tag: 'rect', attrs: { x: '1', y: '1', width: '50%', height: '2px', rx: '1' } }] }] })), []);
});

test('iconSvg escapes the class name and draws nested groups', () => {
  const svg = iconSvg(icon({ shapes: [{ tag: 'g', children: [{ tag: 'line', attrs: { x1: 0, y1: 0, x2: 4, y2: 4, stroke: '#fff' } }] }] }), 'a" onload="x');
  assert.match(svg, /^<svg class="a&quot; onload=&quot;x"/);
  assert.match(svg, /<g><line x1="0" y1="0" x2="4" y2="4" stroke="#fff"><\/line><\/g><\/svg>$/);
});

test('reactIconToCta: kebab-cases attributes, makes the React Icons paint defaults explicit, and refuses what the list refuses', () => {
  const tree = { tag: 'svg', attr: { viewBox: '0 0 24 24', fill: 'none', strokeWidth: '2', strokeLinecap: 'round', fillRule: 'evenodd' }, child: [{ tag: 'path', attr: { d: 'M5 12h14', strokeLinejoin: 'round' }, child: [] }, { tag: 'g', attr: {}, child: [{ tag: 'circle', attr: { cx: '12', cy: '12', r: '3' }, child: [] }] }] };
  const ic = reactIconToCta('TbExample', 'Tabler Icons', tree);
  assert.deepEqual(ic, {
    name: 'TbExample', set: 'Tabler Icons', viewBox: '0 0 24 24',
    attrs: { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'fill-rule': 'evenodd' },
    shapes: [{ tag: 'path', attrs: { d: 'M5 12h14', 'stroke-linejoin': 'round' } }, { tag: 'g', attrs: {}, children: [{ tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } }] }],
  });
  assert.equal(reactIconToCta('FaX', 'Font Awesome 5', { tag: 'svg', attr: { viewBox: '0 0 1 1' }, child: [{ tag: 'text', attr: {}, child: [] }] }), null, 'an unsupported element');
  assert.equal(reactIconToCta('FaX', 'Font Awesome 5', { tag: 'svg', attr: { viewBox: '0 0 1 1' }, child: [{ tag: 'path', attr: { d: 'M0 0', style: 'x' }, child: [] }] }), null, 'an unsupported attribute');
  assert.equal(reactIconToCta('FaX', 'Font Awesome 5', { tag: 'svg', attr: {}, child: [] }), null, 'no shapes');
  assert.equal(reactIconToCta('FaX', 'Font Awesome 5', { tag: 'div' }), null, 'not an svg tree');
  assert.equal(reactIconToCta('FaX', 'Font Awesome 5', { tag: 'svg', attr: {}, child: [{ tag: 'path', attr: { d: 'M0 0' }, child: [{ tag: 'path', attr: {} }] }] }), null, 'children on a path');
});
