// SOW-006 local store: unit tests against a temp dir (no touching the real user config).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore, STORE_DEFAULTS } from '../client/src/store.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-store-'));
}

test('store: returns defaults when no file exists', () => {
  const store = createStore({ dir: tmpDir() });
  assert.equal(store.get('mcpEnabled'), true);
  assert.equal(store.get('preferredPort'), 4500);
  assert.equal(store.get('endpointToken'), null);
  assert.deepEqual(store.load(), STORE_DEFAULTS);
});

test('store: set/get persists and merges', () => {
  const dir = tmpDir();
  const store = createStore({ dir });
  store.set({ repoPath: '/home/me/gbti', autostart: true });
  const reopened = createStore({ dir });
  assert.equal(reopened.get('repoPath'), '/home/me/gbti');
  assert.equal(reopened.get('autostart'), true);
  assert.equal(reopened.get('mcpEnabled'), true, 'untouched defaults remain');
});

test('store: ensureEndpointToken generates once then is stable', () => {
  const dir = tmpDir();
  const store = createStore({ dir });
  let gens = 0;
  const t1 = store.ensureEndpointToken(() => `tok-${++gens}`);
  const t2 = store.ensureEndpointToken(() => `tok-${++gens}`);
  assert.equal(t1, 'tok-1');
  assert.equal(t2, 'tok-1', 'second call reuses the stored token');
  assert.equal(gens, 1);
  assert.equal(createStore({ dir }).get('endpointToken'), 'tok-1');
});

test('store: file is written owner-only (0600) on POSIX', { skip: process.platform === 'win32' }, () => {
  const dir = tmpDir();
  const store = createStore({ dir });
  store.set({ githubToken: 'gho_secret' });
  const mode = fs.statSync(store.file).mode & 0o777;
  assert.equal(mode, 0o600);
});
