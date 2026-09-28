// Owner, 2026-09-28, two reports from the project pages:
// 1. "Random please": the Projects directory lists its rows in a random order on every visit. Before this the
//    rows came out in whatever order the build read the files, so a newer member's project sat at the bottom.
// 2. The Save (collection) and heart pills were unreadable on hover in light mode. BASE_CSS gives every bare
//    button `button:hover { background: var(--brand-dark) }`, which outranks a single class, so a hovered pill
//    showed green text on a green fill. Each pill now names its own hover background.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const DIR = readFileSync(new URL('../src/components/projects/ProjectDirectory.astro', import.meta.url), 'utf8');

// The inline shuffle, lifted out of the component so it runs here against a small stand-in for the list.
const SHUFFLE = /<script is:inline>([\s\S]*?)<\/script>/.exec(DIR)?.[1];

// A stand-in element: just the calls the shuffle makes (children, matches, insertBefore).
function el(tag, attrs = {}) {
  return { tag, attrs, matches: (sel) => sel === '[data-cat]' && 'data-cat' in attrs };
}
function list(children) {
  return {
    children,
    insertBefore(node, ref) {
      const from = this.children.indexOf(node);
      if (from >= 0) this.children.splice(from, 1);
      const at = ref ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(at, 0, node);
    },
  };
}
function runShuffle(target, random) {
  const document = { currentScript: { previousElementSibling: target } };
  const math = Object.create(Math);
  math.random = random;
  new Function('document', 'Math', SHUFFLE)(document, math);
}

test('the directory shuffles its public rows, and only those', () => {
  assert.ok(SHUFFLE, 'ProjectDirectory.astro has an inline shuffle script');
  const rows = 'abcdefghijkl'.split('').map((n) => el('article', { 'data-cat': 'x', n }));
  const members = el('template', { 'data-members-only': '' });
  const target = list([...rows, members]);
  // Math.random() -> 0 always picks index 0, so this sequence is a fixed, non-identity permutation.
  runShuffle(target, () => 0);
  const order = target.children.map((c) => c.attrs.n ?? 'template');
  assert.notDeepEqual(order.slice(0, 12), rows.map((r) => r.attrs.n), 'the rows moved');
  assert.deepEqual([...order.slice(0, 12)].sort(), rows.map((r) => r.attrs.n), 'every row is still there, once');
  assert.equal(order[12], 'template', 'the members-only template keeps its place after the rows');
});

test('two visits can see two different orders', () => {
  const orderWith = (random) => {
    const target = list('abcdefgh'.split('').map((n) => el('article', { 'data-cat': 'x', n })));
    runShuffle(target, random);
    return target.children.map((c) => c.attrs.n).join('');
  };
  assert.notEqual(orderWith(() => 0), orderWith(() => 0.999));
});

test('the shuffle sits straight after the list, so it runs before the rows are painted', () => {
  // Nothing but whitespace and a JSX comment (which renders nothing) between the list's closing tag and the
  // script, so document.currentScript.previousElementSibling is the list itself.
  const between = /<\/MembersOnlyCards>\);\s*\}\)\}\s*<\/div>([\s\S]*?)<script is:inline>/.exec(DIR)?.[1];
  assert.notEqual(between, undefined, 'the inline script follows the list');
  assert.equal(between.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim(), '');
});

for (const name of ['gbti-collection', 'gbti-favorite']) {
  test(`${name}: every button class it renders overrides the base green hover`, () => {
    const src = readFileSync(new URL(`../client-ui/src/elements/${name}.mjs`, import.meta.url), 'utf8');
    const classes = new Set();
    for (const m of src.matchAll(/<button\b[^>]*?class="([^"$]*)/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
    assert.ok(classes.has('pill'), 'the pill button is found');
    const missing = [...classes].filter((c) => !new RegExp(`\\.${c}(?:[.:][\\w-]+)*:hover[^{]*\\{[^}]*background`).test(src));
    assert.deepEqual(missing, [], `button classes whose hover inherits the base green: ${missing.join(', ')}`);
    // The hovered and saved text is the readable green, not brand green (3.4:1 on white, under AA at this size).
    assert.match(src, /\.pill:hover, \.pill\.on \{ color:var\(--accent\);/);
  });
}
