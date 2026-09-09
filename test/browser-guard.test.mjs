// sow-288: the browser guards (check:csp, check:overflow) can no longer skip green under REQUIRE_BROWSER, and
// can never pass on zero pages. The pure verdict is tested directly; skipOrDie through an injected exit; and
// BOTH real scripts are run as child processes against an empty build dir in both modes, so the mutation each
// path guards against (skip prints a tick / gate ignored) is exercised on the shipped files, not a model of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireBrowser, skipOrDie, verdict } from '../scripts/lib/browser-guard.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

test('requireBrowser reads exactly "1"', () => {
  assert.equal(requireBrowser({ REQUIRE_BROWSER: '1' }), true);
  assert.equal(requireBrowser({ REQUIRE_BROWSER: 'true' }), false);
  assert.equal(requireBrowser({}), false);
  assert.equal(requireBrowser(undefined), false);
});

test('verdict: zero pages checked is never a pass, gate or no gate', () => {
  for (const gate of [true, false]) {
    const v = verdict({ checked: 0, requireBrowser: gate });
    assert.equal(v.ok, false, `gate=${gate}`);
    assert.match(v.reason, /zero pages were checked/);
  }
});

test('verdict: findings fail; load failures fail only under the gate; a clean run passes', () => {
  assert.equal(verdict({ checked: 10, failures: 2 }).ok, false);
  assert.equal(verdict({ checked: 10, loadFailures: 1, requireBrowser: true }).ok, false);
  assert.match(verdict({ checked: 10, loadFailures: 1, requireBrowser: true }).reason, /REQUIRE_BROWSER is set/);
  const lenient = verdict({ checked: 10, loadFailures: 1, requireBrowser: false });
  assert.equal(lenient.ok, true);
  assert.match(lenient.reason, /noted, not failed/);
  assert.deepEqual(verdict({ checked: 10 }), { ok: true, reason: '' });
});

test('skipOrDie: exit 0 with a note without the gate, exit 1 with the reason under it', () => {
  const calls = [];
  const deps = (gate) => ({ requireBrowser: gate, exit: (c) => calls.push(['exit', c]), log: (m) => calls.push(['log', m]), error: (m) => calls.push(['error', m]) });
  skipOrDie('check:x', 'no browser', deps(false));
  assert.deepEqual(calls, [['log', '· check:x skipped: no browser'], ['exit', 0]]);
  calls.length = 0;
  skipOrDie('check:x', 'no browser', deps(true));
  assert.equal(calls[0][0], 'error'); assert.match(calls[0][1], /REQUIRE_BROWSER is set, so a skip is a failure/); assert.deepEqual(calls[1], ['exit', 1]);
});

// The real scripts, against a build dir that does not exist. Neither reaches Playwright, so this is hermetic.
for (const script of ['check-csp', 'check-overflow']) {
  test(`${script}: the real script skips green without the gate and fails red under it (empty build dir)`, () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-guard-empty-'));
    const run = (env) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', `${script}.mjs`)], { env: { ...process.env, REQUIRE_BROWSER: '', GUARD_DIST: path.join(empty, 'dist'), ...env }, encoding: 'utf8' });
    const lenient = run({});
    assert.equal(lenient.status, 0, lenient.stdout + lenient.stderr);
    assert.match(lenient.stdout, /skipped: dist\/ not found/);
    assert.doesNotMatch(lenient.stdout, /✓/, 'a skip must not print the tick');
    const strict = run({ REQUIRE_BROWSER: '1' });
    assert.equal(strict.status, 1, strict.stdout + strict.stderr);
    assert.match(strict.stderr, /cannot run and REQUIRE_BROWSER is set/);
    fs.rmSync(empty, { recursive: true, force: true });
  });
}

test('the weekly layout-guards job sets the gate on both guards and runs the CSP guard', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/layout-guards.yml'), 'utf8');
  assert.match(yml, /npm run check:overflow\n\s+env:\n\s+REQUIRE_BROWSER: '1'/);
  assert.match(yml, /npm run check:csp\n\s+env:\n\s+REQUIRE_BROWSER: '1'/);
});
