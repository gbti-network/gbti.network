// sow-347: the WorkBench and the display settings survive a browser that refuses the page its storage.
//
// When site data is blocked, READING the `localStorage` property throws a SecurityError, and a `typeof` check does
// not help, because evaluating the name is what throws. The WorkBench read two saved settings that way and
// rendered nothing at all. Found by a browser harness on 2026-09-16 (a page with no origin is refused storage too).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { browserStorage, readStored } from '../client-ui/src/storage.mjs';
import { currentLayout, currentTheme, currentGlass, currentGlow, applyLayout, applyTheme, applyGlass, applyGlow } from '../client-ui/src/display-prefs.mjs';
import { setClient } from '../client-ui/src/base.mjs';

/** Run `fn` with a global localStorage whose mere reading throws, as a browser that blocks site data does. */
async function withBlockedStorage(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { const e = new Error('Access is denied for this document.'); e.name = 'SecurityError'; throw e; } });
  try { return await fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
}

test('the control: reading the blocked property really throws, even behind typeof', async () => {
  await withBlockedStorage(() => {
    assert.throws(() => (typeof localStorage !== 'undefined' ? localStorage : null), /Access is denied/);
  });
});

test('the helpers answer null instead of throwing, and read normally otherwise', async () => {
  await withBlockedStorage(() => {
    assert.equal(browserStorage(), null);
    assert.equal(readStored('gbti-workbench-sort'), null);
  });
  const store = new Map([['k', 'v']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => store.get(k) ?? null } });
  try {
    assert.equal(readStored('k'), 'v');
    assert.equal(readStored('missing'), null);
  } finally { delete globalThis.localStorage; }
  // Storage that exists but refuses the read itself (revoked mid-session) is also just "nothing stored".
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('denied'); } } });
  try { assert.equal(readStored('k'), null); } finally { delete globalThis.localStorage; }
});

test('the display settings fall back to their defaults and never throw', async () => {
  await withBlockedStorage(() => {
    assert.equal(currentLayout(), 'glass');
    assert.equal(currentTheme(), 'dark');
    assert.equal(currentGlass(), 85);
    assert.equal(currentGlow(), 50);
    assert.doesNotThrow(() => { applyLayout('flat', { doc: null }); applyTheme('light', { doc: null, prefersDark: false }); applyGlass(40, { doc: null }); applyGlow(60, { doc: null }); });
  });
});

test('a stored-glass read that fails falls back to the documented default, 85', () => {
  assert.equal(currentGlass({ storage: { getItem() { throw new Error('boom'); } } }), 85);
});

test('THE DEFECT: the WorkBench connects with storage blocked', async () => {
  const { GbtiWorkspace } = await import('../client-ui/src/elements/gbti-workspace.mjs');
  setClient(null);
  await withBlockedStorage(async () => {
    const el = new GbtiWorkspace();
    assert.doesNotThrow(() => el.connectedCallback());
    assert.ok(el._sort, 'the sort falls back to its default');
    await new Promise((r) => setImmediate(r));
    el.disconnectedCallback?.();
  });
});

test('no interface module reads localStorage outside a guard', () => {
  // A bare `typeof localStorage !== 'undefined' ? localStorage` outside a try is the shape that threw. The helper
  // module is the one place allowed to hold it, inside its own try.
  const root = new URL('../client-ui/src/', import.meta.url);
  const offenders = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!ent.name.endsWith('.mjs') || ent.name === 'storage.mjs') continue;
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/typeof localStorage !== 'undefined' \? localStorage\b/.test(line) && !/\btry\b/.test(line)) offenders.push(`${ent.name}:${i + 1}`);
      });
    }
  };
  walk(root.pathname);
  assert.deepEqual(offenders, []);
});
