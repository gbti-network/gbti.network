// sow-213 Step 2: prove that every migrated CONSUMER of the git override files actually WIRES the KV overlay,
// not just that the overlay function works.
//
// WHY THIS TEST EXISTS. The per-consumer migrations (pr-gate, R11 payout-referrals, R12 mail-enroll) each add
// one line, `await applyOverridesSource({ overrides, repoRoot, env })`, right after `loadOverrides(...)`. Each
// migration's own test proves the overlay BEHAVES (a KV-only ban is enforced, an unavailable mirror denies),
// but composes applyOverridesSource + the downstream predicate directly. None of them drives the consumer's
// `main()`/`run()`, because that needs live Stripe and KV. So "main() actually calls the overlay" was, three
// times over, verified only by a human reading the diff once. Three identical un-exercised seams is a pattern,
// and it is exactly the "green suite over a path no test runs" class this SOW exists to stop. This closes it.
//
// WHAT IT CAN AND CANNOT DO. It is a STATIC call-graph assertion: it reads each consumer's source and asserts
// the overlay is IMPORTED and CALLED, and that the call sits AFTER the load (before it, the overlay would run
// against an object the load then overwrites, so it would be decorative). It cannot prove the line executes at
// runtime, because the module's `import.meta.url` guard means importing it never runs main(), and a spy would
// need a subprocess. A static assertion is what SowMaster signed off as sufficient here. If a consumer's
// overlay call is deleted or moved before the load, this reds.
//
// EXTENDING IT: when a further reader migrates (R4 reconcile, R7, R8), add a row. The gate is not clean until
// `git grep -l "loadOverrides\b"` returns only the definition + generated, and every consumer it names is here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Each migrated consumer of loadOverrides that gates on bans/grandfathers. The definition (membership/
// overrides.mjs) and the mirror-write source (loadOverridesRaw callers) are NOT consumers and are not listed.
const MIGRATED_CONSUMERS = [
  { file: 'scripts/pr-gate.mjs', note: 'the SOW-005 gate, migrated in Phase 1' },
  { file: 'scripts/payout-referrals.mjs', note: 'R11, a money path' },
  { file: 'scripts/mail-enroll.mjs', note: 'R12, the digest population' },
];

for (const { file, note } of MIGRATED_CONSUMERS) {
  test(`overrides overlay is wired in ${file} (${note})`, () => {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(src.length > 0, `${file} read as non-empty (guards against a bad path passing vacuously)`);

    // Imported from the overrides-source module, not some shadow.
    assert.match(
      src,
      /import\s*\{[^}]*\bapplyOverridesSource\b[^}]*\}\s*from\s*['"][^'"]*overrides-source\.mjs['"]/,
      `${file} imports applyOverridesSource from overrides-source.mjs`,
    );

    // The CALL, not the import: the import has no open paren after the name; the JSDoc references of
    // loadOverrides() in pr-gate are skipped by anchoring the load on its ASSIGNMENT (`= loadOverrides(`).
    const overlayIdx = src.indexOf('applyOverridesSource(');
    const loadIdx = src.search(/=\s*loadOverrides\s*\(/);
    assert.ok(loadIdx >= 0, `${file} calls loadOverrides (the git half)`);
    assert.ok(overlayIdx >= 0, `${file} CALLS applyOverridesSource, not just imports it`);
    assert.ok(
      overlayIdx > loadIdx,
      `${file} applies the overlay AFTER loadOverrides; before it, the overlay is overwritten and decorative`,
    );
  });
}

test('MIGRATED_CONSUMERS covers EVERY consumer of applyOverridesSource (derived, so the table cannot silently empty)', () => {
  // THE HOLE THIS CLOSES. The per-consumer tests above are registered by a for-loop over MIGRATED_CONSUMERS, so
  // emptying or commenting out that table registers ZERO tests and the file passes green: a guard that disables
  // itself more quietly than the thing it guards. The requirement is therefore DERIVED from the repo, never
  // restated as a count (a `length >= 3` would rot the moment R4 lands). The derived set is the non-test source
  // files that IMPORT applyOverridesSource, minus its own definition. Adding a consumer without a row makes the
  // derived set larger than the table and REDS; emptying the table REDS because the derived set is non-empty.
  const rootDir = fileURLToPath(new URL('../', import.meta.url));
  const DEF_FILE = 'scripts/lib/overrides-source.mjs'; // exports applyOverridesSource; it is not a consumer
  const SKIP_DIRS = new Set(['node_modules', 'dist', 'mcp']); // generated bundles + deps; hidden dirs skipped below
  const IMPORTS_OVERLAY = /import\s*\{[^}]*\bapplyOverridesSource\b[^}]*\}\s*from/;

  const derived = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.relative(rootDir, path.join(dir, ent.name)).split(path.sep).join('/');
      if (ent.isDirectory()) {
        if (ent.name.startsWith('.') || SKIP_DIRS.has(ent.name)) continue; // .git/.data/.astro/.snapshots + generated
        walk(path.join(dir, ent.name));
      } else if (ent.isFile() && ent.name.endsWith('.mjs')) {
        if (rel === DEF_FILE) continue;                                   // the definition, not a consumer
        if (rel.startsWith('test/') || rel.includes('/test/')) continue;  // tests import it to test it
        if (IMPORTS_OVERLAY.test(fs.readFileSync(path.join(dir, ent.name), 'utf8'))) derived.push(rel);
      }
    }
  };
  walk(rootDir);

  assert.ok(derived.length > 0, 'the derivation found at least one consumer (guards the walk itself against a silent zero)');
  const tabled = MIGRATED_CONSUMERS.map((c) => c.file).slice().sort();
  assert.deepEqual(
    derived.slice().sort(),
    tabled,
    'MIGRATED_CONSUMERS must list EXACTLY the source files that import applyOverridesSource.\n'
    + `  derived from the repo: ${derived.slice().sort().join(', ')}\n`
    + `  listed in the table:   ${tabled.join(', ')}\n`
    + '  A consumer added without a row, or a stale or emptied table, fails here. Add or remove the row.',
  );
});
