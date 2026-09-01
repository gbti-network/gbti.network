// sow-299: a script that CALLS a shared-library export it never IMPORTED.
//
// This shipped and took two scheduled workflows down for three days. `scripts/reconcile.mjs` called
// `loadCouponsRaw(ROOT)` without importing it, so every run died with `loadCouponsRaw is not defined`.
// Reconcile is the job that syncs Discord roles, releases newly-paid held PRs and sends trial reminders, and
// the E2E smoke went red with it because its one reconcile case exits non-zero.
//
// WHY NOTHING CAUGHT IT. `node --check` passes: a missing import is a RUNTIME ReferenceError, not a syntax
// error. The unit tests import `loadCouponsRaw` from kv-mirror DIRECTLY and pass, so the library is well
// covered while the caller is not. And the coupon-mirror branch only runs against live KV credentials, so no
// test in the suite ever reaches that line. A green suite over a code path no test exercises.
//
// This guard is static and cheap: for every script, every kv-mirror export it CALLS must appear in its import
// list from that module. It catches the class rather than this one instance.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LIB = 'scripts/lib/kv-mirror.mjs';

/** The names kv-mirror actually exports. */
function libExports() {
  const src = fs.readFileSync(path.join(ROOT, LIB), 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export (?:async )?function ([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export const ([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

/** Scripts that import anything from kv-mirror, with the names they pulled in. */
function importersOfLib() {
  const dir = path.join(ROOT, 'scripts');
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.mjs')) continue;
    const rel = `scripts/${f}`;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = /import \{([^}]*)\} from '\.\/lib\/kv-mirror\.mjs';/.exec(src);
    if (!m) continue;
    out.push({ rel, src, imported: new Set(m[1].split(',').map((s) => s.trim()).filter(Boolean)) });
  }
  return out;
}

/** A bare call `name(`, not a property access `obj.name(` and not inside an import line. */
function callsBare(src, name) {
  const withoutImports = src.replace(/^import [\s\S]*?from '[^']*';$/gm, '');
  return new RegExp(String.raw`(^|[^.\w$])${name}\s*\(`, 'm').test(withoutImports);
}

test('every script calls only kv-mirror exports it actually imported', () => {
  const exports_ = libExports();
  const importers = importersOfLib();

  // Falsifiability: if the discovery half breaks, every assertion below passes over an empty set and this
  // guard becomes a no-op that looks green. Pin both sides before checking anything.
  assert.ok(exports_.size >= 5, `expected kv-mirror to export several names, found ${exports_.size}`);
  assert.ok(importers.length >= 2, `expected several scripts to import kv-mirror, found ${importers.length}`);
  assert.ok(exports_.has('loadCouponsRaw'), 'kv-mirror no longer exports loadCouponsRaw; update this guard');

  const violations = [];
  for (const { rel, src, imported } of importers) {
    for (const name of exports_) {
      if (imported.has(name)) continue;
      if (callsBare(src, name)) violations.push(`${rel} calls ${name}() but does not import it`);
    }
  }
  assert.deepEqual(violations, [], `missing imports would throw ReferenceError at runtime:\n  ${violations.join('\n  ')}`);
});

test('the specific regression: reconcile.mjs imports loadCouponsRaw', () => {
  // Named separately from the sweep so a grep for the symbol finds a test that is actually about it.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/reconcile.mjs'), 'utf8');
  const m = /import \{([^}]*)\} from '\.\/lib\/kv-mirror\.mjs';/.exec(src);
  assert.ok(m, 'reconcile.mjs no longer imports from kv-mirror at all');
  const names = m[1].split(',').map((s) => s.trim());
  assert.ok(names.includes('loadCouponsRaw'), 'reconcile.mjs calls loadCouponsRaw without importing it');
  assert.ok(callsBare(src, 'loadCouponsRaw'), 'reconcile.mjs no longer calls loadCouponsRaw; this guard is now pointed at nothing');
});
