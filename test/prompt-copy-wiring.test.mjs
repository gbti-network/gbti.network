// Copy on a prompt block, shared by the published page and the invitation page.
//
// WHY THIS EXISTS. The invitation page showed a prompt block with no Copy, so a reader was being asked to select
// several thousand words by hand. The controls were omitted because the shared reshaper hardcoded
// `interactive: false`, and the copy logic itself lived inline in the published page's <script>, where the
// invitation could not reach it. Both are now one function, and this holds it to the two things that actually
// matter: that Copy yields the MARKDOWN rather than the rendered text, and that wiring twice cannot double-fire.
//
// A tiny DOM stand-in rather than a browser: the repo has no DOM in the node suite, and what is being asserted is
// the handler's behaviour, not layout. The stand-in is deliberately dumb, so a test passing here is about the
// code under test and not about a clever fake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wirePromptPage, PROMPT_SHELL } from '../src/lib/prompt-page.mjs';

/** The smallest element that satisfies what wirePromptPage touches. */
function el(tag, { cls = '', text = '', data = {} } = {}) {
  const node = {
    tagName: tag,
    className: cls,
    hidden: false,
    dataset: { ...data },
    children: [],
    listeners: {},
    classList: { toggle(name, on) { node._on = on ? name : null; } },
    addEventListener(ev, fn) { (node.listeners[ev] ||= []).push(fn); },
    click() { return Promise.all((node.listeners.click || []).map((fn) => fn())); },
    querySelector(sel) { return node.querySelectorAll(sel)[0] ?? null; },
    querySelectorAll(sel) {
      const match = (n) => {
        if (sel.startsWith('.')) return String(n.className).split(/\s+/).includes(sel.slice(1));
        const attr = sel.replace(/^\[|\]$/g, '');
        if (attr === 'data-copy') return n.dataset.copy !== undefined;
        if (attr === 'data-prompt-raw') return n.dataset.promptRaw !== undefined;
        if (attr === 'data-mode-btn') return n.dataset.modeBtn !== undefined;
        return false;
      };
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (match(c)) out.push(c); walk(c); } };
      walk(node);
      return out;
    },
    append(...kids) { node.children.push(...kids); return node; },
  };
  // textContent concatenates descendants, as the real one does. The first version of this fake stored only the
  // element's own text, so `.prompt-body` read as empty and the fallback test failed against correct code. The
  // fake was the broken instrument, which is the usual way round.
  node._text = text;
  Object.defineProperty(node, 'textContent', {
    get() { return node._text + node.children.map((c) => c.textContent).join(' '); },
    set(v) { node._text = String(v); node.children = []; },
  });
  return node;
}

const RAW = '# The prompt\n\n**Stage 1:** do the thing.\n';
const RENDERED = 'The prompt Stage 1: do the thing.';

function buildBlock() {
  const copy = el('button', { text: 'Copy', data: { copy: '' } });
  const visual = el('div', { cls: PROMPT_SHELL.view, text: RENDERED, data: { view: 'visual' } });
  const raw = el('pre', { cls: PROMPT_SHELL.raw, text: RAW, data: { view: 'markdown', promptRaw: '' } });
  const bVisual = el('button', { text: 'Visual', data: { modeBtn: 'visual' } });
  const bMarkdown = el('button', { text: 'Markdown', data: { modeBtn: 'markdown' } });
  const body = el('div', { cls: PROMPT_SHELL.body }).append(visual, raw);
  const block = el('div', { cls: PROMPT_SHELL.block, data: { mode: 'visual' } })
    .append(copy, bVisual, bMarkdown, body);
  const root = el('main').append(block);
  return { root, block, copy, visual, raw, bMarkdown };
}

test('Copy yields the raw markdown, not the rendered text', async () => {
  const { root, copy } = buildBlock();
  const written = [];
  wirePromptPage(root, { clipboard: { writeText: async (t) => { written.push(t); } } });

  await copy.click();
  assert.deepEqual(written, [RAW.trim()], 'the canonical prompt is the markdown the author wrote');
  assert.notEqual(written[0], RENDERED, 'the rendered view has lost the markdown, so it is the wrong source');
  assert.equal(copy.textContent, 'Copied');
});

test('Copy says so when the clipboard refuses, instead of claiming success', async () => {
  const { root, copy } = buildBlock();
  wirePromptPage(root, { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  await copy.click();
  assert.equal(copy.textContent, 'Copy failed');
});

test('Copy falls back to the rendered text when a block carries no raw element', async () => {
  const { root, block, copy, raw } = buildBlock();
  block.children[3].children = block.children[3].children.filter((c) => c !== raw);
  const written = [];
  wirePromptPage(root, { clipboard: { writeText: async (t) => { written.push(t); } } });
  await copy.click();
  assert.deepEqual(written, [RENDERED], 'something usable rather than nothing');
});

test('the Markdown toggle swaps which view is shown', () => {
  const { root, block, visual, raw, bMarkdown } = buildBlock();
  wirePromptPage(root, { clipboard: { writeText: async () => {} } });
  bMarkdown.listeners.click[0]();
  assert.equal(block.dataset.mode, 'markdown');
  assert.equal(visual.hidden, true, 'the rendered view hides');
  assert.equal(raw.hidden, false, 'and the markdown shows');
});

test('wiring the same document twice does not double-fire Copy', async () => {
  const { root, copy } = buildBlock();
  const written = [];
  const deps = { clipboard: { writeText: async (t) => { written.push(t); } } };
  const first = wirePromptPage(root, deps);
  const second = wirePromptPage(root, deps);
  assert.equal(first, 1, 'the first call wires the block');
  assert.equal(second, 1, 'the second call still reports it, but must not re-listen');
  await copy.click();
  assert.equal(written.length, 1, 'one click, one copy');
});
